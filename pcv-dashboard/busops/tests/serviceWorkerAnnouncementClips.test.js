/**
 * @jest-environment jsdom
 *
 * tests/serviceWorkerAnnouncementClips.test.js
 *
 * Covers service-worker.js's fetchAnnouncementClipStorageUrls() — Phase 2 of
 * docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md's replacement for the old static
 * manifest.json-driven precache (see cacheStorageBackedAnnouncementClips()
 * in that file, which wraps this in a try/catch for the actual install
 * path — this test covers the throwing/pagination behavior that wrapper
 * relies on).
 *
 * jsdom required: service-worker.js is now an ES module that imports
 * driver/src/config.js (needed so it can build Supabase URLs without
 * duplicating them — see that file's own header comment), which reads
 * window.location at module scope. self.addEventListener('install', ...)
 * etc. at the top of service-worker.js are also exercised at import time,
 * but only *register* listeners — jsdom's `self` (an alias for `window` in
 * any window context, not just workers) accepts arbitrary event names
 * harmlessly, and this test never dispatches 'install'/'activate'/'fetch',
 * so those callback bodies never run.
 */

import { fetchAnnouncementClipStorageUrls } from '../service-worker.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../driver/src/config.js';

describe('fetchAnnouncementClipStorageUrls', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('builds public Storage URLs from announcement_clips rows, one page', async () => {
    global.fetch = jest.fn(async (url) => {
      expect(url).toBe(`${SUPABASE_URL}/rest/v1/announcement_clips?select=storage_path&limit=1000&offset=0`);
      return {
        ok: true,
        json: async () => [{ storage_path: 'approach/stop-1.mp3' }, { storage_path: 'terminus.mp3' }],
      };
    });

    const urls = await fetchAnnouncementClipStorageUrls();

    expect(urls).toEqual([
      `${SUPABASE_URL}/storage/v1/object/public/announcement-audio/approach/stop-1.mp3`,
      `${SUPABASE_URL}/storage/v1/object/public/announcement-audio/terminus.mp3`,
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][1].headers).toEqual({
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    });
  });

  it('pages through when a page comes back full — same off-by-one bug class fixed in generate-schedule.mjs', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({ storage_path: `approach/stop-${i}.mp3` }));
    const secondPage = [{ storage_path: 'terminus.mp3' }];
    global.fetch = jest.fn(async (url) => {
      const isFirstPage = url.includes('offset=0');
      return { ok: true, json: async () => (isFirstPage ? fullPage : secondPage) };
    });

    const urls = await fetchAnnouncementClipStorageUrls();

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][0]).toContain('offset=1000');
    expect(urls).toHaveLength(1001);
    expect(urls[1000]).toBe(`${SUPABASE_URL}/storage/v1/object/public/announcement-audio/terminus.mp3`);
  });

  it('returns an empty list when there are no clips yet', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [] }));
    expect(await fetchAnnouncementClipStorageUrls()).toEqual([]);
  });

  it('throws on a non-ok response — caller (cacheStorageBackedAnnouncementClips) is responsible for catching this', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500 }));
    await expect(fetchAnnouncementClipStorageUrls()).rejects.toThrow('announcement_clips fetch failed: 500');
  });
});
