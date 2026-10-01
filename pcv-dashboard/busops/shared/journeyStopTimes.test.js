import { describe, it, expect } from 'vitest';
import { buildStopTimeRows } from './journeyStopTimes.js';

const STOPS = [
  { timetable_stop_id: 'ts-1', name: 'Depot' },
  { timetable_stop_id: 'ts-2', name: 'College' },
  { timetable_stop_id: 'ts-3', name: 'High Street' },
];

describe('buildStopTimeRows', () => {
  it('builds a visited row with arrived_at for an arrived/departed stop', () => {
    const arrivedAt = new Date('2026-09-17T08:00:00Z');
    const departedAt = new Date('2026-09-17T08:01:30Z');
    const rows = buildStopTimeRows('jrn-1', [
      { status: 'arrived', arrivedAt, departedAt: null },
      { status: 'departed', arrivedAt, departedAt },
    ], STOPS.slice(0, 2));

    expect(rows).toEqual([
      { journey_id: 'jrn-1', timetable_stop_id: 'ts-1', arrived_at: arrivedAt.toISOString(), departed_at: null, visit_status: 'visited' },
      { journey_id: 'jrn-1', timetable_stop_id: 'ts-2', arrived_at: arrivedAt.toISOString(), departed_at: departedAt.toISOString(), visit_status: 'visited' },
    ]);
  });

  // Every stop the bus leaves carries its departure time (owner, 2026-10-01),
  // not only stops where it waited: "left early" at a timing point needs it.
  it('records departed_at for every departed stop, including a pass-through with no wait', () => {
    const at = new Date('2026-09-17T08:00:00Z');
    const rows = buildStopTimeRows('jrn-1', [
      { status: 'departed', arrivedAt: at, departedAt: at },
    ], STOPS.slice(0, 1));

    expect(rows[0].departed_at).toBe(at.toISOString());
  });

  it('sends no departed_at for a stop not yet left (the last stop, or still dwelling)', () => {
    const rows = buildStopTimeRows('jrn-1', [
      { status: 'arrived', arrivedAt: new Date('2026-09-17T08:00:00Z') },
    ], STOPS.slice(0, 1));

    expect(rows[0].departed_at).toBeNull();
  });

  it('records a skipped stop with visit_status set and no arrived_at', () => {
    const rows = buildStopTimeRows('jrn-1', [
      { status: 'skipped_signal', arrivedAt: null },
      { status: 'skipped_detour', arrivedAt: null },
    ], STOPS.slice(0, 2));

    expect(rows).toEqual([
      { journey_id: 'jrn-1', timetable_stop_id: 'ts-1', arrived_at: null, departed_at: null, visit_status: 'skipped_signal' },
      { journey_id: 'jrn-1', timetable_stop_id: 'ts-2', arrived_at: null, departed_at: null, visit_status: 'skipped_detour' },
    ]);
  });

  it('omits a stop with no timetable_stop_id (a routing/waypoint-only stop)', () => {
    const rows = buildStopTimeRows('jrn-1', [
      { status: 'arrived', arrivedAt: new Date() },
    ], [{ name: 'Waypoint' }]);

    expect(rows).toEqual([]);
  });

  it('omits a stop with no recorded state yet (never reached)', () => {
    const rows = buildStopTimeRows('jrn-1', [{ status: 'arrived', arrivedAt: new Date() }], STOPS);
    expect(rows).toHaveLength(1);
  });

  it('omits a stop whose status is not upload-worthy (e.g. still pending)', () => {
    const rows = buildStopTimeRows('jrn-1', [
      { status: 'pending', arrivedAt: null },
    ], STOPS.slice(0, 1));

    expect(rows).toEqual([]);
  });

  it('returns an empty array for an empty schedule', () => {
    expect(buildStopTimeRows('jrn-1', [], [])).toEqual([]);
  });
});
