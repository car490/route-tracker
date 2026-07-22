// src/announceStopEvent.test.js
// (implementation: src/announceStopEvent.js)
//
// Slice 2: Driver-Triggered Diversion Alert
// TDD group 2 — the single gate that main.js and onboard.js call instead of
// announceAtStop directly, so diversion suppression is enforced in one
// place rather than duplicated at both callsites.
//
// Design: same params announceAtStop already takes (stopName, nextStopName,
// isFinal), plus diversionActive. Routing only — no new announcement logic,
// no dedupe (that's already owned by the caller's "state changed to a new
// stop" watcher, and by diversionAlert.js's own idempotency check).
//
// Co-located in src/ to match vitest.config.js's `src/**/*.test.js` include
// pattern (see audioConfigPipeline.test.js for the established Slice 1
// precedent; tests/**/*.test.js runs on Jest).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { announceStopEvent } from './announceStopEvent.js';
import * as announcements from './announcements.js';

vi.mock('./announcements.js', () => ({
  announceAtStop: vi.fn(),
  announceDiversion: vi.fn(),
}));

describe('announceStopEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls announceAtStop with the stop details when no diversion is active', () => {
    announceStopEvent({
      stopName: 'High Street',
      nextStopName: 'Church Road',
      isFinal: false,
      diversionActive: false,
    });

    expect(announcements.announceAtStop).toHaveBeenCalledWith({
      stopName: 'High Street',
      nextStopName: 'Church Road',
      isFinal: false,
    });
    expect(announcements.announceDiversion).not.toHaveBeenCalled();
  });

  it('calls announceDiversion instead, and suppresses announceAtStop, when diversion is active', () => {
    announceStopEvent({
      stopName: 'High Street',
      nextStopName: 'Church Road',
      isFinal: false,
      diversionActive: true,
    });

    expect(announcements.announceDiversion).toHaveBeenCalledOnce();
    expect(announcements.announceAtStop).not.toHaveBeenCalled();
  });

  it('does not pass stop details through to announceDiversion — no dynamic content path', () => {
    announceStopEvent({
      stopName: 'High Street',
      nextStopName: 'Church Road',
      isFinal: false,
      diversionActive: true,
    });

    expect(announcements.announceDiversion).toHaveBeenCalledWith();
  });

  it('still announces final-stop correctly when diversion is not active', () => {
    announceStopEvent({
      stopName: 'Bus Station',
      nextStopName: null,
      isFinal: true,
      diversionActive: false,
    });

    expect(announcements.announceAtStop).toHaveBeenCalledWith({
      stopName: 'Bus Station',
      nextStopName: null,
      isFinal: true,
    });
  });
});
