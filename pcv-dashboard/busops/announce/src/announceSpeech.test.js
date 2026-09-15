// @vitest-environment jsdom
//
// announce/src/announceSpeech.test.js
//
// Covers speakState()'s clip-key resolution via the shared playback engine
// (shared/announcementAudio.js) — the same engine driver/src/announcements.js
// uses (see that file's own test, driver/src/announcements.test.js). Real
// jsdom (not the suite's default 'node' environment) is required as of
// Phase 2 of docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md: shared/announcementAudio.js
// now imports driver/src/config.js, which reads window.location at module
// scope to pick dev vs production Supabase URLs — the same reason
// tests/supabaseApi.test.js (Jest) needs `@jest-environment jsdom`. jsdom's
// default hostname is 'localhost', so config.js resolves to the dev project
// throughout this file — STORAGE_BASE (imported below) reflects that.
//
// Audio is stubbed per-test to fail/succeed on specific URLs, letting the
// assertions focus on which clip URL(s) were actually attempted and in what
// order (Storage-backed first, bundled fallback second — see
// shared/announcementAudio.js's playClip).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { speakState } from './announceSpeech.js';
import { ANNOUNCE_STATES } from '../../shared/announceStates.js';
import { STORAGE_BASE } from '../../shared/announcementAudio.js';

const BUNDLED_BASE = '/driver/audio/announcements/';

describe('speakState — clip resolution', () => {
  let attemptedUrls;

  beforeEach(() => {
    attemptedUrls = [];
    vi.stubGlobal('window', {}); // no speechSynthesis — fallback resolves immediately
    // Every URL fails (both Storage-backed and bundled) — the tests below
    // only care which URL(s) were attempted and in what order, same as the
    // pre-Phase-2 version of this file.
    vi.stubGlobal('Audio', class {
      constructor(url) { attemptedUrls.push(url); }
      play() { queueMicrotask(() => this.onerror?.(new Error('no audio in test env'))); return Promise.resolve(); }
      pause() {}
    });
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

  it('with no ids at all, skips clip lookup and goes straight to the synthesis fallback', async () => {
    speakState(ANNOUNCE_STATES.APPROACHING, { stopName: 'Example Road', isFinal: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(attemptedUrls).toEqual([]);
  });

  it('falls back to the bundled clip when the Storage-backed one fails — transition safety net', async () => {
    speakState(ANNOUNCE_STATES.APPROACHING, { stopName: 'Example Road', isFinal: false }, { stopId: 'stop-1' });
    await vi.waitFor(() => expect(attemptedUrls.length).toBe(2));
    expect(attemptedUrls).toEqual([
      `${STORAGE_BASE}approach/stop-1.mp3`,
      `${BUNDLED_BASE}approach/stop-1.mp3`,
    ]);
    await new Promise((r) => setTimeout(r, 0));
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
        // Only the Storage-backed URL succeeds — proves the engine never
        // even tries the bundled fallback once the primary source works,
        // same as a real Cache Storage hit from the service worker's live
        // precache (or a normal online fetch).
        if (this.url.includes('/storage/v1/object/public/')) {
          queueMicrotask(() => this.onended?.());
        } else {
          queueMicrotask(() => this.onerror?.(new Error('should not be reached')));
        }
        return Promise.resolve();
      }
      pause() {}
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never attempts the bundled fallback', async () => {
    speakState(ANNOUNCE_STATES.APPROACHING, { stopName: 'Example Road', isFinal: false }, { stopId: 'stop-1' });
    await vi.waitFor(() => expect(attemptedUrls.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 0));
    expect(attemptedUrls).toEqual([`${STORAGE_BASE}approach/stop-1.mp3`]);
  });
});

// Offline: both the Storage-backed fetch and the bundled-fallback fetch fail
// (nothing precached for this key yet) — must degrade to synthesis, never
// throw and never leave the announcement silently dropped.
describe('speakState — offline, nothing cached for this key', () => {
  let attemptedUrls;

  beforeEach(() => {
    attemptedUrls = [];
    vi.stubGlobal('window', {}); // no speechSynthesis — synthesis fallback still resolves without throwing
    vi.stubGlobal('Audio', class {
      constructor(url) { attemptedUrls.push(url); }
      play() { queueMicrotask(() => this.onerror?.(new Error('offline, nothing cached'))); return Promise.resolve(); }
      pause() {}
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tries both sources, then falls through without throwing', async () => {
    expect(() => speakState(ANNOUNCE_STATES.APPROACHING, { stopName: 'Example Road', isFinal: false }, { stopId: 'stop-1' })).not.toThrow();
    await vi.waitFor(() => expect(attemptedUrls.length).toBe(2));
    expect(attemptedUrls).toEqual([
      `${STORAGE_BASE}approach/stop-1.mp3`,
      `${BUNDLED_BASE}approach/stop-1.mp3`,
    ]);
  });
});
