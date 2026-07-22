/**
 * @jest-environment jsdom
 *
 * config.js reads window.location at module scope (IS_DEV / SUPABASE_URL),
 * so anything importing selectServiceManually transitively needs a DOM
 * global — plain Node (this project's default test environment) doesn't
 * have one. Scoped to this file only; routeData.test.js stays on the
 * faster default node environment since it never touches config.js.
 */
import { selectServiceManually } from '../src/manualSelection.js';

const RPC_NAME = 'get_or_create_manual_journey';

// Raw schedule_view row shape (display_name / scheduled_time / psvair_in_scope) —
// fetchStopsForDeparture() is what maps these to the {name, time, ...} shape
// runTracker expects. Using the mapped shape here would be testing a fake.
const fakeStopRows = [
  { timetable_stop_id: 'ts-1', stop_type: 'timing_point', scheduled_time: '08:15:00', display_name: 'High Street', lat: 52.1, lon: -0.5, sequence: 1, psvair_in_scope: false },
  { timetable_stop_id: 'ts-2', stop_type: 'routing_point', scheduled_time: '08:22:00', display_name: 'Church Road', lat: 52.2, lon: -0.6, sequence: 2, psvair_in_scope: false },
];

const mappedStops = [
  { name: 'High Street', lat: 52.1, lon: -0.5, time: '08:15', stop_type: 'timing_point', timetable_stop_id: 'ts-1' },
  { name: 'Church Road', lat: 52.2, lon: -0.6, time: '08:22', stop_type: 'routing_point', timetable_stop_id: 'ts-2' },
];

function mockFetchImplementation(overrides = {}) {
  return jest.fn(async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/rpc/')) {
      if (overrides.rpcError) {
        return { ok: false, json: async () => ({ message: overrides.rpcError }) };
      }
      // returns table(...) -> PostgREST responds with an array of rows.
      return { ok: true, json: async () => overrides.rpcResult ?? [{ journey_id: 'jrn-manual-001' }] };
    }
    if (urlStr.includes('schedule_view')) {
      return { ok: true, json: async () => overrides.stopRows ?? fakeStopRows };
    }
    throw new Error(`Unexpected fetch call in test: ${urlStr}`);
  });
}

describe('selectServiceManually', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mockFetchImplementation();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('rejects a service/variant not present in routeData rather than guessing a departure id', async () => {
    await expect(selectServiceManually('S999X', 'Morning Outbound')).rejects.toThrow(/not found/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test(`POSTs to /rpc/${RPC_NAME} with p_timetable_departure_id, not a free-text value`, async () => {
    await selectServiceManually('S116S', 'Morning Outbound');
    const rpcCall = global.fetch.mock.calls.find(([url]) => String(url).includes('/rpc/'));
    expect(rpcCall).toBeTruthy();
    const [url, opts] = rpcCall;
    expect(String(url)).toContain(`/rpc/${RPC_NAME}`);
    const body = JSON.parse(opts.body);
    expect(typeof body.p_timetable_departure_id).toBe('string');
    expect(body.p_timetable_departure_id.length).toBeGreaterThan(0);
    // Deliberately NOT asserting p_journey_date is sent — letting the DB
    // default to current_date avoids trusting the tablet's local clock.
  });

  test('fetches stops via schedule_view — same source the duty-card path uses, no duplicated stop data', async () => {
    await selectServiceManually('S116S', 'Morning Outbound');
    const stopsCall = global.fetch.mock.calls.find(([url]) => String(url).includes('schedule_view'));
    expect(stopsCall).toBeTruthy();
  });

  test("unwraps the RPC's array response correctly (returns table -> array of rows, not a bare object)", async () => {
    global.fetch = mockFetchImplementation({
      rpcResult: [{ journey_id: 'jrn-manual-002' }],
    });
    const result = await selectServiceManually('S116S', 'Morning Outbound');
    expect(result.journeyId).toBe('jrn-manual-002');
  });

  test('sources psvairEnabled from schedule_view, same as the duty-card path — not recomputed by the RPC', async () => {
    global.fetch = mockFetchImplementation({
      stopRows: fakeStopRows.map((r) => ({ ...r, psvair_in_scope: true })),
    });
    const result = await selectServiceManually('S116S', 'Morning Outbound');
    expect(result.psvairEnabled).toBe(true);
  });

  test('produces a runTracker-shaped param bag with all required fields', async () => {
    const result = await selectServiceManually('S116S', 'Morning Outbound');
    expect(result).toMatchObject({
      journeyId: 'jrn-manual-001',
      serviceCode: 'S116S',
      servicePeriod: 'Morning Outbound',
      initialStopIndex: 0,
      psvairEnabled: false,
    });
    expect(result.allStops).toEqual(mappedStops);
    expect(typeof result.onComplete).toBe('function');
  });

  test('propagates a clear error if the RPC fails, rather than producing a partial/broken param bag', async () => {
    global.fetch = mockFetchImplementation({ rpcError: 'no matching departure today' });
    await expect(selectServiceManually('S116S', 'Morning Outbound')).rejects.toThrow(/no matching departure today/);
  });

  test('does not call fetch at all before the departure id lookup succeeds (lookup fails fast, no partial requests)', async () => {
    await expect(selectServiceManually('S999X', 'Afternoon Inbound')).rejects.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
