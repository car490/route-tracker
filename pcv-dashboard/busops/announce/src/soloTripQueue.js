// src/soloTripQueue.js
//
// BusOps Announce Solo — upload queue kept on the tablet, so nothing Solo
// records is lost to a missing signal or a power cut. Before this, a Solo
// journey start or a trip-end upload that failed was only logged
// (announceSoloAutopilot.js's old completeActiveJourney comment).
//
// One ordered list of operations, sent oldest first, stopping at the first
// failure so a trip is never completed before its start has reached the
// server:
//   { type: 'start', journeyId, departureId }
//       a journey started with no signal, on a journey id made on the
//       tablet — the same thing the Driver PWA's manual start does offline
//       (manualSelection.js + localStore.js's pending-start queue)
//   { type: 'trip', journeyId, stopRows, completeJourney }
//       a trip's stop times; completeJourney false for a trip that was
//       never finished (saved trip past its 2-hour resume window), which
//       uploads its stops without marking the journey complete
//
// If the server already has a different journey for that departure and
// day, get_or_create_manual_journey returns that id instead, and every
// later operation (and its stop rows) is moved onto it.
//
// Holds ids and arrival times only, no token. Never throws; a failed send
// just stays queued for the next flush. If the tablet's storage can't be
// used at all (blocked, full), the queue carries on in memory for this
// session rather than dropping what it was given.

export const QUEUE_KEY = 'busops.announce.solo.queue';

// Storage first; memory when storage throws or is missing. Corrupt stored
// data reads as an empty queue.
function createStore(storage, key) {
  let memory = null;
  return {
    read() {
      if (memory) return memory;
      try {
        const parsed = JSON.parse(storage.getItem(key) ?? '[]');
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        if (err instanceof SyntaxError) return [];
        memory = [];
        return memory;
      }
    },
    write(ops) {
      if (memory) { memory = ops; return; }
      try {
        storage.setItem(key, JSON.stringify(ops));
      } catch (_) {
        memory = ops;
      }
    },
  };
}

// supabase-js reports a failed request as { error } rather than throwing,
// but a network failure can also throw — either counts as "not sent".
async function send(promiseLike) {
  const { data, error } = await promiseLike;
  if (error) throw new Error(error.message ?? 'request failed');
  return data;
}

async function sendOp(client, op) {
  if (op.type === 'start') {
    const created = await send(client.rpc('get_or_create_manual_journey', {
      p_timetable_departure_id: op.departureId,
      p_journey_id: op.journeyId,
    }));
    const resolvedId = created?.[0]?.journey_id ?? op.journeyId;
    await send(client.rpc('start_journey', { p_journey_id: resolvedId }));
    return resolvedId;
  }
  if (op.stopRows?.length) {
    // record_journey_stop_times() skips rows already stored, so a retry after
    // a failed complete_journey is safe. Not a direct upsert: anon may not
    // write the table that way (supabase/migration_record_journey_stop_times.sql).
    await send(client.rpc('record_journey_stop_times', { p_journey_id: op.journeyId, p_rows: op.stopRows }));
  }
  if (op.completeJourney) {
    await send(client.rpc('complete_journey', { p_journey_id: op.journeyId }));
  }
  return op.journeyId;
}

function moveOntoJourney(ops, fromId, toId) {
  return ops.map((op) => (op.journeyId !== fromId ? op : {
    ...op,
    journeyId: toId,
    ...(op.stopRows ? { stopRows: op.stopRows.map((r) => ({ ...r, journey_id: toId })) } : {}),
  }));
}

export function createSoloTripQueue({ client, storage = globalThis.localStorage, key = QUEUE_KEY }) {
  let inFlight = null;
  const store = createStore(storage, key);

  function enqueue(op) {
    store.write([...store.read(), op]);
  }

  async function drain() {
    for (;;) {
      const ops = store.read();
      if (!ops.length) return;
      const [op] = ops;
      let resolvedId;
      try {
        resolvedId = await sendOp(client, op);
      } catch (err) {
        console.warn('soloTripQueue: still cannot send, kept for later', op.type, op.journeyId, err?.message);
        return;
      }
      let rest = store.read().slice(1);
      if (op.type === 'start' && resolvedId !== op.journeyId) {
        console.warn(`soloTripQueue: server already had journey ${resolvedId} for this departure; moving ${op.journeyId} onto it`);
        rest = moveOntoJourney(rest, op.journeyId, resolvedId);
      }
      store.write(rest);
    }
  }

  return {
    enqueueStart: ({ journeyId, departureId }) => enqueue({ type: 'start', journeyId, departureId }),
    enqueueTrip: ({ journeyId, stopRows, completeJourney }) =>
      enqueue({ type: 'trip', journeyId, stopRows: stopRows ?? [], completeJourney: !!completeJourney }),
    pending: () => store.read().length,
    flush() {
      if (!inFlight) inFlight = drain().finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}
