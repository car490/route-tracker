import { describe, it, expect, vi } from 'vitest';
import { buildCandidates, fetchCandidateData, CACHE_KEY, PAGE_SIZE } from './candidates.js';

function row(departureId, sequence, overrides = {}) {
  return {
    departure_id: departureId,
    service_code: 'S116S',
    timetable_name: 'Boston – Donington',
    departure_time: '07:40:00',
    journey_type: ['Local Bus'],
    display_name: `Stop ${sequence}`,
    lat: 52.97 + sequence / 1000,
    lon: -0.02,
    sequence,
    days_of_week: [1, 2, 3, 4, 5],
    school_term_time: false,
    ...overrides,
  };
}

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data,
  };
}

describe('buildCandidates', () => {
  it('turns each departure into one candidate keyed on its first stop', () => {
    const [c] = buildCandidates([row('d1', 2), row('d1', 1), row('d1', 3)]);
    expect(c).toEqual({
      departureId: 'd1',
      serviceCode: 'S116S',
      label: 'Boston – Donington',
      departureTime: '07:40',
      firstStopName: 'Stop 1',
      firstStopLat: 52.971,
      firstStopLon: -0.02,
      daysOfWeek: [1, 2, 3, 4, 5],
      schoolTermTime: false,
      removedDates: [],
      addedDates: [],
    });
  });

  it('only offers Local Bus departures, the same set the manual picker offers', () => {
    const candidates = buildCandidates([
      row('bus', 1),
      row('school', 1, { journey_type: ['School Contract'] }),
      row('untyped', 1, { journey_type: null }),
    ]);
    expect(candidates.map((c) => c.departureId)).toEqual(['bus']);
  });

  it('attaches added and removed service exception dates to their departure', () => {
    const [c] = buildCandidates([row('d1', 1)], [
      { timetable_departure_id: 'd1', exception_date: '2026-12-25', exception_type: 'removed' },
      { timetable_departure_id: 'd1', exception_date: '2026-12-27', exception_type: 'added' },
      { timetable_departure_id: 'other', exception_date: '2026-12-26', exception_type: 'removed' },
    ]);
    expect(c.removedDates).toEqual(['2026-12-25']);
    expect(c.addedDates).toEqual(['2026-12-27']);
  });

  it('treats missing day/term fields conservatively', () => {
    const [c] = buildCandidates([row('d1', 1, { days_of_week: null, school_term_time: null })]);
    expect(c.daysOfWeek).toEqual([]);
    expect(c.schoolTermTime).toBe(false);
  });

  it('skips rows without usable coordinates', () => {
    expect(buildCandidates([row('d1', 1, { lat: null })])).toEqual([]);
  });
});

describe('fetchCandidateData', () => {
  function fakeFetch(routes) {
    return vi.fn(async (path) => {
      for (const [prefix, respond] of routes) {
        if (path.startsWith(prefix)) return respond(path);
      }
      throw new Error(`unexpected ${path}`);
    });
  }

  it('reads the timetable, exceptions and term dates, and caches the result', async () => {
    const storage = memoryStorage();
    const fetchJson = fakeFetch([
      ['/rest/v1/schedule_view', () => [row('d1', 1)]],
      ['/rest/v1/service_exceptions', () => []],
      ['/rest/v1/term_dates', () => [{ start_date: '2026-09-01', end_date: '2026-10-23' }]],
    ]);
    const data = await fetchCandidateData({ fetchJson, storage });
    expect(data.candidates.map((c) => c.departureId)).toEqual(['d1']);
    expect(data.termDateRanges).toEqual([{ start_date: '2026-09-01', end_date: '2026-10-23' }]);
    expect(JSON.parse(storage.data[CACHE_KEY])).toEqual(data);
  });

  it('pages through the timetable view past the 1000-row limit', async () => {
    const page1 = Array.from({ length: PAGE_SIZE }, (_, i) => row(`d${Math.floor(i / 10)}`, (i % 10) + 1));
    const page2 = [row('last', 1)];
    const fetchJson = fakeFetch([
      ['/rest/v1/schedule_view', (path) => (path.includes('offset=0') ? page1 : page2)],
      ['/rest/v1/service_exceptions', () => []],
      ['/rest/v1/term_dates', () => []],
    ]);
    const data = await fetchCandidateData({ fetchJson, storage: memoryStorage() });
    expect(data.candidates).toHaveLength(PAGE_SIZE / 10 + 1);
    expect(fetchJson.mock.calls.filter(([p]) => p.startsWith('/rest/v1/schedule_view'))).toHaveLength(2);
  });

  it('carries on without exceptions or term dates if those reads fail', async () => {
    const fetchJson = fakeFetch([
      ['/rest/v1/schedule_view', () => [row('d1', 1)]],
      ['/rest/v1/service_exceptions', () => { throw new Error('403'); }],
      ['/rest/v1/term_dates', () => { throw new Error('offline'); }],
    ]);
    const data = await fetchCandidateData({ fetchJson, storage: memoryStorage() });
    expect(data.candidates).toHaveLength(1);
    expect(data.termDateRanges).toEqual([]);
  });

  it('falls back to the last good copy when the timetable cannot be read (offline)', async () => {
    const cached = { candidates: [{ departureId: 'cached' }], termDateRanges: [] };
    const storage = memoryStorage({ [CACHE_KEY]: JSON.stringify(cached) });
    const fetchJson = fakeFetch([['/rest/v1/', () => { throw new Error('offline'); }]]);
    expect(await fetchCandidateData({ fetchJson, storage })).toEqual(cached);
  });

  it('throws when offline with nothing cached, so the caller can retry later', async () => {
    const fetchJson = fakeFetch([['/rest/v1/', () => { throw new Error('offline'); }]]);
    await expect(fetchCandidateData({ fetchJson, storage: memoryStorage() })).rejects.toThrow('offline');
  });

  it('ignores a corrupted cache and blocked storage', async () => {
    const fetchJson = fakeFetch([['/rest/v1/', () => { throw new Error('offline'); }]]);
    await expect(fetchCandidateData({ fetchJson, storage: memoryStorage({ [CACHE_KEY]: '{not json' }) })).rejects.toThrow();
    const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    const ok = fakeFetch([
      ['/rest/v1/schedule_view', () => [row('d1', 1)]],
      ['/rest/v1/service_exceptions', () => []],
      ['/rest/v1/term_dates', () => []],
    ]);
    await expect(fetchCandidateData({ fetchJson: ok, storage: blocked })).resolves.toMatchObject({ candidates: [{ departureId: 'd1' }] });
  });
});
