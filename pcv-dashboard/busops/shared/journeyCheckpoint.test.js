// shared/journeyCheckpoint.test.js
//
// A trip in progress is saved on the device as it runs, so a power cut
// mid-route loses nothing already recorded and the trip can be picked up
// again with no signal. Resumable for 2 hours after the last save, and only
// on the same UK day (owner, 2026-09-28). Pure logic, injectable
// storage/clock — same conventions as localStore.test.js.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  readCheckpoint, clearCheckpoint, mergeStopRows, suggestedResumeIndex,
  createCheckpointRecorder, CHECKPOINT_KEY, CHECKPOINT_MAX_AGE_MS,
} from './journeyCheckpoint.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    writes: 0,
  };
}

const STOPS = [
  { name: 'A', time: '08:00', timetable_stop_id: 'ts-a', lat: 1, lon: 1 },
  { name: 'B', time: '08:10', timetable_stop_id: 'ts-b', lat: 2, lon: 2 },
  { name: 'C', time: '08:20', timetable_stop_id: 'ts-c', lat: 3, lon: 3 },
  { name: 'D', time: '08:30', timetable_stop_id: 'ts-d', lat: 4, lon: 4 },
];

const LAUNCH = {
  allStops: STOPS, driverId: 'drv-1', vehicleId: 'veh-1', serviceCode: 'S1',
  servicePeriod: 'Morning', psvairEnabled: true, accentColor: null, primaryColor: null,
};

const upcoming = () => ({ status: 'upcoming', arrivedAt: null, departedAt: null });
const arrived = (iso) => ({ status: 'arrived', arrivedAt: new Date(iso), departedAt: null });
const departed = (iso) => ({ status: 'departed', arrivedAt: new Date(iso), departedAt: new Date(iso) });

// 08:05 BST, 28 Sep 2026.
const T0 = new Date('2026-09-28T07:05:00Z');
const minutesAfter = (d, m) => new Date(d.getTime() + m * 60000);

let storage;
beforeEach(() => { storage = memoryStorage(); });

function recorder(overrides = {}) {
  return createCheckpointRecorder({
    journeyId: 'j1', launch: LAUNCH, storage, now: () => T0, ...overrides,
  });
}

describe('createCheckpointRecorder', () => {
  it('saves the trip as soon as it starts, before any stop is reached', () => {
    recorder().record({ stopStates: STOPS.map(upcoming), nextStopIndex: 0 });
    const { status, checkpoint } = readCheckpoint({ storage, now: T0 });
    expect(status).toBe('fresh');
    expect(checkpoint).toMatchObject({ journeyId: 'j1', nextStopIndex: 0, stopRows: [], launch: LAUNCH });
  });

  it('saves each arrival time as it happens', () => {
    const rec = recorder();
    rec.record({ stopStates: [departed('2026-09-28T07:01:00Z'), arrived('2026-09-28T07:11:00Z'), upcoming(), upcoming()], nextStopIndex: 1 });
    const { checkpoint } = readCheckpoint({ storage, now: T0 });
    expect(checkpoint.stopRows).toEqual([
      { journey_id: 'j1', timetable_stop_id: 'ts-a', arrived_at: '2026-09-28T07:01:00.000Z', visit_status: 'visited' },
      { journey_id: 'j1', timetable_stop_id: 'ts-b', arrived_at: '2026-09-28T07:11:00.000Z', visit_status: 'visited' },
    ]);
  });

  it('only writes to storage when something changed (not on every GPS fix)', () => {
    let writes = 0;
    const counting = { ...storage, setItem: (k, v) => { writes++; storage.setItem(k, v); } };
    const rec = recorder({ storage: counting });
    const states = [arrived('2026-09-28T07:01:00Z'), upcoming(), upcoming(), upcoming()];
    rec.record({ stopStates: states, nextStopIndex: 0 });
    rec.record({ stopStates: states, nextStopIndex: 0 });
    rec.record({ stopStates: states, nextStopIndex: 0 });
    expect(writes).toBe(1);
    rec.record({ stopStates: states, nextStopIndex: 1 });
    expect(writes).toBe(2);
  });

  it('keeps stops recorded before the power cut when the trip is resumed further on', () => {
    // First run: A and B reached, then power lost.
    recorder().record({ stopStates: [departed('2026-09-28T07:01:00Z'), arrived('2026-09-28T07:11:00Z'), upcoming(), upcoming()], nextStopIndex: 1 });

    // Resumed from C: the tracker marks A and B not_tracked.
    const resumed = recorder({ now: () => minutesAfter(T0, 20) });
    const states = [{ status: 'not_tracked' }, { status: 'not_tracked' }, arrived('2026-09-28T07:21:00Z'), upcoming()];
    resumed.record({ stopStates: states, nextStopIndex: 2 });

    expect(resumed.finalRows(states).map(r => r.timetable_stop_id)).toEqual(['ts-a', 'ts-b', 'ts-c']);
    expect(readCheckpoint({ storage, now: minutesAfter(T0, 20) }).checkpoint.stopRows).toHaveLength(3);
  });

  it('does not carry over stops from a different journey', () => {
    recorder().record({ stopStates: [arrived('2026-09-28T07:01:00Z'), upcoming(), upcoming(), upcoming()], nextStopIndex: 0 });
    const other = recorder({ journeyId: 'j2' });
    expect(other.previous).toMatchObject({ journeyId: 'j1' });
    expect(other.finalRows(STOPS.map(upcoming))).toEqual([]);
  });

  it('clear() removes the checkpoint once the trip is finished', () => {
    const rec = recorder();
    rec.record({ stopStates: STOPS.map(upcoming), nextStopIndex: 0 });
    rec.clear();
    expect(readCheckpoint({ storage, now: T0 }).status).toBe('none');
  });

  it('never throws when storage is unavailable', () => {
    const broken = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    const rec = recorder({ storage: broken });
    expect(() => rec.record({ stopStates: STOPS.map(upcoming), nextStopIndex: 0 })).not.toThrow();
    expect(() => rec.clear()).not.toThrow();
    expect(readCheckpoint({ storage: broken, now: T0 }).status).toBe('none');
  });
});

describe('readCheckpoint', () => {
  beforeEach(() => {
    recorder().record({ stopStates: [arrived('2026-09-28T07:01:00Z'), upcoming(), upcoming(), upcoming()], nextStopIndex: 1 });
  });

  it('is fresh up to 2 hours after the last save', () => {
    expect(CHECKPOINT_MAX_AGE_MS).toBe(2 * 60 * 60 * 1000);
    expect(readCheckpoint({ storage, now: minutesAfter(T0, 120) }).status).toBe('fresh');
  });

  it('is stale more than 2 hours after the last save, and keeps its stops for upload', () => {
    const { status, checkpoint } = readCheckpoint({ storage, now: minutesAfter(T0, 121) });
    expect(status).toBe('stale');
    expect(checkpoint.stopRows).toHaveLength(1);
  });

  it('is stale on a later UK day even inside 2 hours', () => {
    storage = memoryStorage();
    const lateNight = new Date('2026-09-28T22:30:00Z'); // 23:30 BST
    recorder({ now: () => lateNight }).record({ stopStates: STOPS.map(upcoming), nextStopIndex: 0 });
    expect(readCheckpoint({ storage, now: minutesAfter(lateNight, 45) }).status).toBe('stale'); // 00:15 BST next day
  });

  it('reports none when nothing is saved', () => {
    expect(readCheckpoint({ storage: memoryStorage(), now: T0 }).status).toBe('none');
  });

  it('treats corrupt or incomplete data as none and removes it', () => {
    storage.setItem(CHECKPOINT_KEY, '{nope');
    expect(readCheckpoint({ storage, now: T0 }).status).toBe('none');
    expect(storage.getItem(CHECKPOINT_KEY)).toBeNull();

    storage.setItem(CHECKPOINT_KEY, JSON.stringify({ journeyId: 'j1', savedAt: T0.toISOString() }));
    expect(readCheckpoint({ storage, now: T0 }).status).toBe('none');
  });
});

// Driver and Announce Solo each keep their own saved trip (a Solo tablet
// and a Driver tablet are different devices, but the key keeps the two
// apart on principle and in the dev 2-up demo, which runs both in one
// browser profile).
describe('separate keys', () => {
  it('a recorder with its own key never reads or overwrites the default one', () => {
    recorder().record({ stopStates: STOPS.map(upcoming), nextStopIndex: 0 });
    const solo = createCheckpointRecorder({
      journeyId: 'solo-1', launch: LAUNCH, storage, now: () => T0, key: 'solo.key',
    });
    expect(solo.previous).toBeNull();
    solo.record({ stopStates: STOPS.map(upcoming), nextStopIndex: 2 });

    expect(readCheckpoint({ storage, now: T0 }).checkpoint.journeyId).toBe('j1');
    expect(readCheckpoint({ storage, now: T0, key: 'solo.key' }).checkpoint.journeyId).toBe('solo-1');
    clearCheckpoint({ storage, key: 'solo.key' });
    expect(readCheckpoint({ storage, now: T0, key: 'solo.key' }).status).toBe('none');
    expect(readCheckpoint({ storage, now: T0 }).status).toBe('fresh');
  });
});

describe('clearCheckpoint', () => {
  it('removes the saved trip', () => {
    recorder().record({ stopStates: STOPS.map(upcoming), nextStopIndex: 0 });
    clearCheckpoint({ storage });
    expect(readCheckpoint({ storage, now: T0 }).status).toBe('none');
  });
});

describe('mergeStopRows', () => {
  const row = (id, at) => ({ journey_id: 'j1', timetable_stop_id: id, arrived_at: at, visit_status: 'visited' });

  it('keeps the first-recorded time for a stop recorded twice', () => {
    expect(mergeStopRows([row('ts-a', 'first')], [row('ts-a', 'second'), row('ts-b', 'x')]))
      .toEqual([row('ts-a', 'first'), row('ts-b', 'x')]);
  });

  it('handles missing lists', () => {
    expect(mergeStopRows(undefined, [row('ts-a', 'x')])).toEqual([row('ts-a', 'x')]);
    expect(mergeStopRows([row('ts-a', 'x')], null)).toEqual([row('ts-a', 'x')]);
  });
});

describe('suggestedResumeIndex', () => {
  it('suggests the stop the vehicle was heading for', () => {
    expect(suggestedResumeIndex({ nextStopIndex: 2, launch: LAUNCH })).toBe(2);
  });

  it('stays within the route', () => {
    expect(suggestedResumeIndex({ nextStopIndex: 9, launch: LAUNCH })).toBe(3);
    expect(suggestedResumeIndex({ nextStopIndex: -1, launch: LAUNCH })).toBe(0);
    expect(suggestedResumeIndex({ launch: LAUNCH })).toBe(0);
  });
});
