// dashboard/src/features/audio-config/validateAudioConfig.js
//
// Slice 1: Fixed-Volume Audio Config — Dashboard/admin write path.

const AMBIENT_MIN_DB = 30;
const AMBIENT_MAX_DB = 120;

export function validateAudioConfig(record) {
  const errors = [];

  if (!record.vehicle_id) errors.push('vehicle_id is required');
  if (!record.measured_by) errors.push('measured_by is required');
  if (!record.measured_at) errors.push('measured_at is required');

  if (typeof record.ambient_reading_db !== 'number' || Number.isNaN(record.ambient_reading_db)) {
    errors.push('ambient_reading_db must be a number');
  } else if (record.ambient_reading_db < AMBIENT_MIN_DB || record.ambient_reading_db > AMBIENT_MAX_DB) {
    errors.push(`ambient_reading_db out of plausible range (${AMBIENT_MIN_DB}-${AMBIENT_MAX_DB} dB)`);
  }

  return { valid: errors.length === 0, errors };
}

// PLACEHOLDER FORMULA — Annex A method not yet supplied.
export function computeFixedOutputLevel(ambientReadingDb) {
  if (typeof ambientReadingDb !== 'number' || Number.isNaN(ambientReadingDb)) {
    throw new Error('ambientReadingDb must be a number');
  }
  return ambientReadingDb + 10;
}
