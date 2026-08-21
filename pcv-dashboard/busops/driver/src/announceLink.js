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

// The exact JSON-serializable payload sent per state change. Carries the
// full stopStates array too — gps.js's single source of truth for per-stop
// geofence status (see gps.js's own header comment on that array) — so any
// consumer downstream of the push feed has the same data local-GPS mode
// already had available, not a hand-picked subset. Deliberately excludes
// lat/lon even though callers (main.js's onUpdate) have them handy — see
// file header.
export function buildStatePayload(state, { announcing = null } = {}) {
  const {
    journeyId, nextStopIndex, nextStopName, atStop, approaching,
    earlyWait, timing, stopStates, diversionActive, isFinal,
  } = state;
  return {
    type: 'state',
    ts: Date.now(),
    journeyId, nextStopIndex, nextStopName, atStop, approaching,
    earlyWait, timing, stopStates, diversionActive, isFinal, announcing,
  };
}

// Sent once per journey start (and resent on every reconnect — see
// sendSchedule() below) so the Controller knows which journey/stops any
// subsequent {type:'state'} messages refer to, without ever querying
// Supabase itself. allStops is forwarded verbatim (name/lat/lon/time/
// stop_type/timetable_stop_id/stop_id) — same "carry the full shape, not a
// hand-picked subset" precedent as buildStatePayload's stopStates.
// accentColor/primaryColor default to null (not omitted) so a manually-
// started journey — which has no company branding lookup today — still
// produces a well-formed payload the Controller can render against the
// platform default accent.
export function buildSchedulePayload({ journeyId, serviceCode, destination, allStops, accentColor, primaryColor }) {
  return {
    type: 'schedule',
    ts: Date.now(),
    journeyId,
    serviceCode,
    destination,
    stops: allStops,
    accentColor: accentColor ?? null,
    primaryColor: primaryColor ?? null,
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
let lastScheduleState = null;

// Resends the current journey's schedule whenever the socket (re)opens —
// covers both the initial connect racing broadcastSchedule() (socket not
// OPEN yet when it's first called) and a Controller restarting mid-shift
// (its in-memory latestSchedule is gone; the Driver silently reconnecting
// is what repopulates it, no user action needed).
function sendSchedule() {
  if (!lastScheduleState || !socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(buildSchedulePayload(lastScheduleState)));
}

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
  socket.addEventListener('open', sendSchedule);
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
  lastScheduleState = null;
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

// Called from announcements.js's announce() alongside (not instead of —
// see that file's own comment on why) local playback, so the Controller
// can play the same PSVAIR announcement over its own PA (docs/CONTROLLER-
// REDESIGN.md §8). Fire-and-forget, same no-op-when-disconnected shape as
// broadcastState — a device never commissioned with a Controller (today,
// most of the fleet) just keeps relying on local playback alone. Unlike
// state/schedule, never remembered for resend-on-reconnect (no
// lastAnnounceState) — an announcement that's gone stale by the time a
// dropped connection comes back isn't worth replaying (see
// pi-server/announceRelay.mjs's own comment on this).
export function broadcastAnnounce(text, audioKeys) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'announce', text, audioKeys: audioKeys ?? [] }));
}

// Call once when a journey starts tracking (alongside connectAnnounceLink()
// — see main.js). Remembered so it can be resent on every reconnect by
// sendSchedule() above; a no-op here just means "not open yet", not "lost".
export function broadcastSchedule(state) {
  lastScheduleState = state;
  sendSchedule();
}
