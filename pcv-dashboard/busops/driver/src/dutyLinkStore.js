// src/dutyLinkStore.js
//
// BusOps Driver — where the duty-card link (bearer token + journey ids,
// captured once off the URL by supabaseApi.js's captureDutyLinkParams())
// is kept for the rest of the shift.
//
// It used to be sessionStorage, so the token cleared when the tab closed and
// never lingered on a shared device. But a power cut that flattens the
// cab tablet's battery restarts the browser, which wiped the duty card
// mid-shift (docs/HARDWARE.md "Power loss and first boot"). Owner's call,
// 2026-09-28: keep it on the device until the end of the shift, and no
// longer. A stored link is discarded on read once any of these is true:
//   - the token's own exp claim has passed (sign-token.js issues 24 h),
//   - the UK date has changed since it was saved,
// and it is cleared outright when every duty on the card is completed
// (isShiftComplete, called from main.js's renderDutyCard()).
//
// The token's signature is never checked here (the server does that);
// exp is only read so the device stops holding a token it can't use.
// Pure, injectable storage/clock, never throws — same conventions as
// localStore.js.

export const DUTY_LINK_KEY = 'busops.driver.dutyLink';

// The old per-tab keys, read once by migrateLegacyDutyLink().
const LEGACY_TOKEN_KEY = 'dutyLinkToken';
const LEGACY_IDS_KEY = 'dutyLinkIds';

const ukDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function tokenExpiry(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(atob(b64));
    return Number.isFinite(exp) ? new Date(exp * 1000) : null;
  } catch (_) {
    return null;
  }
}

function read(storage) {
  try {
    const raw = storage.getItem(DUTY_LINK_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    clearDutyLink({ storage });
    return null;
  }
}

export function saveDutyLink({ token, duties }, { storage = globalThis.localStorage, now = new Date() } = {}) {
  // Only a still-valid earlier link is carried over, never yesterday's.
  const previous = loadDutyLink({ storage, now }) ?? {};
  const nextToken = token || previous.token || null;
  const expiry = tokenExpiry(nextToken);
  const entry = {
    token: nextToken,
    duties: duties || previous.duties || null,
    day: ukDate.format(now),
    expiresAt: expiry ? expiry.toISOString() : null,
  };
  try {
    storage.setItem(DUTY_LINK_KEY, JSON.stringify(entry));
  } catch (_) {}
}

export function loadDutyLink({ storage = globalThis.localStorage, now = new Date() } = {}) {
  const entry = read(storage);
  if (!entry) return null;
  const expired = entry.expiresAt && now.getTime() >= new Date(entry.expiresAt).getTime();
  if (expired || entry.day !== ukDate.format(now)) {
    clearDutyLink({ storage });
    return null;
  }
  return { token: entry.token ?? null, duties: entry.duties ?? null };
}

export function clearDutyLink({ storage = globalThis.localStorage } = {}) {
  try {
    storage.removeItem(DUTY_LINK_KEY);
  } catch (_) {}
}

export function isShiftComplete(duties) {
  return Array.isArray(duties) && duties.length > 0 && duties.every((d) => d.status === 'completed');
}

// One-off carry-over for a tablet that is mid-shift when this ships.
export function migrateLegacyDutyLink({
  session = globalThis.sessionStorage,
  storage = globalThis.localStorage,
  now = new Date(),
} = {}) {
  try {
    const token = session.getItem(LEGACY_TOKEN_KEY);
    const duties = session.getItem(LEGACY_IDS_KEY);
    if (!token && !duties) return;
    saveDutyLink({ token, duties }, { storage, now });
    session.removeItem(LEGACY_TOKEN_KEY);
    session.removeItem(LEGACY_IDS_KEY);
  } catch (_) {}
}
