/**
 * @jest-environment jsdom
 *
 * config.js reads window.location at module scope (IS_DEV / SUPABASE_URL),
 * so anything importing supabaseApi.js transitively needs a DOM global —
 * plain Node (this project's default test environment) doesn't have one.
 */
import { fetchAvailableServices, fetchLocalBusVehicles, fetchCompanyBranding, preloadAllRoutes, captureDutyLinkParams, sbFetch } from '../driver/src/supabaseApi.js';
import { getCachedStops } from '../driver/src/localStore.js';

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
  // seeing a previous test's successfully-cached result. sessionStorage is
  // cleared too, for the same reason, now that captureDutyLinkParams below
  // also writes to it within this same jsdom instance.
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
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

describe('preloadAllRoutes', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // One shared handler covering both endpoints preloadAllRoutes touches —
  // fetchAvailableServices() first, then fetchStopsForDeparture() once per
  // unique departure it found.
  function mockFetchImplementation({ stopsFail } = {}) {
    return jest.fn(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('departure_id=eq.')) {
        if (stopsFail) return { ok: false, status: 500 };
        return { ok: true, json: async () => [] };
      }
      return { ok: true, json: async () => [...S116S_AM_ROWS, S116S_PM_ROW, S125S_AM_ROW] };
    });
  }

  test('warms the stops cache for every unique departure across every service', async () => {
    global.fetch = mockFetchImplementation();
    await preloadAllRoutes();
    expect(getCachedStops('dep-116s-am')).not.toBeNull();
    expect(getCachedStops('dep-116s-pm')).not.toBeNull();
    expect(getCachedStops('dep-125s-am')).not.toBeNull();
  });

  test('does not throw, and still caches the other departures, when one departure\'s stops fetch fails', async () => {
    global.fetch = mockFetchImplementation({ stopsFail: true });
    await expect(preloadAllRoutes()).resolves.toBeUndefined();
    expect(getCachedStops('dep-116s-am')).toBeNull();
  });

  test('is a silent no-op when fetchAvailableServices itself fails with nothing cached yet', async () => {
    global.fetch = jest.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(preloadAllRoutes()).resolves.toBeUndefined();
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

describe('fetchCompanyBranding', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('queries the companies table for the name and logo path', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [] }));
    await fetchCompanyBranding();
    const [url] = global.fetch.mock.calls[0];
    expect(String(url)).toContain('/rest/v1/companies?select=name,logo_path');
  });

  test('returns the name and the logo\'s public operator-assets URL', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [{ name: 'Acme Coaches', logo_path: 'co-1/logo.png' }] }));
    const branding = await fetchCompanyBranding();
    expect(branding.name).toBe('Acme Coaches');
    expect(branding.logoUrl).toMatch(/\/storage\/v1\/object\/public\/operator-assets\/co-1\/logo\.png$/);
  });

  test('logoUrl is null when the company has no logo', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [{ name: 'Acme Coaches', logo_path: null }] }));
    expect(await fetchCompanyBranding()).toEqual({ name: 'Acme Coaches', logoUrl: null });
  });

  test('returns nulls when no company row exists', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [] }));
    expect(await fetchCompanyBranding()).toEqual({ name: null, logoUrl: null });
  });

  test('throws on a non-ok response rather than returning a stale/empty name silently', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500 }));
    await expect(fetchCompanyBranding()).rejects.toThrow(/500/);
  });
});

// See docs/SECURITY_FIXES_2026-09-17.md Item 4(a): the duty-card bearer
// token used to live in the URL query string for the whole session, re-read
// from window.location.search on every request. captureDutyLinkParams()
// moves it out of the URL into driver/src/dutyLinkStore.js and strips it
// from the visible URL. That store was sessionStorage until 2026-09-28; it
// is now localStorage bounded to the shift (token expiry / end of UK day /
// last duty completed), so a power cut that restarts the tablet no longer
// drops the duty card. dutyLinkStore.test.js covers the expiry rules.
describe('captureDutyLinkParams', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('captures token and duties into the shift-bounded store and returns the duties value', () => {
    window.history.pushState(null, '', '/?token=abc123&duties=j1,j2');
    const result = captureDutyLinkParams();
    expect(JSON.parse(localStorage.getItem('busops.driver.dutyLink'))).toMatchObject({ token: 'abc123', duties: 'j1,j2' });
    expect(sessionStorage.getItem('dutyLinkToken')).toBeNull();
    expect(result).toBe('j1,j2');
  });

  test('the duty card survives a restart (sessionStorage wiped, URL bare)', () => {
    window.history.pushState(null, '', '/?token=abc123&duties=j1,j2');
    captureDutyLinkParams();

    sessionStorage.clear();
    window.history.pushState(null, '', '/');
    expect(captureDutyLinkParams()).toBe('j1,j2');
  });

  test('carries over a link held in the old sessionStorage keys (tablet mid-shift when this ships)', () => {
    sessionStorage.setItem('dutyLinkToken', 'legacy-token');
    sessionStorage.setItem('dutyLinkIds', 'j7');
    window.history.pushState(null, '', '/');
    expect(captureDutyLinkParams()).toBe('j7');
    expect(sessionStorage.getItem('dutyLinkToken')).toBeNull();
  });

  test('strips token and duties from the visible URL after capture', () => {
    window.history.pushState(null, '', '/?token=abc123&duties=j1,j2');
    captureDutyLinkParams();
    expect(window.location.search).not.toContain('token=');
    expect(window.location.search).not.toContain('duties=');
  });

  test('leaves an unrelated query param in place, only stripping token/duties', () => {
    window.history.pushState(null, '', '/?debug=1&token=abc&duties=j1');
    captureDutyLinkParams();
    expect(window.location.search).toContain('debug=1');
    expect(window.location.search).not.toContain('token=');
    expect(window.location.search).not.toContain('duties=');
  });

  test('a later call with no token/duties in the URL (e.g. a same-tab reload after stripping) still returns the previously-captured duties', () => {
    window.history.pushState(null, '', '/?token=abc123&duties=j1,j2');
    captureDutyLinkParams();

    // Simulate the reload: URL no longer carries token/duties (already
    // stripped), the stored link from the first call above is left intact.
    window.history.pushState(null, '', '/');
    const result = captureDutyLinkParams();
    expect(result).toBe('j1,j2');
  });

  test('sbFetch sends the stored token even once the URL no longer carries it', async () => {
    window.history.pushState(null, '', '/?token=captured-token&duties=j1');
    captureDutyLinkParams();

    // URL changes again with no token — a real same-tab reload, or simply
    // main.js's own history.replaceState call, would look like this. The
    // session is wiped too, as a power-cut restart would.
    window.history.pushState(null, '', '/');
    sessionStorage.clear();

    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [] }));
    await sbFetch('/rest/v1/some_table');

    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers.Authorization).toContain('captured-token');
  });
});
