// Pushes the Driver's already-computed tracking state to a Raspberry Pi
// over a local WebSocket, for BusOps Announce to render as a pushed feed
// instead of its own independent GPS/Supabase polling (see
// pi-server/announceRelay.mjs for the receiving side, docs/HARDWARE.md and
// the project_nextstop_architecture design notes for the wider context).
//
// Never sends raw GPS — only derived state (next stop, ETA, diversion/
// final-stop flags). A complete no-op on any device that hasn't been
// commissioned with a Pi target (see captureAnnounceSetup below), so it's
// safe to call unconditionally from every vehicle, including ones still on
// the cab-device bridge with no Pi at all.
const RECONNECT_DELAY_MS = 3000;
const STORAGE_URL_KEY = 'announceLinkUrl';
const STORAGE_TOKEN_KEY = 'announceLinkToken';

// ── Pure helpers (no localStorage/WebSocket access — safe to unit test) ────

// Builds the /driver-push connection URL from stored config, or null if
// this device was never commissioned for a Pi at all.
export function buildConnectionUrl(base, token) {
  if (!base) return null;
  const url = new URL(base);
  if (token) url.searchParams.set('token', token);
  return url.toString();
}

// The exact JSON-serializable payload sent per state change. Only carries
// the already-computed fields the onboard sign needs to render — deliberately
// excludes lat/lon even though callers (main.js's onUpdate) have them handy.
export function buildStatePayload(state, { announcing = null } = {}) {
  const {
    journeyId, nextStopIndex, nextStopName, atStop, approaching,
    earlyWait, timing, diversionActive, isFinal,
  } = state;
  return {
    type: 'state',
    ts: Date.now(),
    journeyId, nextStopIndex, nextStopName, atStop, approaching,
    earlyWait, timing, diversionActive, isFinal, announcing,
  };
}

// ── Commissioning (one-time, persisted) ─────────────────────────────────────

// One-time setup: visiting index.html?announce-setup=<pi-ws-url>&announce-token=<token>
// saves both to localStorage; the query param is never needed again on that
// device. storage is injectable for testing, defaults to the real browser API.
export function captureAnnounceSetup(params, storage = globalThis.localStorage) {
  const url = params.get('announce-setup');
  const token = params.get('announce-token');
  if (url) storage.setItem(STORAGE_URL_KEY, url);
  if (token) storage.setItem(STORAGE_TOKEN_KEY, token);
}

// ── Live connection (side-effecting — browser only) ─────────────────────────

let socket = null;
let stopped = true;
let announcing = null;

function connect() {
  if (stopped) return;
  const url = buildConnectionUrl(localStorage.getItem(STORAGE_URL_KEY), localStorage.getItem(STORAGE_TOKEN_KEY));
  if (!url) return; // not commissioned for a Pi — silently do nothing

  try {
    socket = new WebSocket(url);
  } catch (_) {
    scheduleReconnect();
    return;
  }
  socket.addEventListener('close', scheduleReconnect);
  socket.addEventListener('error', () => {}); // 'close' always follows 'error' on WebSocket, no separate handling needed
}

function scheduleReconnect() {
  socket = null;
  if (stopped) return;
  setTimeout(connect, RECONNECT_DELAY_MS);
}

// Call once when a journey starts tracking. Safe to call even when this
// device was never commissioned — connect() just finds no URL and returns.
export function connectAnnounceLink() {
  stopped = false;
  connect();
}

// Call once when a journey ends/stops.
export function disconnectAnnounceLink() {
  stopped = true;
  socket?.close();
  socket = null;
  announcing = null;
}

// Lets main.js flag what's currently being announced (PSVAIR audio stays on
// the Driver device — see project plan — this is display-only metadata for
// the onboard sign to show, not a request for the Pi to play anything).
export function setAnnouncing(name) {
  announcing = name ?? null;
}

// Fire-and-forget — must never block or throw into the GPS tracking loop.
// A no-op whenever there's no live connection (not commissioned, mid-
// reconnect, etc.) — callers don't need to check state themselves.
export function broadcastState(state) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(buildStatePayload(state, { announcing })));
}
