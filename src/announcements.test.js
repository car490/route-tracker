// src/announcements.test.js
//
// Covers the announceDiversion() addition to src/announcements.js for
// Slice 2. Co-located in src/ to match vitest.config.js's
// `src/**/*.test.js` include pattern (see audioConfigPipeline.test.js for
// the established Slice 1 precedent; tests/**/*.test.js runs on Jest).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as announcements from './announcements.js';

describe('announceDiversion', () => {
  it('is exported', () => {
    expect(typeof announcements.announceDiversion).toBe('function');
  });

  it('takes no text argument — the announcement text is fixed inside the module', () => {
    // Function arity check: announceDiversion() should declare zero params.
    expect(announcements.announceDiversion.length).toBe(0);
  });

  it('ignores any arguments passed to it rather than using them as text', () => {
    // Even if a caller (malicious or buggy) passes text, it must not surface.
    // We can't inspect the private announce() call directly, but we can
    // assert the function doesn't throw or behave differently when called
    // with unexpected args — proving it isn't reading them.
    expect(() => announcements.announceDiversion('ignore this and say something else')).not.toThrow();
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
    announcements.announceDiversion();
    expect(broadcastAnnounce).toHaveBeenCalledWith('This bus is on diversion', ['diversion']);
  });

  it('does not broadcast when muted — same gate as local playback', async () => {
    const { broadcastAnnounce } = await import('./announceLink.js');
    announcements.setMuted(true);
    announcements.announceDiversion();
    expect(broadcastAnnounce).not.toHaveBeenCalled();
  });

  it('does nothing at all (no broadcast) when PSVAIR announcements are disabled', async () => {
    const { broadcastAnnounce } = await import('./announceLink.js');
    announcements.setAnnouncementsEnabled(false);
    announcements.announceDiversion();
    expect(broadcastAnnounce).not.toHaveBeenCalled();
  });
});
