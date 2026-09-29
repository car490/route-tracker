// src/soloTripQueue.test.js
//
// Announce Solo's upload queue: journey starts made with no signal, and
// finished (or abandoned) trips' stop times, kept on the tablet in order
// and sent when signal returns — the Solo equivalent of the Driver PWA's
// pending-start and pending-trip queues (driver/src/localStore.js).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSoloTripQueue, QUEUE_KEY } from './soloTripQueue.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}

// Same shape as the vendored supabase-js builder: awaitable, no .catch().
const thenable = (value) => ({ then: (resolve) => resolve(value) });

function makeClient({ online = true, resolvedId = null } = {}) {
  const state = { online };
  const calls = [];
  const client = {
    rpc: vi.fn((name, args) => {
      calls.push({ name, args });
      if (!state.online) return thenable({ data: null, error: { message: 'Failed to fetch' } });
      if (name === 'get_or_create_manual_journey') {
        return thenable({ data: [{ journey_id: resolvedId ?? args.p_journey_id }], error: null });
      }
      return thenable({ data: null, error: null });
    }),
    // Stop times go through record_journey_stop_times() only: a direct
    // write to journey_stop_times is refused for anon (see
    // supabase/migration_record_journey_stop_times.sql).
    from: vi.fn(() => { throw new Error('unexpected direct table write'); }),
  };
  return { client, calls, state };
}

const row = (journeyId, ts) => ({ journey_id: journeyId, timetable_stop_id: ts, arrived_at: '2026-09-28T07:00:00.000Z', visit_status: 'visited' });

let storage;
beforeEach(() => { storage = memoryStorage(); });

describe('createSoloTripQueue', () => {
  it('sends a queued start, then the trip\'s stop times and completion, in that order', async () => {
    const { client, calls } = makeClient();
    const queue = createSoloTripQueue({ client, storage });
    queue.enqueueStart({ journeyId: 'local-1', departureId: 'dep-1' });
    queue.enqueueTrip({ journeyId: 'local-1', stopRows: [row('local-1', 'ts-1')], completeJourney: true });

    await queue.flush();

    expect(calls.map((c) => c.name)).toEqual(['get_or_create_manual_journey', 'start_journey', 'record_journey_stop_times', 'complete_journey']);
    expect(calls[0].args).toEqual({ p_timetable_departure_id: 'dep-1', p_journey_id: 'local-1' });
    expect(calls[2].args).toEqual({ p_journey_id: 'local-1', p_rows: [row('local-1', 'ts-1')] });
    expect(queue.pending()).toBe(0);
  });

  it('keeps everything, in order, while there is no signal, and sends it once signal returns', async () => {
    const { client, calls, state } = makeClient({ online: false });
    const queue = createSoloTripQueue({ client, storage });
    queue.enqueueStart({ journeyId: 'local-1', departureId: 'dep-1' });
    queue.enqueueTrip({ journeyId: 'local-1', stopRows: [row('local-1', 'ts-1')], completeJourney: true });

    await queue.flush();
    expect(queue.pending()).toBe(2);
    expect(calls.map((c) => c.name)).toEqual(['get_or_create_manual_journey']); // stops at the first failure

    state.online = true;
    await queue.flush();
    expect(queue.pending()).toBe(0);
  });

  it('survives a restart (kept in storage, not memory)', async () => {
    createSoloTripQueue({ client: makeClient({ online: false }).client, storage })
      .enqueueTrip({ journeyId: 'j1', stopRows: [row('j1', 'ts-1')], completeJourney: true });

    const { client, calls } = makeClient();
    const afterRestart = createSoloTripQueue({ client, storage });
    expect(afterRestart.pending()).toBe(1);
    await afterRestart.flush();
    expect(calls.map((c) => c.name)).toEqual(['record_journey_stop_times', 'complete_journey']);
  });

  it('uploads an unfinished trip\'s stop times without marking the journey complete', async () => {
    const { client, calls } = makeClient();
    const queue = createSoloTripQueue({ client, storage });
    queue.enqueueTrip({ journeyId: 'j1', stopRows: [row('j1', 'ts-1')], completeJourney: false });
    await queue.flush();
    expect(calls.map((c) => c.name)).toEqual(['record_journey_stop_times']);
  });

  it('skips the upload when no stop was reached, but still completes the journey', async () => {
    const { client, calls } = makeClient();
    const queue = createSoloTripQueue({ client, storage });
    queue.enqueueTrip({ journeyId: 'j1', stopRows: [], completeJourney: true });
    queue.enqueueTrip({ journeyId: 'j2', stopRows: [], completeJourney: false });
    await queue.flush();
    expect(calls.map((c) => c.name)).toEqual(['complete_journey']);
    expect(queue.pending()).toBe(0);
  });

  it('when the server already has a journey for that departure, the rest of the queue follows its id', async () => {
    const { client, calls } = makeClient({ resolvedId: 'server-9' });
    const queue = createSoloTripQueue({ client, storage });
    queue.enqueueStart({ journeyId: 'local-1', departureId: 'dep-1' });
    queue.enqueueTrip({ journeyId: 'local-1', stopRows: [row('local-1', 'ts-1')], completeJourney: true });

    await queue.flush();

    expect(calls[1].args).toEqual({ p_journey_id: 'server-9' });
    expect(calls[2].args).toEqual({ p_journey_id: 'server-9', p_rows: [row('server-9', 'ts-1')] });
    expect(calls[3].args).toEqual({ p_journey_id: 'server-9' });
  });

  it('treats a thrown network error the same as an error response', async () => {
    const client = {
      rpc: vi.fn(() => { throw new TypeError('Failed to fetch'); }),
      from: vi.fn(),
    };
    const queue = createSoloTripQueue({ client, storage });
    queue.enqueueStart({ journeyId: 'local-1', departureId: 'dep-1' });
    await expect(queue.flush()).resolves.toBeUndefined();
    expect(queue.pending()).toBe(1);
  });

  it('does not run two flushes at once (no double send)', async () => {
    const { client, calls } = makeClient();
    const queue = createSoloTripQueue({ client, storage });
    queue.enqueueTrip({ journeyId: 'j1', stopRows: [], completeJourney: true });
    await Promise.all([queue.flush(), queue.flush()]);
    expect(calls.filter((c) => c.name === 'complete_journey')).toHaveLength(1);
  });

  it('treats corrupt stored data as an empty queue', () => {
    storage.setItem(QUEUE_KEY, '{nope');
    expect(createSoloTripQueue({ client: makeClient().client, storage }).pending()).toBe(0);
  });

  it('still sends when storage is unavailable (kept in memory for this session instead)', async () => {
    const broken = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    const { client, calls } = makeClient();
    const queue = createSoloTripQueue({ client, storage: broken });
    expect(() => queue.enqueueTrip({ journeyId: 'j1', stopRows: [row('j1', 'ts-1')], completeJourney: true })).not.toThrow();
    expect(queue.pending()).toBe(1);
    await queue.flush();
    expect(calls.map((c) => c.name)).toEqual(['record_journey_stop_times', 'complete_journey']);
    expect(queue.pending()).toBe(0);
  });

  it('works with no storage at all', async () => {
    const { client, calls } = makeClient();
    const queue = createSoloTripQueue({ client, storage: undefined });
    queue.enqueueTrip({ journeyId: 'j1', stopRows: [], completeJourney: true });
    await queue.flush();
    expect(calls.map((c) => c.name)).toEqual(['complete_journey']);
  });
});
