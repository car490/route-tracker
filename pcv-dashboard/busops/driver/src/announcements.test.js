// @vitest-environment jsdom
//
// src/announcements.test.js
//
// Covers announceState()'s clip-key resolution and the DIVERSION state
// (shared/announceStates.js) in src/announcements.js. Co-located in src/ to
// match vitest.config.js's `src/**/*.test.js` include pattern (see
// audioConfigPipeline.test.js for the established Slice 1 precedent;
// tests/**/*.test.js runs on Jest).
//
// Real jsdom (not the suite's default 'node' environment) is required as of
// Phase 2 of docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md: this file transitively
// imports shared/announcementAudio.js, which now imports driver/src/config.js
// — that module reads self.location at module scope to pick dev vs
// production Supabase URLs, same reason tests/supabaseApi.test.js (Jest)
// needs `@jest-environment jsdom`. See announce/src/announceSpeech.test.js
// for the fuller Storage-clip-lookup coverage — this file's own Audio stub
// never inspects the constructed URL.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as announcements from './announcements.js';
import { ANNOUNCE_STATES } from '../../shared/announceStates.js';

describe('announceState — DIVERSION', () => {
  it('takes no vars/ids — the announcement text is fixed inside the shared module', () => {
    expect(() => announcements.announceState(ANNOUNCE_STATES.DIVERSION, {}, {})).not.toThrow();
  });

  it('ignores any extra fields passed in vars/ids rather than using them as text', () => {
    // Even if a caller (malicious or buggy) passes extra data, it must not
    // surface — the resolved text always comes from shared/announceStates.js.
    expect(() => announcements.announceState(ANNOUNCE_STATES.DIVERSION, { text: 'ignore this' }, {})).not.toThrow();
  });
});

// Covers announce()'s Controller-broadcast wiring (docs/CONTROLLER-
// REDESIGN.md §8, alongside — not instead of — local playback, see that
// file's "Implementation deviation" note). ./announceLink.js is mocked
// wholesale so these never touch a real WebSocket; Audio/speechSynthesis/
// localStorage are stubbed just enough that speak()'s local-playback path
// (unchanged, still exercised alongside the broadcast) doesn't throw in a
// Node test environment — see announceLink.test.js for the same pattern.
vi.mock('./announceLink.js', () => ({ broadcastAnnounce: vi.fn() }));

describe('announce() Controller broadcast', () => {
  let store;

  beforeEach(async () => {
    const { broadcastAnnounce } = await import('./announceLink.js');
    broadcastAnnounce.mockClear();

    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    });
    vi.stubGlobal('window', {}); // no speechSynthesis — speak()'s synthesis fallback resolves immediately
    vi.stubGlobal('Audio', class {
      play() { queueMicrotask(() => this.onerror?.(new Error('no audio in test env'))); return Promise.resolve(); }
      pause() {}
    });

    announcements.setAnnouncementsEnabled(true);
  });

  afterEach(() => {
    announcements.setAnnouncementsEnabled(false);
    vi.unstubAllGlobals();
  });

  it('broadcasts when not muted', async () => {
    const { broadcastAnnounce } = await import('./announceLink.js');
    announcements.announceState(ANNOUNCE_STATES.DIVERSION, {}, {});
    expect(broadcastAnnounce).toHaveBeenCalledWith('Attention, this bus is on diversion.', ['diversion']);
  });

  it('does not broadcast when muted — same gate as local playback', async () => {
    const { broadcastAnnounce } = await import('./announceLink.js');
    announcements.setMuted(true);
    announcements.announceState(ANNOUNCE_STATES.DIVERSION, {}, {});
    expect(broadcastAnnounce).not.toHaveBeenCalled();
  });

  it('does nothing at all (no broadcast) when PSVAIR announcements are disabled', async () => {
    const { broadcastAnnounce } = await import('./announceLink.js');
    announcements.setAnnouncementsEnabled(false);
    announcements.announceState(ANNOUNCE_STATES.DIVERSION, {}, {});
    expect(broadcastAnnounce).not.toHaveBeenCalled();
  });

  it('resolves clip keys per state (approaching, non-final)', async () => {
    const { broadcastAnnounce } = await import('./announceLink.js');
    announcements.announceState(ANNOUNCE_STATES.APPROACHING, { stopName: 'Example Road', isFinal: false }, { stopId: 'stop-1' });
    expect(broadcastAnnounce).toHaveBeenCalledWith('This is Example Road.', ['approach/stop-1']);
  });

  // APPROACHING no longer has a final/non-final split (same wording, same
  // key scheme, either way) — see shared/announceStates.js and
  // scripts/generate-announcement-audio.mjs, both redesigned 2026-09-02.
  it('resolves clip keys per state (approaching, final)', async () => {
    const { broadcastAnnounce } = await import('./announceLink.js');
    announcements.announceState(ANNOUNCE_STATES.APPROACHING, { stopName: 'Terminus', isFinal: true }, { stopId: 'stop-9' });
    expect(broadcastAnnounce).toHaveBeenCalledWith('This is Terminus.', ['approach/stop-9']);
  });

  it('resolves clip keys per state (departure)', async () => {
    const { broadcastAnnounce } = await import('./announceLink.js');
    announcements.announceState(ANNOUNCE_STATES.STOP_DEPARTURE, { nextStopName: 'Example Road' }, { nextStopId: 'stop-2' });
    expect(broadcastAnnounce).toHaveBeenCalledWith('The next stop is Example Road.', ['departure/stop-2']);
  });

  // AT_STOP only ever fires for the final stop now, and its text no
  // longer repeats the stop name — a single fixed 'terminus' clip, not a
  // stop-keyed one spliced with a tail clip.
  it('resolves clip keys per state (at stop, final)', async () => {
    const { broadcastAnnounce } = await import('./announceLink.js');
    announcements.announceState(ANNOUNCE_STATES.AT_STOP, { stopName: 'Terminus', isFinal: true }, { stopId: 'stop-9' });
    expect(broadcastAnnounce).toHaveBeenCalledWith(
      'This service terminates here, all change please.',
      ['terminus']
    );
  });
});

// Phase 3 of docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md ("never synthesize"): no
// speechSynthesis fallback is left in the live announcement path — a clip
// that isn't confirmed plays no audio and records a coverage gap
// (shared/announcementCoverage.js's recordAnnouncementCoverageGap, a plain
// fetch POST) instead of a silent console.warn. Own describe block so the
// speechSynthesis spy (absent from the describe block above's plain `{}`
// window stub) doesn't leak into those broadcast-focused assertions.
describe('announceState — Phase 3 (never synthesize)', () => {
  let speakSpy;
  let fetchMock;

  beforeEach(async () => {
    const { broadcastAnnounce } = await import('./announceLink.js');
    broadcastAnnounce.mockClear();

    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    speakSpy = vi.fn();
    vi.stubGlobal('window', { speechSynthesis: { speak: speakSpy, cancel: vi.fn() } });
    vi.stubGlobal('Audio', class {
      play() { queueMicrotask(() => this.onerror?.(new Error('no audio in test env'))); return Promise.resolve(); }
      pause() {}
    });
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);

    announcements.setAnnouncementsEnabled(true);
  });

  afterEach(() => {
    announcements.setAnnouncementsEnabled(false);
    vi.unstubAllGlobals();
  });

  it('never calls speechSynthesis, and records a live_stop coverage gap, when a stop has no confirmed clip', async () => {
    announcements.announceState(ANNOUNCE_STATES.APPROACHING, { stopName: 'Example Road', isFinal: false }, {
      stopId: 'stop-1', journeyId: 'journey-1', vehicleId: 'vehicle-1', driverId: 'driver-1',
    });

    await vi.waitFor(() => {
      const gapCall = fetchMock.mock.calls.find(([url]) => url.includes('/rest/v1/announcement_coverage_gap'));
      expect(gapCall).toBeTruthy();
    });

    expect(speakSpy).not.toHaveBeenCalled();

    const [, options] = fetchMock.mock.calls.find(([u]) => u.includes('/rest/v1/announcement_coverage_gap'));
    expect(JSON.parse(options.body)).toMatchObject({
      journey_id: 'journey-1',
      vehicle_id: 'vehicle-1',
      driver_id: 'driver-1',
      stage: 'live_stop',
      missing_keys: ['approach/stop-1'],
    });
  });
});
