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

// This vehicle's currently-linked Announce Lite device, if any — main.js
// calls this once per journey start to decide whether to also push state to
// Supabase (paired Lite) alongside the existing Controller WebSocket push
// (Standard). null on any vehicle with no linked device, which is most of
// the fleet today — main.js treats that as a no-op, same shape as
// announceLink.js's own "not commissioned" no-op.
export async function fetchLinkedAnnounceDeviceId(vehicleId) {
  if (!vehicleId) return null;
  // A direct REST SELECT here always returns zero rows under RLS -- the only
  // anon read policy on announce_devices (device_self) requires the caller to
  // already carry the target device's own device_id claim, which the driver
  // (looking the device up, not authenticating as it) never has. RPC instead,
  // same pattern as link/unlink below.
  try {
    return await rpc('get_linked_announce_device_id', { p_vehicle_id: vehicleId });
  } catch {
    return null;
  }
}

// Fire-and-forget push of the Driver's already-computed schedule/state to a
// linked Announce Lite device, via Supabase instead of the Controller
// WebSocket. schedule/state are independently optional (see
// update_announce_device_state's coalesce behaviour) since main.js pushes
// them on different cadences.
export async function pushAnnounceDeviceState(deviceId, schedule, state) {
  return rpc('update_announce_device_state', {
    p_device_id: deviceId,
    p_schedule:  schedule ?? null,
    p_state:     state ?? null,
  });
}
