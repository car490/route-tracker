// src/announcements.test.js
//
// Covers announceState()'s clip-key resolution and the DIVERSION state
// (shared/announceStates.js) in src/announcements.js. Co-located in src/ to
// match vitest.config.js's `src/**/*.test.js` include pattern (see
// audioConfigPipeline.test.js for the established Slice 1 precedent;
// tests/**/*.test.js runs on Jest).

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
    expect(broadcastAnnounce).toHaveBeenCalledWith('This is Example Road.', ['next/stop-1']);
  });

  it('resolves clip keys per state (approaching, final)', async () => {
    const { broadcastAnnounce } = await import('./announceLink.js');
    announcements.announceState(ANNOUNCE_STATES.APPROACHING, { stopName: 'Terminus', isFinal: true }, { stopId: 'stop-9' });
    expect(broadcastAnnounce).toHaveBeenCalledWith(
      'This is Terminus.',
      ['next-final/stop-9', 'terminus-tail']
    );
  });

  it('resolves clip keys per state (at stop, final)', async () => {
    const { broadcastAnnounce } = await import('./announceLink.js');
    announcements.announceState(ANNOUNCE_STATES.AT_STOP, { stopName: 'Terminus', isFinal: true }, { stopId: 'stop-9' });
    expect(broadcastAnnounce).toHaveBeenCalledWith(
      'This service terminates here, all change please.',
      ['arrive/stop-9', 'terminus-tail']
    );
  });
});
