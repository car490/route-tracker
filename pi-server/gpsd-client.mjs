// Minimal gpsd client — speaks gpsd's JSON wire protocol directly over TCP
// (no external dependency). gpsd (https://gpsd.io) is the standard Linux
// daemon for reading a GPS module; this just needs to be running locally
// (`sudo apt install gpsd gpsd-clients`, pointed at the GPS device) before
// this server starts.
//
// Protocol: connect to gpsd's TCP port (2947 by default), send a WATCH
// command, then gpsd streams newline-delimited JSON reports. We only care
// about "TPV" (Time-Position-Velocity) reports with mode >= 2 (2D/3D fix).
import net from 'node:net';

const RECONNECT_DELAY_MS = 3000;

export function startGpsdClient({ host = '127.0.0.1', port = 2947 } = {}) {
  let latestFix = null; // { lat, lon, speed, ts } — last known-good fix
  let socket = null;
  let buffer = '';
  let stopped = false;

  function connect() {
    if (stopped) return;
    socket = net.createConnection({ host, port }, () => {
      console.log(`[gpsd] connected to ${host}:${port}`);
      socket.write('?WATCH={"enable":true,"json":true}\n');
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        handleLine(line);
      }
    });

    socket.on('error', (err) => {
      console.warn(`[gpsd] connection error: ${err.message}`);
    });

    socket.on('close', () => {
      if (stopped) return;
      console.warn(`[gpsd] connection closed — retrying in ${RECONNECT_DELAY_MS / 1000}s`);
      setTimeout(connect, RECONNECT_DELAY_MS);
    });
  }

  function handleLine(line) {
    let report;
    try {
      report = JSON.parse(line);
    } catch (_) {
      return; // malformed/partial line — ignore
    }
    if (report.class === 'TPV' && report.mode >= 2 && typeof report.lat === 'number' && typeof report.lon === 'number') {
      latestFix = {
        lat: report.lat,
        lon: report.lon,
        speed: typeof report.speed === 'number' ? report.speed : 0, // gpsd reports speed in m/s, matches what gps.js expects
        ts: Date.now(),
      };
    }
  }

  connect();

  return {
    getLatestFix: () => latestFix,
    stop: () => {
      stopped = true;
      socket?.destroy();
    },
  };
}
