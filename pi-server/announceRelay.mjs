// Relays the Driver device's already-computed tracking state to the
// onboard sign, over two WebSocket endpoints on the same HTTP server
// server.mjs already runs:
//   /driver-push  — the Driver device connects here and pushes one JSON
//                   {type:'state', ...} message per state change.
//   /sign-feed    — onboard.js (this Pi's kiosk browser, or a WiFi-client
//                   display) connects here to receive those messages,
//                   relayed as-is. Gets the last-known state immediately
//                   on connect so a sign that (re)connects mid-journey
//                   isn't blank until the next Driver update.
//
// Both endpoints require ?token=<DRIVER_PUSH_TOKEN> on the connection URL
// — a commissioning-time shared secret, not "on this network = trusted"
// (see project_nextstop_architecture design notes). One Pi serves one
// vehicle's one active journey, so a single in-memory latestState is
// enough — no per-journey routing.
import { WebSocketServer } from 'ws';

export function attachAnnounceRelay(httpServer, { token } = {}) {
  const driverWss = new WebSocketServer({ noServer: true });
  const signWss = new WebSocketServer({ noServer: true });
  const signClients = new Set();
  let latestState = null;

  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname, searchParams } = new URL(req.url, 'http://internal');

    if (pathname !== '/driver-push' && pathname !== '/sign-feed') return; // not ours — leave for anything else listening

    if (!token || searchParams.get('token') !== token) {
      // .end() (not .write()+.destroy()) so the status line/headers are
      // guaranteed to flush before the socket closes — otherwise a client
      // can see a bare connection drop instead of a clean 401.
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }

    const wss = pathname === '/driver-push' ? driverWss : signWss;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  driverWss.on('connection', (ws) => {
    console.log('[announceRelay] driver connected');
    ws.on('close', () => console.log('[announceRelay] driver disconnected'));
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString('utf8'));
      } catch (_) {
        return; // malformed — ignore, don't drop the connection over one bad frame
      }
      if (msg.type !== 'state') return;
      latestState = msg;
      const payload = JSON.stringify(msg);
      for (const client of signClients) {
        if (client.readyState === client.OPEN) client.send(payload);
      }
    });
  });

  signWss.on('connection', (ws) => {
    console.log(`[announceRelay] sign display connected (${signClients.size + 1} now watching)`);
    signClients.add(ws);
    if (latestState) ws.send(JSON.stringify(latestState));
    ws.on('close', () => {
      signClients.delete(ws);
      console.log(`[announceRelay] sign display disconnected (${signClients.size} now watching)`);
    });
  });

  return {
    getLatestState: () => latestState,
  };
}
