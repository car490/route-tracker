// src/audioConfigPipeline.js
//
// Slice 1: Fixed-Volume Audio Config — Driver PWA consumption path.
// Never guesses a level: if no config row exists for the vehicle, the
// announcement pipeline must stay silent rather than fall back to a default.

export function getAudioLevelForVehicle(vehicleId, configRows) {
  const rowsForVehicle = configRows.filter((row) => row.vehicle_id === vehicleId);

  if (rowsForVehicle.length === 0) {
    return { status: 'no_config', fixed_output_level: null };
  }

  const latest = rowsForVehicle.reduce((a, b) =>
    new Date(b.measured_at) > new Date(a.measured_at) ? b : a
  );

  return { status: 'ok', fixed_output_level: latest.fixed_output_level };
}
