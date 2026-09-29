// src/stopTimesUpload.test.js
//
// The Driver PWA's stop-time upload. Until 2026-09-29 main.js POSTed
// straight to /rest/v1/journey_stop_times with
// Prefer: resolution=ignore-duplicates, which the database refuses for anon
// (HTTP 401, 42501), so no stop time had been stored on production since
// 14 July. It now calls record_journey_stop_times() instead
// (supabase/migration_record_journey_stop_times.sql).

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { uploadStopTimes, isRefusal, reportUploadProblem } from './stopTimesUpload.js';

const row = (ts) => ({ journey_id: 'j-1', timetable_stop_id: ts, arrived_at: '2026-09-29T07:00:00.000Z', visit_status: 'visited' });

function response(status, body = '') {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

describe('uploadStopTimes', () => {
  it('sends the rows to record_journey_stop_times, not straight to the table', async () => {
    const fetchFn = vi.fn(async () => response(200, '2'));
    const result = await uploadStopTimes(fetchFn, 'j-1', [row('ts-1'), row('ts-2')]);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [path, opts] = fetchFn.mock.calls[0];
    expect(path).toBe('/rest/v1/rpc/record_journey_stop_times');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ p_journey_id: 'j-1', p_rows: [row('ts-1'), row('ts-2')] });
    expect(opts.headers?.Prefer ?? '').not.toContain('resolution');
    expect(result).toEqual({ ok: true, status: 200, count: 2, responseBody: '' });
  });

  it('sends nothing when no stop was reached', async () => {
    const fetchFn = vi.fn();
    expect(await uploadStopTimes(fetchFn, 'j-1', [])).toEqual({ ok: true, count: 0 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('reports a refusal with its status and the server\'s reason', async () => {
    const fetchFn = vi.fn(async () => response(401, '{"code":"42501","message":"Journey j-1 is not in progress"}'));
    const result = await uploadStopTimes(fetchFn, 'j-1', [row('ts-1')]);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.responseBody).toContain('not in progress');
  });

  it('lets a network failure throw, so the caller queues the trip', async () => {
    const fetchFn = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(uploadStopTimes(fetchFn, 'j-1', [row('ts-1')])).rejects.toThrow('Failed to fetch');
  });

  it('main.js no longer writes journey_stop_times directly', () => {
    const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
    expect(main).not.toContain('/rest/v1/journey_stop_times');
    expect(main).not.toContain('resolution=ignore-duplicates');
  });

  // main.js runs init() on import and needs the whole page, so its wiring is
  // checked at source level (same approach as tests/driverAutoStart.test.js).
  it('main.js tells the driver and the office when an upload is refused, at trip end and on retry', () => {
    const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
    const fn = (name) => {
      const start = main.indexOf(`function ${name}(`);
      const next = main.indexOf('\nfunction ', start + 1);
      return main.slice(start, next === -1 ? undefined : next);
    };
    const flush = fn('flushPendingTrips');
    expect(flush).toMatch(/isRefusal\(uploadResult\.status\)/);
    expect(flush).toMatch(/!trip\.refusalReported/);
    expect(flush).toMatch(/reportUploadProblem\(sbFetch,/);
    expect(flush).toMatch(/markPendingTripRefusalReported\(trip\.id\)/);

    expect(main).toMatch(/title: 'Stop times not accepted'/);
    expect(main).toMatch(/Please tell the office\./);
    expect(main).toMatch(/markPendingTripRefusalReported\(pendingId\)/);
  });
});

// A refusal is the server answering "no" — retrying the same request won't
// change that, so someone has to be told. No signal, a timeout, rate limiting
// or a server fault are temporary: the queue just tries again later.
describe('isRefusal', () => {
  it.each([400, 401, 403, 404, 409, 422])('HTTP %i is a refusal', (status) => {
    expect(isRefusal(status)).toBe(true);
  });
  it.each([undefined, null, 0, 200, 408, 429, 500, 502, 503])('%s is not (temporary, or not an answer)', (status) => {
    expect(isRefusal(status)).toBe(false);
  });
});

describe('reportUploadProblem', () => {
  it('tells ops through report_stop_time_upload_problem', async () => {
    const fetchFn = vi.fn(async () => response(204));
    await reportUploadProblem(fetchFn, { journeyId: 'j-1', httpStatus: 401, reason: 'not in progress', rowCount: 23 });
    const [path, opts] = fetchFn.mock.calls[0];
    expect(path).toBe('/rest/v1/rpc/report_stop_time_upload_problem');
    expect(JSON.parse(opts.body)).toEqual({
      p_journey_id: 'j-1', p_source: 'driver', p_http_status: 401, p_reason: 'not in progress', p_row_count: 23,
    });
  });

  it('never throws, whatever happens to the report', async () => {
    await expect(reportUploadProblem(vi.fn(async () => { throw new TypeError('Failed to fetch'); }),
      { journeyId: 'j-1', httpStatus: 401, reason: '', rowCount: 1 })).resolves.toBe(false);
    await expect(reportUploadProblem(vi.fn(async () => response(401)),
      { journeyId: 'j-1', httpStatus: 401, reason: '', rowCount: 1 })).resolves.toBe(false);
  });
});
