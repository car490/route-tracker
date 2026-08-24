/**
 * @jest-environment jsdom
 *
 * config.js reads window.location at module scope (IS_DEV / SUPABASE_URL),
 * so anything importing supabaseApi.js transitively needs a DOM global —
 * plain Node (this project's default test environment) doesn't have one.
 */
import { fetchAvailableServices, fetchLocalBusVehicles, fetchCompanyName } from '../driver/src/supabaseApi.js';

// schedule_view is one row per stop, not per departure — a two-stop
// departure produces two rows with the same service_code/departure_id/
// departure_time, which fetchAvailableServices must dedupe. journey_type
// includes 'Local Bus' on all of these by default — see the
// 'not tagged Local Bus' test below for the excluded case.
const S116S_AM_ROWS = [
  { service_code: 'S116S', timetable_name: 'Morning Outbound', departure_id: 'dep-116s-am', departure_time: '08:15:00', journey_type: ['Local Bus'] },
  { service_code: 'S116S', timetable_name: 'Morning Outbound', departure_id: 'dep-116s-am', departure_time: '08:15:00', journey_type: ['Local Bus'] },
];
const S116S_PM_ROW = { service_code: 'S116S', timetable_name: 'Afternoon Inbound', departure_id: 'dep-116s-pm', departure_time: '15:30:00', journey_type: ['Local Bus'] };
const S125S_AM_ROW = { service_code: 'S125S', timetable_name: 'Morning Outbound', departure_id: 'dep-125s-am', departure_time: '07:45:00', journey_type: ['Local Bus'] };
const SCHOOL_RUN_ROW = { service_code: 'GilesA', timetable_name: 'Morning Outbound', departure_id: 'dep-giles-am', departure_time: '08:00:00', journey_type: ['Contract Schools'] };

describe('fetchAvailableServices', () => {
  const originalFetch = global.fetch;

  // The cache fallback (src/localStore.js) writes to the real localStorage
  // this jsdom environment provides, which otherwise persists across every
  // test in this file — clear it so "no cache yet" tests below aren't
  // seeing a previous test's successfully-cached result.
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('queries schedule_view', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [] }));
    await fetchAvailableServices();
    const [url] = global.fetch.mock.calls[0];
    expect(String(url)).toContain('schedule_view');
  });

  test('groups departures under their service_code', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [...S116S_AM_ROWS, S116S_PM_ROW, S125S_AM_ROW] }));
    const services = await fetchAvailableServices();
    expect(Object.keys(services).sort()).toEqual(['S116S', 'S125S']);
  });

  test('dedupes multiple stop rows from the same departure into one entry', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => S116S_AM_ROWS }));
    const services = await fetchAvailableServices();
    expect(Object.keys(services.S116S)).toHaveLength(1);
  });

  test('labels each period with the departure time, so same-named runs at different times stay distinct', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [...S116S_AM_ROWS, S116S_PM_ROW] }));
    const services = await fetchAvailableServices();
    expect(services.S116S['Morning Outbound (08:15)']).toBe('dep-116s-am');
    expect(services.S116S['Afternoon Inbound (15:30)']).toBe('dep-116s-pm');
  });

  test('throws on a non-ok response rather than returning an empty/partial list silently', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500 }));
    await expect(fetchAvailableServices()).rejects.toThrow(/500/);
  });

  test('excludes routes not tagged Local Bus (school contracts, private hire, excursions — still ops-assigned via duty cards)', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [...S116S_AM_ROWS, SCHOOL_RUN_ROW] }));
    const services = await fetchAvailableServices();
    expect(Object.keys(services)).toEqual(['S116S']);
  });

  test('falls back to the last successful result when Supabase is unreachable', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => S116S_AM_ROWS }));
    const liveServices = await fetchAvailableServices();

    global.fetch = jest.fn(async () => { throw new TypeError('Failed to fetch'); });
    const fallbackServices = await fetchAvailableServices();
    expect(fallbackServices).toEqual(liveServices);
  });

  test('still throws when there is no cache to fall back to', async () => {
    global.fetch = jest.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(fetchAvailableServices()).rejects.toThrow(/failed to fetch/i);
  });
});

describe('fetchLocalBusVehicles', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const FAKE_VEHICLES = [
    { id: 'veh-1', registration: 'AB12 CDE', fleet_number: '7' },
    { id: 'veh-2', registration: 'XY99 ZZZ', fleet_number: null },
  ];

  test('queries the vehicles table', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [] }));
    await fetchLocalBusVehicles();
    const [url] = global.fetch.mock.calls[0];
    expect(String(url)).toContain('/rest/v1/vehicles');
  });

  test('returns the rows as-is — filtering to active/Local Bus is the RLS policy\'s job, not this function\'s', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => FAKE_VEHICLES }));
    const vehicles = await fetchLocalBusVehicles();
    expect(vehicles).toEqual(FAKE_VEHICLES);
  });

  test('throws on a non-ok response rather than returning an empty/partial list silently', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500 }));
    await expect(fetchLocalBusVehicles()).rejects.toThrow(/500/);
  });
});

describe('fetchCompanyName', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('queries the companies table', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [] }));
    await fetchCompanyName();
    const [url] = global.fetch.mock.calls[0];
    expect(String(url)).toContain('/rest/v1/companies');
  });

  test('returns the first row\'s name', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [{ name: 'Acme Coaches' }] }));
    expect(await fetchCompanyName()).toBe('Acme Coaches');
  });

  test('returns null when no company row exists', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [] }));
    expect(await fetchCompanyName()).toBeNull();
  });

  test('throws on a non-ok response rather than returning a stale/empty name silently', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500 }));
    await expect(fetchCompanyName()).rejects.toThrow(/500/);
  });
});
