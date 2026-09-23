// Tablet capture, part 2: reading `adb` output. Pure parsers, unit-tested (tabletAdb.test.mjs).
// The real `adb` calls are in scripts/measure-announce-solo.mjs, and they are read-only:
// `adb devices`, a read of /proc/net/unix, and a temporary port forward that is removed on exit.
// Nothing here or there ever writes a setting on the device.

/** [{ serial, state, model }] from `adb devices -l`; ignores daemon chatter. Never throws. */
export function parseAdbDevices(text) {
  if (typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('List of devices attached'));
  if (start === -1) return [];
  const devices = [];
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (!line) continue;
    const [serial, ...rest] = line.split(/\s+/);
    const state = rest[0];
    if (!serial || !state) continue;
    const model = /\bmodel:(\S+)/.exec(line)?.[1];
    devices.push(model ? { serial, state, model } : { serial, state });
  }
  return devices;
}

/**
 * Picks the device to measure. Refuses to guess: with more than one authorised device the
 * caller must say which (--serial), because measuring the wrong tablet would look like success.
 */
export function chooseDevice(devices, serial) {
  const list = Array.isArray(devices) ? devices : [];
  const authorised = list.filter((d) => d.state === 'device');

  if (serial) {
    const found = list.find((d) => d.serial === serial);
    if (!found) {
      const seen = list.map((d) => d.serial).join(', ') || 'none';
      throw new Error(`No adb device with serial ${serial}. Attached: ${seen}.`);
    }
    if (found.state !== 'device') {
      throw new Error(`Device ${serial} is ${found.state}, not authorised. Accept the "Allow USB debugging?" prompt on the tablet.`);
    }
    return found;
  }

  if (authorised.length === 1) return authorised[0];
  if (authorised.length > 1) {
    const serials = authorised.map((d) => d.serial).join(', ');
    throw new Error(`More than one adb device is attached (${serials}). Pass --serial <serial> to choose which tablet to measure.`);
  }

  const blocked = list.filter((d) => d.state !== 'device');
  if (blocked.length) {
    const states = blocked.map((d) => `${d.serial} is ${d.state}`).join('; ');
    throw new Error(`No authorised adb device: ${states}. Accept the "Allow USB debugging?" prompt on the tablet (that prompt is the device's own OS asking, not a setting this tool changes).`);
  }
  throw new Error('No authorised adb device found. Plug the tablet in over USB and accept the "Allow USB debugging?" prompt if it is shown.');
}

// Only a plain identifier is ever accepted, so a socket name can never carry anything that
// means something to a shell, even though the name is passed to adb as an argument, not a string.
const WEBVIEW_SOCKET = /^webview_devtools_remote_\d+$/;

/**
 * Names of the WebView remote-debugging sockets in the device's /proc/net/unix. Empty means
 * the app on screen is not exposing DevTools right now (Fully Kiosk's web-contents debugging
 * is off), which this tool reports and never fixes by itself.
 */
export function findWebviewSocketNames(procNetUnix) {
  if (typeof procNetUnix !== 'string') return [];
  const names = [];
  for (const line of procNetUnix.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    const name = (fields[fields.length - 1] ?? '').replace(/^@/, '');
    if (WEBVIEW_SOCKET.test(name)) names.push(name);
  }
  return names;
}

// The sign's own path, with or without .html and an optional folder prefix: Cloudflare Workers
// serves it as /announce/onboard (the tablet showed exactly that on 2026-09-19), the local server
// and older hosting as /announce/onboard.html. Matched on the URL PATH only, so a query string
// (the device token) or a look-alike elsewhere in the URL can never make another page the sign.
const SIGN_PATH = /(^|\/)announce\/onboard(\.html)?\/?$/;

/** The open page that is the sign, from DevTools' /json target list; null if there is none. */
export function pickSignTarget(targets) {
  if (!Array.isArray(targets)) return null;
  for (const t of targets) {
    if (!t || t.type !== 'page' || typeof t.url !== 'string') continue;
    let path;
    try { path = new URL(t.url).pathname; } catch { continue; }
    if (SIGN_PATH.test(path)) return t;
  }
  return null;
}
