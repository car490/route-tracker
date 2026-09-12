// announce/src/announceSpeech.test.js
//
// Covers speakState()'s clip-key resolution via the shared playback engine
// (shared/announcementAudio.js) — the same engine driver/src/announcements.js
// uses (see that file's own test, driver/src/announcements.test.js). Audio
// is stubbed to fail immediately so each case falls through to the
// synthesis fallback, letting the assertion focus on which clip URL was
// actually attempted for a given stateKey/ids pair.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { speakState } from './announceSpeech.js';
import { ANNOUNCE_STATES } from '../../shared/announceStates.js';

describe('speakState — clip resolution', () => {
  let attemptedUrls;

  beforeEach(() => {
    attemptedUrls = [];
    vi.stubGlobal('window', {}); // no speechSynthesis — fallback resolves immediately
    vi.stubGlobal('Audio', class {
      constructor(url) { attemptedUrls.push(url); }
      play() { queueMicrotask(() => this.onerror?.(new Error('no audio in test env'))); return Promise.resolve(); }
      pause() {}
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('APPROACHING — tries the approach/<stopId> clip', async () => {
    speakState(ANNOUNCE_STATES.APPROACHING, { stopName: 'Example Road', isFinal: false }, { stopId: 'stop-1' });
    await vi.waitFor(() => expect(attemptedUrls.length).toBeGreaterThan(0));
    expect(attemptedUrls[0]).toBe('/driver/audio/announcements/approach/stop-1.mp3');
    await new Promise((r) => setTimeout(r, 0)); // let the engine fully settle (isBusy reset) before the next test
  });

  it('STOP_DEPARTURE — tries the departure/<nextStopId> clip, not the current stop', async () => {
    speakState(ANNOUNCE_STATES.STOP_DEPARTURE, { nextStopName: 'Example Road' }, { nextStopId: 'stop-2' });
    await vi.waitFor(() => expect(attemptedUrls.length).toBeGreaterThan(0));
    expect(attemptedUrls[0]).toBe('/driver/audio/announcements/departure/stop-2.mp3');
    await new Promise((r) => setTimeout(r, 0));
  });

  it('AT_STOP (final) — tries the fixed terminus clip', async () => {
    speakState(ANNOUNCE_STATES.AT_STOP, { stopName: 'Terminus', isFinal: true }, { stopId: 'stop-9' });
    await vi.waitFor(() => expect(attemptedUrls.length).toBeGreaterThan(0));
    expect(attemptedUrls[0]).toBe('/driver/audio/announcements/terminus.mp3');
    await new Promise((r) => setTimeout(r, 0));
  });

  it('with no ids at all, skips clip lookup and goes straight to the synthesis fallback', async () => {
    speakState(ANNOUNCE_STATES.APPROACHING, { stopName: 'Example Road', isFinal: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(attemptedUrls).toEqual([]);
  });
});
