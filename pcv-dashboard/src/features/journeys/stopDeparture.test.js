// src/features/journeys/stopDeparture.test.js
//
// How a stop's departure is shown on the Journeys report (screen, print, CSV).
// Departures are recorded at every stop the bus leaves since 2026-10-01
// (supabase/migration_record_journey_departures.sql); older trips have none.

import { describe, it, expect } from 'vitest';
import { describeDeparture, mapReportStop } from './stopDeparture.js';

describe('describeDeparture', () => {
  it('shows the departure time and says plainly when the bus left early', () => {
    const d = describeDeparture({ departed_at: '2026-10-01T06:48:00Z', departure_variance_seconds: -130, is_early_departure: true });
    expect(d.time).toBe('07:48:00');
    expect(d.leftEarly).toBe('Yes, 2m 10s early');
  });

  it('says No when the bus left on time or late', () => {
    expect(describeDeparture({ departed_at: '2026-10-01T06:48:00Z', departure_variance_seconds: 0, is_early_departure: false }).leftEarly).toBe('No');
    expect(describeDeparture({ departed_at: '2026-10-01T06:48:00Z', departure_variance_seconds: 95, is_early_departure: false }).leftEarly).toBe('No');
  });

  it('shows a dash when no departure was recorded (last stop, skipped stop, or a trip before 1 Oct 2026)', () => {
    expect(describeDeparture({ departed_at: null })).toEqual({ time: '—', leftEarly: '—' });
  });

  it('shows the time but no verdict where lateness is not worked out (a routing point)', () => {
    const d = describeDeparture({ departed_at: '2026-10-01T06:48:00Z', departure_variance_seconds: null, is_early_departure: null });
    expect(d.time).toBe('07:48:00');
    expect(d.leftEarly).toBe('—');
  });
});

describe('mapReportStop', () => {
  it('carries the departure fields alongside the arrival', () => {
    const row = mapReportStop(
      { timetable_stop_id: 'ts-1', arrived_at: 'a', departed_at: 'd', arrival_variance_seconds: 5, is_early_arrival: false,
        departure_variance_seconds: -60, is_early_departure: true },
      { 'ts-1': { sequence: 1, stop_type: 'timing_point', scheduled_time: '07:27', name: 'Weston' } },
    );
    expect(row).toEqual({
      arrived_at: 'a',
      variance_seconds: 5,
      is_early_arrival: false,
      departed_at: 'd',
      departure_variance_seconds: -60,
      is_early_departure: true,
      timetable_stop: { sequence: 1, stop_type: 'timing_point', scheduled_time: '07:27', stop: { name: 'Weston' } },
    });
  });
});
