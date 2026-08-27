// src/announceDeviceLinkApi.js
//
// BusOps Announce Lite — paired-install linking, Supabase RPC/fetch calls.
// Split from announceDeviceLink.js (which holds the pure, DOM-free decision
// logic) precisely so those pure functions stay unit-testable without a
// window global — this file imports supabaseApi.js, which reads
// window.location at module load via config.js. Untested here, matching
// manualSelection.js/vehicleSetup.js's precedent of leaving thin RPC/fetch
// wrappers uncovered while the decision logic around them is tested.

import { rpc, sbFetch } from './supabaseApi.js';

// Announce devices already registered to this vehicle (dashboard-side
// registration creates the row — see AnnounceDeviceLinkPage.jsx), for the
// driver to pick from when linking.
export async function fetchAnnounceDevicesForVehicle(vehicleId) {
  const res = await sbFetch(
    `/rest/v1/announce_devices?vehicle_id=eq.${vehicleId}&select=id,label,link_state`
  );
  if (!res.ok) throw new Error(`announce_devices ${res.status}`);
  return res.json();
}

export async function linkAnnounceDevice(deviceId, vehicleId) {
  return rpc('link_announce_device', { p_device_id: deviceId, p_vehicle_id: vehicleId });
}

export async function unlinkAnnounceDevice(deviceId) {
  return rpc('unlink_announce_device', { p_device_id: deviceId });
}
