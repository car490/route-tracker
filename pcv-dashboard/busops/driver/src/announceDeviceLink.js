// src/announceDeviceLink.js
//
// BusOps Announce Lite — paired-install linking (Driver PWA side).
// Pure decision logic only, zero imports — same separation as
// diversionAlert.js: no Supabase calls here, so it's unit-testable without
// a DOM/window (this file is imported by Vitest under a plain Node
// environment — see vitest.config.js). The actual RPC/fetch calls live in
// announceDeviceLinkApi.js, which callers (main.js) invoke alongside this.
//
// Explicitly separate from announceLink.js, which stays Standard-only
// (Controller push over /driver-push) — see docs/ANNOUNCE-PRODUCT-TIERS.md.

// Prefer the active journey's vehicle_id (duty-card flow, same source
// runTracker() already uses — main.js's `journey.vehicle_id`) — else fall
// back to this device's own vehicleSetup.js commissioning (manual-selection
// flow). Mirrors the same duty-card-vs-manual conditional already threaded
// through manualSelection.js's selectServiceManually(..., vehicleId, ...).
export function resolveVehicleIdForAnnounceLink(activeJourney, storedVehicle) {
  return activeJourney?.vehicle_id ?? storedVehicle?.id ?? null;
}
