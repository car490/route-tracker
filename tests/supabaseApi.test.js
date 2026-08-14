/**
 * @jest-environment jsdom
 *
 * config.js reads window.location at module scope (IS_DEV / SUPABASE_URL),
 * so anything importing supabaseApi.js transitively needs a DOM global —
 * plain Node (this project's default test environment) doesn't have one.
 */
import { fetchAvailableServices } from '../src/supabaseApi.js';

// schedule_view is one row per stop, not per departure — a two-stop
// departure produces two rows with the same service_code/departure_id/
// departure_time, which fetchAvailableServices must dedupe.
const S116S_AM_ROWS = [
  { service_code: 'S116S', timetable_name: 'Morning Outbound', departure_id: 'dep-116s-am', departure_time: '08:15:00' },
  { service_code: 'S116S', timetable_name: 'Morning Outbound', departure_id: 'dep-116s-am', departure_time: '08:15:00' },
];
const S116S_PM_ROW = { service_code: 'S116S', timetable_name: 'Afternoon Inbound', departure_id: 'dep-116s-pm', departure_time: '15:30:00' };
const S125S_AM_ROW = { service_code: 'S125S', timetable_name: 'Morning Outbound', departure_id: 'dep-125s-am', departure_time: '07:45:00' };

describe('fetchAvailableServices', () => {
  const originalFetch = global.fetch;

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
});
