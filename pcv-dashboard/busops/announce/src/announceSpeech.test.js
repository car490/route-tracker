// @vitest-environment jsdom
//
// announce/src/announceSpeech.test.js
//
// Covers speakState()'s clip-key resolution via the shared playback engine
// (shared/announcementAudio.js) — the same engine driver/src/announcements.js
// uses (see that file's own test, driver/src/announcements.test.js). Real
// jsdom (not the suite's default 'node' environment) is required as of
// Phase 2 of docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md: shared/announcementAudio.js
// now imports driver/src/config.js, which reads self.location at module
// scope to pick dev vs production Supabase URLs — the same reason
// tests/supabaseApi.test.js (Jest) needs `@jest-environment jsdom`. jsdom's
// default hostname is 'localhost', so config.js resolves to the dev project
// throughout this file — STORAGE_BASE (imported below) reflects that.
//
// Audio is stubbed per-test to fail/succeed on specific URLs, letting the
// assertions focus on which clip URL was actually attempted. There's only
// ever one attempt now — the bundled-fallback second attempt this file used
// to also assert on was removed 2026-09-16 once parity was proven on dev
// then production (shared/announcementAudio.js's playClip is Storage-only;
// the bundled driver/audio/announcements/ files remain, but only as the Bus
// Controller's own local audio source — see that file's header comment).
//
// Phase 3 ("never synthesize"): there is no speechSynthesis fallback left to
// fall through to — a clip that isn't confirmed now plays no audio and
// reports a coverage gap instead (shared/announcementCoverage.js's
// recordAnnouncementCoverageGap, a plain fetch POST). fetch is stubbed
// throughout this file so that call resolves harmlessly rather than hitting
// a real network from the test environment.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { speakState } from './announceSpeech.js';
import { ANNOUNCE_STATES } from '../../shared/announceStates.js';
import { STORAGE_BASE } from '../../shared/announcementAudio.js';

describe('speakState — clip resolution', () => {
  let attemptedUrls;
  let fetchMock;

  beforeEach(() => {
    attemptedUrls = [];
    vi.stubGlobal('window', {}); // no speechSynthesis on this object at all — proves it's never touched
    // The Storage-backed clip fails — the tests below only care which URL
    // was attempted.
    vi.stubGlobal('Audio', class {
      constructor(url) { attemptedUrls.push(url); }
      play() { queueMicrotask(() => this.onerror?.(new Error('no audio in test env'))); return Promise.resolve(); }
      pause() {}
    });
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('APPROACHING — tries the Storage-backed approach/<stopId> clip first', async () => {
    speakState(ANNOUNCE_STATES.APPROACHING, { stopName: 'Example Road', isFinal: false }, { stopId: 'stop-1' });
    await vi.waitFor(() => expect(attemptedUrls.length).toBeGreaterThan(0));
    expect(attemptedUrls[0]).toBe(`${STORAGE_BASE}approach/stop-1.mp3`);
    await new Promise((r) => setTimeout(r, 0)); // let the engine fully settle (isBusy reset) before the next test
  });

  it('STOP_DEPARTURE — tries the departure/<nextStopId> clip, not the current stop', async () => {
    speakState(ANNOUNCE_STATES.STOP_DEPARTURE, { nextStopName: 'Example Road' }, { nextStopId: 'stop-2' });
    await vi.waitFor(() => expect(attemptedUrls.length).toBeGreaterThan(0));
    expect(attemptedUrls[0]).toBe(`${STORAGE_BASE}departure/stop-2.mp3`);
    await new Promise((r) => setTimeout(r, 0));
  });

  it('AT_STOP (final) — tries the fixed terminus clip', async () => {
    speakState(ANNOUNCE_STATES.AT_STOP, { stopName: 'Terminus', isFinal: true }, { stopId: 'stop-9' });
    await vi.waitFor(() => expect(attemptedUrls.length).toBeGreaterThan(0));
    expect(attemptedUrls[0]).toBe(`${STORAGE_BASE}terminus.mp3`);
    await new Promise((r) => setTimeout(r, 0));
  });

  it('with no ids at all, skips clip lookup entirely and plays no audio', async () => {
    speakState(ANNOUNCE_STATES.APPROACHING, { stopName: 'Example Road', isFinal: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(attemptedUrls).toEqual([]);
  });

  // Phase 3: when the clip source doesn't work, no speechSynthesis fallback
  // is attempted (there is none left — see this file's header comment) and a
  // coverage-gap alert is recorded instead of a silent console.warn.
  it('never calls speechSynthesis, and records a live_stop coverage gap, when the clip fails', async () => {
    const speakSpy = vi.fn();
    vi.stubGlobal('window', { speechSynthesis: { speak: speakSpy, cancel: vi.fn() } });

    speakState(ANNOUNCE_STATES.APPROACHING, { stopName: 'Example Road', isFinal: false }, {
      stopId: 'stop-1', journeyId: 'journey-1', vehicleId: 'vehicle-1',
    });
    await vi.waitFor(() => {
      const gapCall = fetchMock.mock.calls.find(([url]) => url.includes('/rest/v1/announcement_coverage_gap'));
      expect(gapCall).toBeTruthy();
    });

    expect(speakSpy).not.toHaveBeenCalled();

    const [url, options] = fetchMock.mock.calls.find(([u]) => u.includes('/rest/v1/announcement_coverage_gap'));
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toMatchObject({
      journey_id: 'journey-1',
      vehicle_id: 'vehicle-1',
      stage: 'live_stop',
      missing_keys: ['approach/stop-1'],
    });
  });
});

// Separate describe block: needs to control which specific URL succeeds
// (not just "everything fails"), so it uses its own Audio stub rather than
// the fail-everything one above.
describe('speakState — Storage-backed clip succeeds (cache hit, or a live fetch while online)', () => {
  let attemptedUrls;

  beforeEach(() => {
    attemptedUrls = [];
    vi.stubGlobal('window', {});
    vi.stubGlobal('Audio', class {
      constructor(url) { this.url = url; attemptedUrls.push(url); }
      play() {
        // Matches a real Cache Storage hit from the service worker's live
        // precache (or a normal online fetch).
        queueMicrotask(() => this.onended?.());
        return Promise.resolve();
      }
      pause() {}
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('plays the Storage-backed clip', async () => {
    speakState(ANNOUNCE_STATES.APPROACHING, { stopName: 'Example Road', isFinal: false }, { stopId: 'stop-1' });
    await vi.waitFor(() => expect(attemptedUrls.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 0));
    expect(attemptedUrls).toEqual([`${STORAGE_BASE}approach/stop-1.mp3`]);
  });
});

// Offline: the Storage-backed fetch fails (nothing precached for this key
// yet) — Phase 3: must play no audio, never throw, and record a coverage gap
// rather than degrading to speechSynthesis (there is none left to degrade to).
describe('speakState — offline, nothing cached for this key', () => {
  let attemptedUrls;

  beforeEach(() => {
    attemptedUrls = [];
    vi.stubGlobal('window', {});
    vi.stubGlobal('Audio', class {
      constructor(url) { attemptedUrls.push(url); }
      play() { queueMicrotask(() => this.onerror?.(new Error('offline, nothing cached'))); return Promise.resolve(); }
      pause() {}
    });
    // recordAnnouncementCoverageGap's own fetch attempt — offline here too,
    // so it must fail harmlessly (it catches its own errors) rather than
    // throwing out of speakState.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tries the clip once, then plays nothing, without throwing', async () => {
    expect(() => speakState(ANNOUNCE_STATES.APPROACHING, { stopName: 'Example Road', isFinal: false }, { stopId: 'stop-1' })).not.toThrow();
    await vi.waitFor(() => expect(attemptedUrls.length).toBe(1));
    expect(attemptedUrls).toEqual([`${STORAGE_BASE}approach/stop-1.mp3`]);
  });
});
