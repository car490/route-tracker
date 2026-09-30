// src/announceSoloAutopilot.test.js
//
// BusOps Announce Solo — integration test for startSoloAutopilot's
// journey-start/completion orchestration. scheduleAutopilot.js's own pure
// matching logic (findScheduleMatch/isWithinDepartureWakeWindow/
// isJourneyComplete) is covered separately in tests/scheduleAutopilot.test.js;
// this file covers the wiring around it: a real bug found in code review
// where a completed Solo journey never signalled onJourneyEnd, leaving its
// sign visible over the idle screen (onboard.js) until the next journey
// started — the departure-relative wake-window gating that keeps a Solo
// device from polling its own GPS outside a candidate's own scheduled
// departure window — and a live bug (2026-09-04) where the tracker could
// freeze at nextStopIndex=0 for the rest of a journey.
//
// GPS tracking (announceGps.js) and speech (announceSpeech.js) are both
// side-effecting and mocked out — same idiom as announceLink.test.js's
// stubbed WebSocket/localStorage — so only announceSoloAutopilot.js's own
// orchestration is under test.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./announceGps.js', () => ({ startAnnounceGpsTracking: vi.fn() }));
vi.mock('./announceSpeech.js', () => ({ speakState: vi.fn() }));

import { startAnnounceGpsTracking } from './announceGps.js';
import { speakState } from './announceSpeech.js';
import { startSoloAutopilot } from './announceSoloAutopilot.js';

// Returns a chainable, thenable query-builder stub matching however much of
// the real supabase-js surface fetchCandidateDepartures/fetchDepartureDetails
// actually call (select/in/eq/order) — resolves to { data, error: null }
// however it's awaited, regardless of chain shape.
function chainable(data) {
  const obj = {
    select: () => obj,
    in: () => obj,
    eq: () => obj,
    order: () => obj,
    then: (resolve) => resolve({ data, error: null }),
  };
  return obj;
}

// Fails (returns { data: null, error }) on its first `failCount` awaits, then
// resolves with `data` from then on — for exercising the boot-time
// candidate-fetch retry (refreshCandidates) added after the first beta test
// found a failed boot-time fetch was never retried.
function flakyChainable(data, failCount) {
  let calls = 0;
  const obj = {
    select: () => obj,
    in: () => obj,
    eq: () => obj,
    order: () => obj,
    then: (resolve) => {
      calls += 1;
      if (calls <= failCount) return resolve({ data: null, error: new Error('network error') });
      return resolve({ data, error: null });
    },
  };
  return obj;
}

const DEPOT = { lat: 52.9, lon: -0.6 };

// One departure, two stops — enough to exercise start -> final-stop
// completion without needing a longer route. days_of_week (ISO dow,
// 1=Mon..7=Sun) runs Mon-Fri — 2026-08-24 (the test fixture date below) is
// a Monday.
const SCHEDULE_ROWS = [
  {
    departure_id: 'dep-1', service_code: 'S125S', display_name: 'Depot',
    lat: DEPOT.lat, lon: DEPOT.lon, scheduled_time: '08:00:00', sequence: 1,
    stop_type: 'timing_point', timetable_stop_id: 'ts-1', stop_id: 'stop-1',
    days_of_week: [1, 2, 3, 4, 5],
  },
  {
    departure_id: 'dep-1', service_code: 'S125S', display_name: 'College',
    lat: 52.95, lon: -0.5, scheduled_time: '08:30:00', sequence: 2,
    stop_type: 'timing_point', timetable_stop_id: 'ts-2', stop_id: 'stop-2',
    days_of_week: [1, 2, 3, 4, 5],
  },
];

// A plain thenable, NOT a real Promise instance -- deliberately matching the
// real vendored @supabase/supabase-js query builder's shape (awaitable, but
// no .catch()/.finally() of its own). A mock rpc() that returned real
// Promise.resolve(...) here would have hidden a real bug found via live
// testing, 2026-09-01: announceSoloAutopilot.js used to call
// `client.rpc(...).catch(...)` directly, which threw
// "client.rpc(...).catch is not a function" against the real client.
function thenableOnly(value) {
  return { then: (resolve) => resolve(value) };
}

function makeClient() {
  // recordStopTimes is a stable spy for every rpc('record_journey_stop_times')
  // call on this client instance, called as (p_rows, p_journey_id) and exposed
  // on the returned object so tests can assert on it directly. A direct write
  // to journey_stop_times is refused for anon, so the stub has no table for it.
  const recordStopTimes = vi.fn(() => thenableOnly({ data: null, error: null }));
  return {
    from: vi.fn((table) => {
      if (table === 'schedule_view') return chainable(SCHEDULE_ROWS);
      if (table === 'service_exceptions') return chainable([]);
      if (table === 'term_dates') return chainable([]);
      throw new Error(`unexpected table in test stub: ${table}`);
    }),
    rpc: vi.fn((name, args) => {
      if (name === 'record_journey_stop_times') return recordStopTimes(args.p_rows, args.p_journey_id);
      if (name === 'get_or_create_manual_journey') {
        return thenableOnly({ data: [{ journey_id: 'jrn-1' }], error: null });
      }
      return thenableOnly({ data: null, error: null });
    }),
    recordStopTimes,
  };
}

const BASE_DEVICE_ROW = {
  id: 'device-1',
  candidate_departure_ids: ['dep-1'],
  terminus_radius_m: 150,
  match_window_before_min: 15,
  match_window_after_min: 30,
  testing_mode: false,
};

async function flush() {
  // Each fetch* helper is a couple of chained `await`s deep — several
  // microtask turns are enough to drain them without needing real timers.
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

describe('startSoloAutopilot', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    startAnnounceGpsTracking.mockReset();
  });

  it('starts a journey once matched, then calls onJourneyEnd (not just the idle callback) on completion, after the post-journey hold delay', async () => {
    vi.setSystemTime(new Date(2026, 7, 24, 8, 0, 0)); // Monday 08:00 — inside dep-1's own wake window (07:45-08:30)
    const getCurrentPosition = vi.fn((success) => success({ coords: { latitude: DEPOT.lat, longitude: DEPOT.lon } }));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    vi.stubGlobal('crypto', { randomUUID: () => 'client-generated-id' });

    let onUpdate;
    startAnnounceGpsTracking.mockImplementation((opts) => {
      onUpdate = opts.onUpdate;
      return { stop: vi.fn(), jumpToStop: vi.fn() };
    });

    const client = makeClient();
    const onSchedule = vi.fn();
    const onState = vi.fn();
    const onIdleNextDeparture = vi.fn();
    const onJourneyEnd = vi.fn();

    startSoloAutopilot(client, BASE_DEVICE_ROW, { onSchedule, onState, onIdleNextDeparture, onJourneyEnd });
    await flush();

    // Idle poll tick — within the geofence and time window, so this should match and start a journey.
    await vi.advanceTimersByTimeAsync(5000);
    await flush();

    expect(onSchedule).toHaveBeenCalledTimes(1);
    expect(onSchedule.mock.calls[0][0].journeyId).toBe('jrn-1');
    expect(onJourneyEnd).not.toHaveBeenCalled();

    // Drive the mocked GPS tracker to final-stop arrival — this is what
    // isJourneyComplete/completeActiveJourney react to.
    onUpdate({ atStop: { stopIndex: 1 }, approaching: null, stopStates: [] });

    // The vehicle has actually left by now (real GPS would no longer read
    // Depot's coordinates) — without this, the idle loop's next 5s poll
    // would still be sitting inside dep-1's own start geofence and match
    // it again, which is a real "someone started another journey" case as
    // far as this module can tell, not a test bug (see completeActiveJourney's
    // activeJourney guard) — just not the scenario this test means to cover.
    getCurrentPosition.mockImplementation((success) => success({ coords: { latitude: 0, longitude: 0 } }));

    // onJourneyEnd is deliberately delayed (POST_JOURNEY_HOLD_MS, 10
    // minutes) — see completeActiveJourney's own comment — so the terminus
    // message stays on screen, and the physical screen stays awake, long
    // enough for passengers to actually read/hear it, rather than the sign
    // flipping back to idle right behind it.
    expect(onJourneyEnd).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    await flush();

    expect(onJourneyEnd).toHaveBeenCalledTimes(1); // the fix under test: previously never called for Solo
    expect(onIdleNextDeparture).toHaveBeenCalled(); // still reports the next departure afterwards
  });

  it('writes journey_stop_times on completion -- previously Solo never wrote this table at all, so a Solo-tracked journey had no arrival/lateness record for ops to review', async () => {
    vi.setSystemTime(new Date(2026, 7, 24, 8, 0, 0));
    const getCurrentPosition = vi.fn((success) => success({ coords: { latitude: DEPOT.lat, longitude: DEPOT.lon } }));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    vi.stubGlobal('crypto', { randomUUID: () => 'client-generated-id' });

    let onUpdate;
    startAnnounceGpsTracking.mockImplementation((opts) => {
      onUpdate = opts.onUpdate;
      return { stop: vi.fn(), jumpToStop: vi.fn() };
    });

    const client = makeClient();
    startSoloAutopilot(client, BASE_DEVICE_ROW, {
      onSchedule: vi.fn(), onState: vi.fn(), onIdleNextDeparture: vi.fn(), onJourneyEnd: vi.fn(),
    });
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    await flush();

    const arrivedAt = new Date(2026, 7, 24, 8, 31, 0);
    // Final-stop arrival with real per-stop state this time (the other
    // completion test above uses stopStates: [] since it only cares about
    // onJourneyEnd timing) -- this is what completeActiveJourney reads to
    // build the upload.
    onUpdate({
      atStop: { stopIndex: 1 },
      approaching: null,
      stopStates: [
        { status: 'departed', arrivedAt: new Date(2026, 7, 24, 8, 0, 30) },
        { status: 'arrived', arrivedAt },
      ],
    });
    await flush();

    expect(client.recordStopTimes).toHaveBeenCalledTimes(1);
    const [rows, journeyId] = client.recordStopTimes.mock.calls[0];
    expect(rows).toEqual([
      { journey_id: 'jrn-1', timetable_stop_id: 'ts-1', arrived_at: new Date(2026, 7, 24, 8, 0, 30).toISOString(), visit_status: 'visited' },
      { journey_id: 'jrn-1', timetable_stop_id: 'ts-2', arrived_at: arrivedAt.toISOString(), visit_status: 'visited' },
    ]);
    expect(journeyId).toBe('jrn-1');
  });

  it('confirms the vehicle at stop 0 immediately on match, so tracking never freezes waiting for the tighter 50m street-stop geofence', async () => {
    // Regression for a live bug found 2026-09-04: Solo matches at
    // terminus_radius_m (150m default, deliberately loose for a depot/
    // terminus forecourt) but shared/gps.js only ever sets hasReachedStart
    // (required for any arrival/approach/forward-match detection) once the
    // vehicle physically enters GEOFENCE_RADIUS_M (50m) of stop 0's exact
    // coordinates. A vehicle matched at, say, 120m from stop 0 could
    // legitimately never enter that tighter 50m ring, freezing the tracker
    // at nextStopIndex=0 for the rest of the journey — no announcements,
    // no visual progress, for hours. The fix: jumpToStop(0) right after the
    // tracker starts, confirming position the same way a manual override
    // would.
    vi.setSystemTime(new Date(2026, 7, 24, 8, 0, 0));
    const getCurrentPosition = vi.fn((success) => success({ coords: { latitude: DEPOT.lat, longitude: DEPOT.lon } }));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    vi.stubGlobal('crypto', { randomUUID: () => 'client-generated-id' });

    const jumpToStop = vi.fn();
    startAnnounceGpsTracking.mockImplementation(() => ({ stop: vi.fn(), jumpToStop }));

    const client = makeClient();
    startSoloAutopilot(client, BASE_DEVICE_ROW, {
      onSchedule: vi.fn(), onState: vi.fn(), onIdleNextDeparture: vi.fn(), onJourneyEnd: vi.fn(),
    });
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    await flush();

    expect(jumpToStop).toHaveBeenCalledTimes(1);
    expect(jumpToStop).toHaveBeenCalledWith(0);
  });

  // Owner decision 2026-09-29, after the first live run: outside the wake
  // window the Solo shows the idle screen (branding) with NO next-departure
  // line, not a blank screen. The screen now follows the tablet's power
  // (stay awake while powered), so a blank page was a lit white panel that
  // looked broken, and the page could never switch a sleeping screen back on
  // anyway (a wake lock only keeps a screen on). No departure line outside
  // the window because reportNextDeparture() works from time of day only and
  // would promise a departure on a day with no service.
  it('does not poll GPS at all outside the wake window, and shows idle branding with no next-departure line', async () => {
    vi.setSystemTime(new Date(2026, 7, 24, 12, 0, 0)); // Monday noon — well outside dep-1's 07:45-08:30 window
    const getCurrentPosition = vi.fn();
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });

    const onIdleNextDeparture = vi.fn();
    const onSleep = vi.fn();
    const client = makeClient();
    startSoloAutopilot(client, BASE_DEVICE_ROW, { onSchedule: vi.fn(), onState: vi.fn(), onIdleNextDeparture, onJourneyEnd: vi.fn(), onSleep });
    await flush();

    await vi.advanceTimersByTimeAsync(5000);

    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(onIdleNextDeparture).toHaveBeenCalledTimes(1);
    expect(onIdleNextDeparture).toHaveBeenCalledWith(null);
    expect(onSleep).not.toHaveBeenCalled();
  });

  it('does not poll GPS at all when no candidate departures are configured, and shows idle branding with no next-departure line', async () => {
    vi.setSystemTime(new Date(2026, 7, 24, 8, 0, 0)); // would be inside dep-1's window, if it were configured
    const getCurrentPosition = vi.fn();
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });

    const onIdleNextDeparture = vi.fn();
    const onSleep = vi.fn();
    const client = makeClient();
    startSoloAutopilot(client, { ...BASE_DEVICE_ROW, candidate_departure_ids: [] }, {
      onSchedule: vi.fn(), onState: vi.fn(), onIdleNextDeparture, onJourneyEnd: vi.fn(), onSleep,
    });
    await flush();

    await vi.advanceTimersByTimeAsync(5000);

    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(onIdleNextDeparture).toHaveBeenCalledTimes(1);
    expect(onIdleNextDeparture).toHaveBeenCalledWith(null);
    expect(onSleep).not.toHaveBeenCalled();
  });

  it('adds the next-departure line and starts polling the instant a candidate\'s wake window opens, with no restart needed', async () => {
    vi.setSystemTime(new Date(2026, 7, 24, 7, 44, 57)); // Monday 07:44:57 — 3s before dep-1's window opens (08:00 - 15min), so one 5s idle tick crosses it
    const getCurrentPosition = vi.fn((success) => success({ coords: { latitude: DEPOT.lat, longitude: DEPOT.lon } }));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });

    const onIdleNextDeparture = vi.fn();
    const onSleep = vi.fn();
    const client = makeClient();
    startSoloAutopilot(client, BASE_DEVICE_ROW, { onSchedule: vi.fn(), onState: vi.fn(), onIdleNextDeparture, onJourneyEnd: vi.fn(), onSleep });
    await flush();

    // 3s before the window: idle branding, no departure line, no GPS.
    expect(onIdleNextDeparture).toHaveBeenCalledTimes(1);
    expect(onIdleNextDeparture).toHaveBeenLastCalledWith(null);
    expect(getCurrentPosition).not.toHaveBeenCalled();

    // Crosses 07:45 on this tick — the idle loop's own applyWakeState()
    // check should catch it without anything else restarting the device.
    await vi.advanceTimersByTimeAsync(5000);

    expect(onIdleNextDeparture).toHaveBeenCalledTimes(2);
    expect(onIdleNextDeparture.mock.lastCall[0]).toEqual([expect.objectContaining({ serviceCode: expect.any(String) })]);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1); // and started polling GPS the same tick
    expect(onSleep).not.toHaveBeenCalled();
  });

  it('speaks the approach announcement once per stop, not on every GPS tick — first beta test feedback', async () => {
    vi.setSystemTime(new Date(2026, 7, 24, 8, 0, 0));
    const getCurrentPosition = vi.fn((success) => success({ coords: { latitude: DEPOT.lat, longitude: DEPOT.lon } }));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    vi.stubGlobal('crypto', { randomUUID: () => 'client-generated-id' });

    let onUpdate;
    startAnnounceGpsTracking.mockImplementation((opts) => {
      onUpdate = opts.onUpdate;
      return { stop: vi.fn(), jumpToStop: vi.fn() };
    });

    const client = makeClient();
    startSoloAutopilot(client, BASE_DEVICE_ROW, {
      onSchedule: vi.fn(), onState: vi.fn(), onIdleNextDeparture: vi.fn(), onJourneyEnd: vi.fn(),
    });
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    await flush();

    speakState.mockClear(); // drop the ROUTE_START call fired by journey start itself

    // Three consecutive GPS ticks all reporting "still approaching stop 1" —
    // gps.js's real status stays 'approaching' for the whole approach
    // window, not just one tick, so this is the realistic shape of the bug.
    onUpdate({ atStop: null, approaching: { stopIndex: 1 }, stopStates: [] });
    onUpdate({ atStop: null, approaching: { stopIndex: 1 }, stopStates: [] });
    onUpdate({ atStop: null, approaching: { stopIndex: 1 }, stopStates: [] });

    expect(speakState).toHaveBeenCalledTimes(1);
  });

  it('retries a failed boot-time candidate-departures fetch instead of staying dormant all day', async () => {
    vi.setSystemTime(new Date(2026, 7, 24, 8, 0, 0)); // inside dep-1's window, once it's actually loaded
    const getCurrentPosition = vi.fn((success) => success({ coords: { latitude: DEPOT.lat, longitude: DEPOT.lon } }));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });

    // Built once, outside the `from` factory — the failure count must
    // persist across the two separate `client.from(...)` calls
    // (fetchCandidateDepartures re-calls .from() on each retry, same as the
    // real supabase-js query builder would), not reset on every call.
    const flakySchedule = flakyChainable(SCHEDULE_ROWS, 1);
    const client = {
      from: vi.fn((table) => {
        // Fails once — simulating the transient boot-time connectivity blip
        // reported in the first beta test — then succeeds on retry.
        if (table === 'schedule_view') return flakySchedule;
        if (table === 'service_exceptions') return chainable([]);
        if (table === 'term_dates') return chainable([]);
        throw new Error(`unexpected table in test stub: ${table}`);
      }),
      rpc: vi.fn(() => thenableOnly({ data: null, error: null })),
    };

    const onIdleNextDeparture = vi.fn();
    const onSleep = vi.fn();
    startSoloAutopilot(client, BASE_DEVICE_ROW, {
      onSchedule: vi.fn(), onState: vi.fn(), onIdleNextDeparture, onJourneyEnd: vi.fn(), onSleep,
    });
    await flush();

    // Before the retry fires: the failed fetch must not have been silently
    // treated as "no candidates configured" — that would show the sleep
    // screen and never retry again, exactly the bug this fix closes.
    expect(onSleep).not.toHaveBeenCalled();
    expect(onIdleNextDeparture).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3000); // BOOT_FETCH_RETRY_MS — the retry succeeds this time
    await flush();

    expect(onIdleNextDeparture).toHaveBeenCalled(); // woke up once the retried fetch actually landed
    expect(onSleep).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000); // next idle poll tick
    expect(getCurrentPosition).toHaveBeenCalled(); // and is actually polling GPS, not stuck dormant
  });
});

// ── Power cut and no signal (docs/HARDWARE.md "Power loss and first boot") ──
// Owner-approved 2026-09-28: Solo saves its trip as it runs and carries it
// on after a restart from a GPS-picked stop (no driver to confirm one),
// saying "The next stop is X" once; queues starts and uploads made with no
// signal; and starts from an offline copy of its departures.

import { readCheckpoint } from '../../shared/journeyCheckpoint.js';
import { SOLO_CHECKPOINT_KEY } from './announceSoloAutopilot.js';
import { QUEUE_KEY } from './soloTripQueue.js';
import { saveCandidates, saveDepartureDetails } from './soloOfflineCache.js';
import { ANNOUNCE_STATES } from '../../shared/announceStates.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}

// Three stops on a straight road, ~1.1 km apart.
const ROUTE = [
  { name: 'Depot', lat: 52.90, lon: -0.60, time: '08:00', stop_type: 'timing_point', timetable_stop_id: 'ts-1', stop_id: 'stop-1' },
  { name: 'Market Place', lat: 52.91, lon: -0.60, time: '08:10', stop_type: 'timing_point', timetable_stop_id: 'ts-2', stop_id: 'stop-2' },
  { name: 'College', lat: 52.92, lon: -0.60, time: '08:20', stop_type: 'timing_point', timetable_stop_id: 'ts-3', stop_id: 'stop-3' },
];

function seedSavedTrip(storage, { savedAt, nextStopIndex = 1, stopRows } = {}) {
  storage.setItem(SOLO_CHECKPOINT_KEY, JSON.stringify({
    journeyId: 'jrn-saved',
    launch: { allStops: ROUTE, serviceCode: 'S125S', departureId: 'dep-1', startedAt: new Date(savedAt.getTime() - 15 * 60000).toISOString() },
    stopRows: stopRows ?? [{ journey_id: 'jrn-saved', timetable_stop_id: 'ts-1', arrived_at: '2026-08-24T07:00:00.000Z', visit_status: 'visited' }],
    nextStopIndex,
    savedAt: savedAt.toISOString(),
  }));
}

// A client whose requests all fail the way supabase-js reports no signal.
function offlineClient() {
  const fail = () => thenableOnly({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } });
  const failing = () => {
    const obj = { select: () => obj, in: () => obj, eq: () => obj, order: () => obj, then: (r) => r({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } }) };
    return obj;
  };
  const recordStopTimes = vi.fn(fail);
  return {
    from: vi.fn(() => failing()),
    rpc: vi.fn((name, args) => (name === 'record_journey_stop_times' ? recordStopTimes(args.p_rows, args.p_journey_id) : fail())),
    recordStopTimes,
  };
}

const at = (lat, lon, accuracy = 10) => ({ coords: { latitude: lat, longitude: lon, accuracy } });

describe('startSoloAutopilot — power cut and no signal', () => {
  let storage;
  beforeEach(() => {
    vi.useFakeTimers();
    storage = memoryStorage();
    speakState.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    startAnnounceGpsTracking.mockReset();
  });

  it('saves the trip on the tablet as it runs', async () => {
    vi.setSystemTime(new Date(2026, 7, 24, 8, 0, 0));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: vi.fn((ok) => ok(at(DEPOT.lat, DEPOT.lon))) } });
    vi.stubGlobal('crypto', { randomUUID: () => 'client-generated-id' });
    let onUpdate;
    startAnnounceGpsTracking.mockImplementation((opts) => { onUpdate = opts.onUpdate; return { stop: vi.fn(), jumpToStop: vi.fn() }; });

    startSoloAutopilot(makeClient(), BASE_DEVICE_ROW, { onSchedule: vi.fn(), onState: vi.fn(), onIdleNextDeparture: vi.fn(), onJourneyEnd: vi.fn() }, { storage });
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    await flush();

    onUpdate({ atStop: { stopIndex: 0 }, approaching: null, nextStopIndex: 0, stopStates: [{ status: 'arrived', arrivedAt: new Date(2026, 7, 24, 8, 0, 30) }, { status: 'upcoming' }] });

    const { status, checkpoint } = readCheckpoint({ storage, now: new Date(), key: SOLO_CHECKPOINT_KEY });
    expect(status).toBe('fresh');
    expect(checkpoint.journeyId).toBe('jrn-1');
    expect(checkpoint.launch.departureId).toBe('dep-1');
    expect(checkpoint.stopRows.map((r) => r.timetable_stop_id)).toEqual(['ts-1']);
  });

  it('carries on a saved trip after a restart — outside its wake window, with no signal — from the GPS-picked stop, saying the next stop once', async () => {
    const now = new Date(2026, 7, 24, 12, 0, 0); // well outside dep-1's wake window: a trip in progress must still resume
    vi.setSystemTime(now);
    seedSavedTrip(storage, { savedAt: new Date(now.getTime() - 10 * 60000), nextStopIndex: 1 });
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: vi.fn((ok) => ok(at(52.915, -0.60))) } }); // between Market Place and College
    const jumpToStop = vi.fn();
    startAnnounceGpsTracking.mockImplementation(() => ({ stop: vi.fn(), jumpToStop }));

    const client = offlineClient();
    const onSchedule = vi.fn();
    const onState = vi.fn();
    startSoloAutopilot(client, BASE_DEVICE_ROW, { onSchedule, onState, onIdleNextDeparture: vi.fn(), onJourneyEnd: vi.fn(), onSleep: vi.fn() }, { storage });
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    await flush();

    expect(startAnnounceGpsTracking).toHaveBeenCalledTimes(1);
    expect(startAnnounceGpsTracking.mock.calls[0][0].initialStopIndex).toBe(2);
    expect(jumpToStop).toHaveBeenCalledWith(2);
    expect(onSchedule).toHaveBeenCalledWith(expect.objectContaining({ journeyId: 'jrn-saved', serviceCode: 'S125S' }));
    expect(onState).toHaveBeenCalledWith(expect.objectContaining({
      journeyId: 'jrn-saved', stateKey: ANNOUNCE_STATES.STOP_DEPARTURE,
      vars: expect.objectContaining({ nextStopName: 'College' }),
    }));
    expect(speakState).toHaveBeenCalledTimes(1);
    expect(speakState.mock.calls[0][0]).toBe(ANNOUNCE_STATES.STOP_DEPARTURE);
    expect(client.rpc).not.toHaveBeenCalledWith('get_or_create_manual_journey', expect.anything());
  });

  it('keeps stops recorded before the power cut in the trip-end upload', async () => {
    const now = new Date(2026, 7, 24, 12, 0, 0);
    vi.setSystemTime(now);
    seedSavedTrip(storage, { savedAt: new Date(now.getTime() - 10 * 60000), nextStopIndex: 1 });
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: vi.fn((ok) => ok(at(52.915, -0.60))) } });
    let onUpdate;
    startAnnounceGpsTracking.mockImplementation((opts) => { onUpdate = opts.onUpdate; return { stop: vi.fn(), jumpToStop: vi.fn() }; });

    const client = makeClient();
    startSoloAutopilot(client, BASE_DEVICE_ROW, { onSchedule: vi.fn(), onState: vi.fn(), onIdleNextDeparture: vi.fn(), onJourneyEnd: vi.fn(), onSleep: vi.fn() }, { storage });
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    await flush();

    onUpdate({
      atStop: { stopIndex: 2 }, approaching: null, nextStopIndex: 2,
      stopStates: [{ status: 'not_tracked' }, { status: 'not_tracked' }, { status: 'arrived', arrivedAt: new Date(2026, 7, 24, 12, 5, 0) }],
    });
    await vi.advanceTimersByTimeAsync(0);
    await flush();

    const [rows] = client.recordStopTimes.mock.calls[0];
    expect(rows.map((r) => [r.journey_id, r.timetable_stop_id])).toEqual([['jrn-saved', 'ts-1'], ['jrn-saved', 'ts-3']]);
    expect(client.rpc).toHaveBeenCalledWith('complete_journey', { p_journey_id: 'jrn-saved' });
    expect(readCheckpoint({ storage, now: new Date(), key: SOLO_CHECKPOINT_KEY }).status).toBe('none');
  });

  it('does not guess from a poor GPS reading; carries on once a good one arrives', async () => {
    const now = new Date(2026, 7, 24, 12, 0, 0);
    vi.setSystemTime(now);
    seedSavedTrip(storage, { savedAt: new Date(now.getTime() - 10 * 60000) });
    const getCurrentPosition = vi.fn((ok) => ok(at(52.915, -0.60, 400)));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    startAnnounceGpsTracking.mockImplementation(() => ({ stop: vi.fn(), jumpToStop: vi.fn() }));

    startSoloAutopilot(offlineClient(), BASE_DEVICE_ROW, { onSchedule: vi.fn(), onState: vi.fn(), onIdleNextDeparture: vi.fn(), onJourneyEnd: vi.fn(), onSleep: vi.fn() }, { storage });
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(startAnnounceGpsTracking).not.toHaveBeenCalled();

    getCurrentPosition.mockImplementation((ok) => ok(at(52.915, -0.60, 10)));
    await vi.advanceTimersByTimeAsync(5000);
    await flush();
    expect(startAnnounceGpsTracking).toHaveBeenCalledTimes(1);
  });

  it('a saved trip more than 2 hours old is not carried on: its stops upload, the journey is not completed', async () => {
    const now = new Date(2026, 7, 24, 12, 0, 0);
    vi.setSystemTime(now);
    seedSavedTrip(storage, { savedAt: new Date(now.getTime() - 3 * 60 * 60000) });
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: vi.fn((ok) => ok(at(52.915, -0.60))) } });
    startAnnounceGpsTracking.mockImplementation(() => ({ stop: vi.fn(), jumpToStop: vi.fn() }));

    const client = makeClient();
    startSoloAutopilot(client, BASE_DEVICE_ROW, { onSchedule: vi.fn(), onState: vi.fn(), onIdleNextDeparture: vi.fn(), onJourneyEnd: vi.fn(), onSleep: vi.fn() }, { storage });
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    await flush();

    expect(startAnnounceGpsTracking).not.toHaveBeenCalled();
    expect(client.recordStopTimes).toHaveBeenCalledTimes(1);
    expect(client.recordStopTimes.mock.calls[0][0][0].journey_id).toBe('jrn-saved');
    expect(client.rpc).not.toHaveBeenCalledWith('complete_journey', expect.anything());
    expect(readCheckpoint({ storage, now, key: SOLO_CHECKPOINT_KEY }).status).toBe('none');
  });

  it('with no signal, starts from the offline copy of its departures, on a tablet-made journey id, and queues the start', async () => {
    vi.setSystemTime(new Date(2026, 7, 24, 8, 0, 0));
    const candidateRows = { candidates: [{
      departureId: 'dep-1', serviceCode: 'S125S', firstStopLat: DEPOT.lat, firstStopLon: DEPOT.lon, departureTime: '08:00',
      daysOfWeek: [1, 2, 3, 4, 5], schoolTermTime: false, removedDates: [], addedDates: [],
    }], termDateRanges: [] };
    saveCandidates(['dep-1'], candidateRows, { storage, now: new Date() });
    saveDepartureDetails('dep-1', { serviceCode: 'S125S', allStops: ROUTE }, { storage, now: new Date() });
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: vi.fn((ok) => ok(at(DEPOT.lat, DEPOT.lon))) } });
    vi.stubGlobal('crypto', { randomUUID: () => 'client-generated-id' });
    startAnnounceGpsTracking.mockImplementation(() => ({ stop: vi.fn(), jumpToStop: vi.fn() }));

    const onSchedule = vi.fn();
    const onIdleNextDeparture = vi.fn();
    startSoloAutopilot(offlineClient(), BASE_DEVICE_ROW, { onSchedule, onState: vi.fn(), onIdleNextDeparture, onJourneyEnd: vi.fn(), onSleep: vi.fn() }, { storage });
    await flush();
    expect(onIdleNextDeparture).toHaveBeenCalled(); // woke from the copy, not stuck retrying

    await vi.advanceTimersByTimeAsync(5000);
    await flush();

    expect(onSchedule).toHaveBeenCalledWith(expect.objectContaining({ journeyId: 'client-generated-id' }));
    const queued = JSON.parse(storage.getItem(QUEUE_KEY));
    expect(queued).toEqual([{ type: 'start', journeyId: 'client-generated-id', departureId: 'dep-1' }]);
  });

  it('a failed trip-end upload is kept and sent on the next retry', async () => {
    vi.setSystemTime(new Date(2026, 7, 24, 8, 0, 0));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: vi.fn((ok) => ok(at(DEPOT.lat, DEPOT.lon))) } });
    vi.stubGlobal('crypto', { randomUUID: () => 'client-generated-id' });
    let onUpdate;
    startAnnounceGpsTracking.mockImplementation((opts) => { onUpdate = opts.onUpdate; return { stop: vi.fn(), jumpToStop: vi.fn() }; });

    const client = makeClient();
    let uploadOnline = false;
    client.recordStopTimes.mockImplementation(() => thenableOnly(uploadOnline
      ? { data: null, error: null }
      : { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } }));
    startSoloAutopilot(client, BASE_DEVICE_ROW, { onSchedule: vi.fn(), onState: vi.fn(), onIdleNextDeparture: vi.fn(), onJourneyEnd: vi.fn(), onSleep: vi.fn() }, { storage });
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    await flush();

    onUpdate({ atStop: { stopIndex: 1 }, approaching: null, nextStopIndex: 1, stopStates: [{ status: 'departed', arrivedAt: new Date() }, { status: 'arrived', arrivedAt: new Date() }] });
    await flush();
    expect(JSON.parse(storage.getItem(QUEUE_KEY))).toHaveLength(1);

    uploadOnline = true;
    await vi.advanceTimersByTimeAsync(60 * 1000);
    await flush();
    expect(JSON.parse(storage.getItem(QUEUE_KEY))).toEqual([]);
    expect(client.rpc).toHaveBeenCalledWith('complete_journey', { p_journey_id: 'jrn-1' });
  });
});

describe('startSoloAutopilot — slow network', () => {
  let storage;
  beforeEach(() => {
    vi.useFakeTimers();
    storage = memoryStorage();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    startAnnounceGpsTracking.mockReset();
  });

  // A departure's stops query that never answers (supabase-js retries a
  // failed read for several seconds before giving up), while the candidate
  // list answers normally.
  function slowDetailsClient() {
    const client = makeClient();
    const base = client.from.getMockImplementation();
    client.from.mockImplementation((table) => {
      if (table !== 'schedule_view') return base(table);
      const obj = {
        select: () => obj, in: () => { obj.isCandidates = true; return obj; }, eq: () => obj, order: () => obj,
        then: (resolve) => (obj.isCandidates ? resolve({ data: SCHEDULE_ROWS, error: null }) : undefined), // never resolves
      };
      return obj;
    });
    return client;
  }

  it('never starts a second journey for the same departure while the first is still being set up', async () => {
    vi.setSystemTime(new Date(2026, 7, 24, 8, 0, 0));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: vi.fn((ok) => ok(at(DEPOT.lat, DEPOT.lon))) } });
    vi.stubGlobal('crypto', { randomUUID: () => 'client-generated-id' });
    const tryAgain = vi.fn();
    const client = slowDetailsClient();
    client.rpc.mockImplementation(() => { tryAgain(); return thenableOnly({ data: [{ journey_id: 'jrn-1' }], error: null }); });
    startAnnounceGpsTracking.mockImplementation(() => ({ stop: vi.fn(), jumpToStop: vi.fn() }));

    startSoloAutopilot(client, BASE_DEVICE_ROW, { onSchedule: vi.fn(), onState: vi.fn(), onIdleNextDeparture: vi.fn(), onJourneyEnd: vi.fn() }, { storage });
    await flush();
    await vi.advanceTimersByTimeAsync(5000); // first match: stuck fetching stops
    await vi.advanceTimersByTimeAsync(5000); // second tick while still stuck
    await vi.advanceTimersByTimeAsync(5000);
    await flush();

    const readsSent = client.from.mock.calls.filter(([t]) => t === 'schedule_view').length;
    // One candidate-list read, one warm-up read, one stops read for the match: no second match.
    expect(readsSent).toBeLessThanOrEqual(3);
  });

  it('starts at once from the saved copy of a departure\'s stops, without waiting on the network', async () => {
    vi.setSystemTime(new Date(2026, 7, 24, 8, 0, 0));
    saveDepartureDetails('dep-1', { serviceCode: 'S125S', allStops: ROUTE }, { storage, now: new Date() });
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: vi.fn((ok) => ok(at(DEPOT.lat, DEPOT.lon))) } });
    vi.stubGlobal('crypto', { randomUUID: () => 'client-generated-id' });
    startAnnounceGpsTracking.mockImplementation(() => ({ stop: vi.fn(), jumpToStop: vi.fn() }));
    const onSchedule = vi.fn();

    startSoloAutopilot(slowDetailsClient(), BASE_DEVICE_ROW, { onSchedule, onState: vi.fn(), onIdleNextDeparture: vi.fn(), onJourneyEnd: vi.fn() }, { storage });
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    await flush();

    expect(onSchedule).toHaveBeenCalledTimes(1);
    expect(onSchedule.mock.calls[0][0].stops.map((s) => s.name)).toEqual(['Depot', 'Market Place', 'College']);
  });
});

// ── Screen power (owner, 2026-09-30; screenPower/) ──────────────────────────
// The tablet is on a permanent supply, so the sign switches its own screen
// through Fully Kiosk: on from 30 min before each running journey's first
// stop to 15 min after its last, and during any trip; off otherwise. dep-1
// runs Mon-Fri 08:00 -> 08:30, so its screen window is 07:30 -> 08:45.

describe('startSoloAutopilot — screen power', () => {
  let screen;
  let log;
  beforeEach(() => {
    vi.useFakeTimers();
    screen = { available: () => true, turnOn: vi.fn(() => true), turnOff: vi.fn(() => true) };
    log = vi.fn();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    startAnnounceGpsTracking.mockReset();
  });

  const callbacks = () => ({ onSchedule: vi.fn(), onState: vi.fn(), onIdleNextDeparture: vi.fn(), onJourneyEnd: vi.fn(), onSleep: vi.fn() });

  it('keeps the screen on while the departures cannot be loaded', async () => {
    vi.setSystemTime(new Date(2026, 7, 24, 12, 0, 0)); // outside the window, if it were known
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: vi.fn() } });
    const failing = flakyChainable(SCHEDULE_ROWS, 1000);
    const client = {
      from: vi.fn((table) => (table === 'schedule_view' ? failing : chainable([]))),
      rpc: vi.fn(() => thenableOnly({ data: null, error: null })),
    };
    startSoloAutopilot(client, BASE_DEVICE_ROW, callbacks(), { screen, log });
    await flush();
    await vi.advanceTimersByTimeAsync(5000);

    expect(screen.turnOn).toHaveBeenCalled();
    expect(screen.turnOff).not.toHaveBeenCalled();
  });

  it('switches the screen off outside the journey windows once the departures are loaded', async () => {
    vi.setSystemTime(new Date(2026, 7, 24, 12, 0, 0)); // Monday noon
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: vi.fn() } });
    startSoloAutopilot(makeClient(), BASE_DEVICE_ROW, callbacks(), { screen, log });
    await flush();

    expect(screen.turnOff).toHaveBeenCalledTimes(1);
    expect(screen.turnOn).not.toHaveBeenCalled();
  });

  it('logs the day\'s on times, using the journey\'s last stop', async () => {
    vi.setSystemTime(new Date(2026, 7, 24, 12, 0, 0));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: vi.fn() } });
    startSoloAutopilot(makeClient(), BASE_DEVICE_ROW, callbacks(), { screen, log });
    await flush();

    expect(log).toHaveBeenCalledWith('2026-08-24 screen on 07:30–08:45');
  });

  it('switches the screen on 30 minutes before the first stop, with no restart', async () => {
    vi.setSystemTime(new Date(2026, 7, 24, 7, 29, 57));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: vi.fn() } });
    startSoloAutopilot(makeClient(), BASE_DEVICE_ROW, callbacks(), { screen, log });
    await flush();
    expect(screen.turnOff).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000); // crosses 07:30

    expect(screen.turnOn).toHaveBeenCalledTimes(1);
  });

  it('keeps the screen on through a trip running late past its window, then the terminus hold, then off', async () => {
    vi.setSystemTime(new Date(2026, 7, 24, 8, 0, 0));
    const getCurrentPosition = vi.fn((ok) => ok({ coords: { latitude: DEPOT.lat, longitude: DEPOT.lon } }));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    vi.stubGlobal('crypto', { randomUUID: () => 'client-generated-id' });
    let onUpdate;
    startAnnounceGpsTracking.mockImplementation((opts) => {
      onUpdate = opts.onUpdate;
      return { stop: vi.fn(), jumpToStop: vi.fn() };
    });

    startSoloAutopilot(makeClient(), BASE_DEVICE_ROW, callbacks(), { screen, log });
    await flush();
    await vi.advanceTimersByTimeAsync(5000); // matches, trip starts
    getCurrentPosition.mockImplementation((ok) => ok({ coords: { latitude: 0, longitude: 0 } }));

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000); // 09:00 — window ended 08:45, trip still running
    expect(screen.turnOff).not.toHaveBeenCalled();

    onUpdate({ atStop: { stopIndex: 1 }, approaching: null, stopStates: [] }); // reaches the last stop
    await vi.advanceTimersByTimeAsync(9 * 60 * 1000); // inside the 10-minute terminus hold
    expect(screen.turnOff).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(screen.turnOff).toHaveBeenCalledTimes(1);
  });

  it('switches the screen back on when the Solo loop stops (e.g. the device is paired and becomes a Lite sign)', async () => {
    vi.setSystemTime(new Date(2026, 7, 24, 12, 0, 0));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: vi.fn() } });
    const handle = startSoloAutopilot(makeClient(), BASE_DEVICE_ROW, callbacks(), { screen, log });
    await flush();
    expect(screen.turnOff).toHaveBeenCalledTimes(1);

    handle.stop();

    expect(screen.turnOn).toHaveBeenCalledTimes(1);
  });

  it('re-reads its departures every hour, so Dashboard changes (term time, removed dates) reach it without a restart', async () => {
    vi.setSystemTime(new Date(2026, 7, 24, 12, 0, 0));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: vi.fn() } });
    const client = makeClient();
    startSoloAutopilot(client, BASE_DEVICE_ROW, callbacks(), { screen, log });
    await flush();
    const reads = () => client.from.mock.calls.filter(([t]) => t === 'term_dates').length;
    expect(reads()).toBe(1);

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(reads()).toBe(2);
  });

  it('keeps one retry going, not one per hourly re-read, while there is no signal', async () => {
    vi.setSystemTime(new Date(2026, 7, 24, 12, 0, 0));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: vi.fn() } });
    const client = makeClient();
    startSoloAutopilot(client, BASE_DEVICE_ROW, callbacks(), { screen, log });
    await flush();
    // Signal lost from here on.
    const failing = flakyChainable(SCHEDULE_ROWS, 1e9);
    client.from.mockImplementation((table) => (table === 'schedule_view' ? failing : chainable([])));
    const reads = () => client.from.mock.calls.filter(([t]) => t === 'schedule_view').length;

    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000); // three hourly re-reads, each failing
    const afterThreeHours = reads();
    await vi.advanceTimersByTimeAsync(60 * 1000); // one more minute: one retry, not three

    expect(reads() - afterThreeHours).toBe(1);
  });
});
