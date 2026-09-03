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
