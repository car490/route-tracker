// src/audioConfigPipeline.test.js
//
// Slice 1: Fixed-Volume Audio Config
// TDD group 2 — pipeline integration (Driver PWA consumption path)
//
// RED by design: getAudioLevelForVehicle() doesn't exist yet.
// Implement in ./audioConfigPipeline.js until these pass.
// Converted to Vitest to match tests/engine.test.js and tests/geofence.test.js.

import { describe, it, expect } from 'vitest';
import { getAudioLevelForVehicle } from './audioConfigPipeline.js';

describe('getAudioLevelForVehicle', () => {
  it('uses the latest config row for a vehicle, not an average of all rows', () => {
    const configRows = [
      { vehicle_id: 'veh-001', fixed_output_level: 60, measured_at: '2026-01-01T00:00:00Z' },
      { vehicle_id: 'veh-001', fixed_output_level: 72, measured_at: '2026-06-01T00:00:00Z' },
    ];
    const level = getAudioLevelForVehicle('veh-001', configRows);
    expect(level.status).toBe('ok');
    expect(level.fixed_output_level).toBe(72);
  });

  it('falls back safely with no announcement when no config exists for the vehicle', () => {
    const level = getAudioLevelForVehicle('veh-999', []);
    expect(level.status).toBe('no_config');
    expect(level.fixed_output_level).toBe(null);
  });

  it('never returns a guessed/default numeric level when config is missing', () => {
    const level = getAudioLevelForVehicle('veh-999', []);
    expect(typeof level.fixed_output_level).not.toBe('number');
  });

  it('ignores config rows belonging to other vehicles', () => {
    const configRows = [
      { vehicle_id: 'veh-002', fixed_output_level: 80, measured_at: '2026-06-01T00:00:00Z' },
    ];
    const level = getAudioLevelForVehicle('veh-001', configRows);
    expect(level.status).toBe('no_config');
  });
});
