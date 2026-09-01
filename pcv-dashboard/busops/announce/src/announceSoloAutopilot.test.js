// src/announceSoloAutopilot.test.js
//
// BusOps Announce Solo — integration test for startSoloAutopilot's
// journey-start/completion orchestration. scheduleAutopilot.js's own pure
// matching logic (findScheduleMatch/isWithinActiveWindow/isJourneyComplete)
// is covered separately in tests/scheduleAutopilot.test.js; this file
// covers the wiring around it: a real bug found in code review where a
// completed Solo journey never signalled onJourneyEnd, leaving its sign
// visible over the idle screen (onboard.js) until the next journey
// started — and the active-window gating that keeps a Solo device from
// polling its own GPS outside its configured days/times.
//
// GPS tracking (announceGps.js) and speech (announceSpeech.js) are both
// side-effecting and mocked out — same idiom as announceLink.test.js's
// stubbed WebSocket/localStorage — so only announceSoloAutopilot.js's own
// orchestration is under test.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./announceGps.js', () => ({ startAnnounceGpsTracking: vi.fn() }));
vi.mock('./announceSpeech.js', () => ({ speakState: vi.fn() }));

import { startAnnounceGpsTracking } from './announceGps.js';
import { startSoloAutopilot } from './announceSoloAutopilot.js';

// Returns a chainable, thenable query-builder stub matching however much of
// the real supabase-js surface fetchCandidateDepartures/fetchDepartureDetails/
// fetchActiveWindows actually call (select/in/eq/order) — resolves to
// { data, error: null } however it's awaited, regardless of chain shape.
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

const DEPOT = { lat: 52.9, lon: -0.6 };

// One departure, two stops — enough to exercise start -> final-stop
// completion without needing a longer route.
const SCHEDULE_ROWS = [
  {
    departure_id: 'dep-1', service_code: 'S125S', display_name: 'Depot',
    lat: DEPOT.lat, lon: DEPOT.lon, scheduled_time: '08:00:00', sequence: 1,
    stop_type: 'timing_point', timetable_stop_id: 'ts-1', stop_id: 'stop-1',
  },
  {
    departure_id: 'dep-1', service_code: 'S125S', display_name: 'College',
    lat: 52.95, lon: -0.5, scheduled_time: '08:30:00', sequence: 2,
    stop_type: 'timing_point', timetable_stop_id: 'ts-2', stop_id: 'stop-2',
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

function makeClient({ activeWindows = [] } = {}) {
  return {
    from: vi.fn((table) => {
      if (table === 'schedule_view') return chainable(SCHEDULE_ROWS);
      if (table === 'announce_device_active_windows') return chainable(activeWindows);
      throw new Error(`unexpected table in test stub: ${table}`);
    }),
    rpc: vi.fn((name) => {
      if (name === 'get_or_create_manual_journey') {
        return thenableOnly({ data: [{ journey_id: 'jrn-1' }], error: null });
      }
      return thenableOnly({ data: null, error: null });
    }),
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

  it('starts a journey once matched, then calls onJourneyEnd (not just the idle callback) on completion', async () => {
    vi.setSystemTime(new Date(2026, 7, 24, 8, 0, 0)); // Monday 08:00 — inside the window below
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition: vi.fn((success) => success({ coords: { latitude: DEPOT.lat, longitude: DEPOT.lon } })) },
    });
    vi.stubGlobal('crypto', { randomUUID: () => 'client-generated-id' });

    let onUpdate;
    startAnnounceGpsTracking.mockImplementation((opts) => {
      onUpdate = opts.onUpdate;
      return { stop: vi.fn() };
    });

    const client = makeClient({ activeWindows: [{ day_of_week: 0, window_start: '07:00', window_end: '10:00' }] });
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

    expect(onJourneyEnd).toHaveBeenCalledTimes(1); // the fix under test: previously never called for Solo
    expect(onIdleNextDeparture).toHaveBeenCalled(); // still reports the next departure afterwards
  });

  it('does not poll GPS at all outside its configured active windows', async () => {
    vi.setSystemTime(new Date(2026, 7, 24, 12, 0, 0)); // Monday noon — outside the window below
    const getCurrentPosition = vi.fn();
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });

    const client = makeClient({ activeWindows: [{ day_of_week: 0, window_start: '07:00', window_end: '09:00' }] });
    startSoloAutopilot(client, BASE_DEVICE_ROW, { onSchedule: vi.fn(), onState: vi.fn(), onIdleNextDeparture: vi.fn(), onJourneyEnd: vi.fn() });
    await flush();

    await vi.advanceTimersByTimeAsync(5000);

    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('does not poll GPS at all when no active windows are configured', async () => {
    vi.setSystemTime(new Date(2026, 7, 24, 8, 0, 0)); // would be inside a window, if any were configured
    const getCurrentPosition = vi.fn();
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });

    const client = makeClient({ activeWindows: [] });
    startSoloAutopilot(client, BASE_DEVICE_ROW, { onSchedule: vi.fn(), onState: vi.fn(), onIdleNextDeparture: vi.fn(), onJourneyEnd: vi.fn() });
    await flush();

    await vi.advanceTimersByTimeAsync(5000);

    expect(getCurrentPosition).not.toHaveBeenCalled();
  });
});
