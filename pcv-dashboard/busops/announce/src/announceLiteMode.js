// src/announceLiteMode.js
//
// BusOps Announce Lite — pure mode-hot-switch decision. Separate from
// announceDeviceFeed.js (Supabase wiring) for the same reason
// scheduleAutopilot.js is separate from announceSoloAutopilot.js:
// keeps the decision unit-testable without a DOM/Supabase client.
//
// Previously announceDeviceFeed.js decided its mode once, from the row read
// at startup, and never revisited it ("not hot-switched mid-session" — see
// that file's git history). This function is what makes hot-switching
// safe: it only reports a change when gps_source itself actually flips
// (a device linked/unlinked while running), never on every row update.

export function resolveModeSwitch(currentMode, nextRow) {
  const nextMode = nextRow?.gps_source;
  if (!nextMode || nextMode === currentMode) return null;
  return nextMode;
}

// Self-heal watchdog decision — the other half of the fix for a device
// getting stuck "waiting for a driver poke" (found live 2026-09-04:
// link_announce_device had no guard against flipping an already-commissioned
// Solo device into driver-device mode, where it then waits forever for a
// push that never arrives — see migration_announce_devices_solo_guard.sql
// for the guard itself). This is the belt-and-braces half: even if a device
// does end up in driver-device mode (a deliberate p_force link, or any
// future path), a Solo-commissioned device (candidate_departure_ids
// populated) must never wait forever — it reverts to autopilot once
// msSinceLastPush exceeds timeoutMs. A device with no candidates at all is
// presumed a genuine Lite (paired) install and is left alone indefinitely,
// same as today.
export function shouldSelfHeal({ candidateDepartureIds, msSinceLastPush, timeoutMs }) {
  if (!candidateDepartureIds?.length) return false;
  return msSinceLastPush >= timeoutMs;
}
