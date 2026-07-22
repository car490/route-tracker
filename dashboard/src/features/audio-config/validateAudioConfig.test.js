// dashboard/src/features/audio-config/validateAudioConfig.test.js
//
// Slice 1: Fixed-Volume Audio Config
// TDD group 1 — config validation (Dashboard/admin write path)
//
// This file is RED by design: `validateAudioConfig` and `computeFixedOutputLevel`
// don't exist yet. Write the implementation in ./validateAudioConfig.js until
// these pass, then move to group 2 (pipeline integration).

import { describe, it, expect } from 'vitest';
import { validateAudioConfig, computeFixedOutputLevel } from './validateAudioConfig.js';

describe('validateAudioConfig', () => {
  const validRecord = {
    vehicle_id: 'veh-001',
    ambient_reading_db: 62.5,
    measured_at: '2026-07-18T09:00:00Z',
    measured_by: 'emp-042',
    notes: 'Depot bay 2, engine idling',
  };

  it('accepts a well-formed record', () => {
    const result = validateAudioConfig(validRecord);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects missing vehicle_id', () => {
    const { valid, errors } = validateAudioConfig({ ...validRecord, vehicle_id: undefined });
    expect(valid).toBe(false);
    expect(errors).toContain('vehicle_id is required');
  });

  it('rejects missing measured_by (no anonymous calibration entries)', () => {
    const { valid, errors } = validateAudioConfig({ ...validRecord, measured_by: undefined });
    expect(valid).toBe(false);
    expect(errors).toContain('measured_by is required');
  });

  it('rejects missing measured_at', () => {
    const { valid, errors } = validateAudioConfig({ ...validRecord, measured_at: undefined });
    expect(valid).toBe(false);
    expect(errors).toContain('measured_at is required');
  });

  // Plausible ambient dB range for a vehicle depot/road environment.
  // Bounds are a placeholder — confirm against Annex A / your calibration
  // equipment's realistic range before treating these as final.
  it('rejects ambient_reading_db below plausible range (< 30 dB)', () => {
    const { valid, errors } = validateAudioConfig({ ...validRecord, ambient_reading_db: 10 });
    expect(valid).toBe(false);
    expect(errors).toContain('ambient_reading_db out of plausible range (30-120 dB)');
  });

  it('rejects ambient_reading_db above plausible range (> 120 dB)', () => {
    const { valid, errors } = validateAudioConfig({ ...validRecord, ambient_reading_db: 140 });
    expect(valid).toBe(false);
    expect(errors).toContain('ambient_reading_db out of plausible range (30-120 dB)');
  });

  it('rejects non-numeric ambient_reading_db', () => {
    const { valid, errors } = validateAudioConfig({ ...validRecord, ambient_reading_db: 'loud' });
    expect(valid).toBe(false);
    expect(errors).toContain('ambient_reading_db must be a number');
  });

  it('collects multiple errors at once rather than stopping at the first', () => {
    const { valid, errors } = validateAudioConfig({});
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThan(1);
  });
});

describe('computeFixedOutputLevel', () => {
  // PLACEHOLDER FORMULA — Annex A method not yet supplied.
  // Currently: fixed_output_level = ambient_reading_db + 10 (simple offset).
  // Replace both this implementation and these expectations once the real
  // Annex A calculation is confirmed.
  it('derives a fixed output level from an ambient reading (placeholder formula)', () => {
    expect(computeFixedOutputLevel(62.5)).toBe(72.5);
  });

  it('throws on a non-numeric input rather than silently producing a bad level', () => {
    expect(() => computeFixedOutputLevel('loud')).toThrow();
  });
});
