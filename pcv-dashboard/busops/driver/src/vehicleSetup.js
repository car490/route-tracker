// One-time (until changed) commissioning step: which vehicle this device is
// mounted in. Needed because the manual-selection flow (manualSelection.js —
// the default flow now that duty-card links aren't used, see
// pi-server/TEMP-LAPTOP.md) creates journeys with no ops-assigned vehicle
// otherwise. See docs/TODO.md "Manual-selection flow — no vehicle/driver on
// the journey".
//
// Storage is injectable (defaults to the real browser API), same pattern as
// announceLink.js's captureAnnounceSetup, so the pure read/write helpers are
// unit-testable without a DOM.
const STORAGE_ID_KEY    = 'vehicleId';
const STORAGE_LABEL_KEY = 'vehicleLabel';

// { id, label } if this device has a vehicle commissioned, else null.
export function getStoredVehicle(storage = globalThis.localStorage) {
  const id = storage.getItem(STORAGE_ID_KEY);
  if (!id) return null;
  return { id, label: storage.getItem(STORAGE_LABEL_KEY) ?? '' };
}

// label is display-only (e.g. the registration) — never trusted server-side;
// only id is ever sent to Supabase (see manualSelection.js).
export function storeVehicle(id, label, storage = globalThis.localStorage) {
  storage.setItem(STORAGE_ID_KEY, id);
  storage.setItem(STORAGE_LABEL_KEY, label ?? '');
}
