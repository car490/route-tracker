// src/announceStopEvent.test.js
// (implementation: src/announceStopEvent.js)
//
// Slice 2: Driver-Triggered Diversion Alert
// TDD group 2 — the single gate that main.js calls instead of
// announceAtStop/announceApproaching directly, so diversion suppression is
// enforced in one place rather than duplicated at both callsites.
//
// PSVAIR rework (2026-07-30): split into two gates matching the four
// regulation events — announceApproachEvent (event 2, fired off gps.js's
// stopStates 'approaching' status, silent for the final stop) and
// announceStopEvent (events 3 & 4, vehicle stopped).
//
// Co-located in src/ to match vitest.config.js's `src/**/*.test.js` include
// pattern (see audioConfigPipeline.test.js for the established Slice 1
// precedent; tests/**/*.test.js runs on Jest).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { announceApproachEvent, announceStopEvent } from './announceStopEvent.js';
import * as announcements from './announcements.js';

vi.mock('./announcements.js', () => ({
  announceApproaching: vi.fn(),
  announceAtStop: vi.fn(),
  announceDiversion: vi.fn(),
}));

describe('announceApproachEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls announceApproaching for a non-final stop with no diversion active', () => {
    announceApproachEvent({
      stopId: 'stop-1',
      stopName: 'High Street',
      isFinal: false,
      diversionActive: false,
    });

    expect(announcements.announceApproaching).toHaveBeenCalledWith({
      stopId: 'stop-1',
      stopName: 'High Street',
    });
  });

  it('does nothing for the final stop — that gets one combined announcement at arrival instead', () => {
    announceApproachEvent({
      stopId: 'stop-9',
      stopName: 'Bus Station',
      isFinal: true,
      diversionActive: false,
    });

    expect(announcements.announceApproaching).not.toHaveBeenCalled();
    expect(announcements.announceDiversion).not.toHaveBeenCalled();
  });

  it('suppresses the approach announcement while a diversion is active', () => {
    announceApproachEvent({
      stopId: 'stop-1',
      stopName: 'High Street',
      isFinal: false,
      diversionActive: true,
    });

    expect(announcements.announceApproaching).not.toHaveBeenCalled();
  });
});

describe('announceStopEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls announceAtStop with route/destination and next-stop details when no diversion is active', () => {
    announceStopEvent({
      nextStopId: 'stop-2',
      nextStopName: 'Church Road',
      isFinal: false,
      diversionActive: false,
      serviceCode: 'S125S',
      destination: 'Boston College',
    });

    expect(announcements.announceAtStop).toHaveBeenCalledWith({
      nextStopId: 'stop-2',
      nextStopName: 'Church Road',
      isFinal: false,
      serviceCode: 'S125S',
      destination: 'Boston College',
    });
    expect(announcements.announceDiversion).not.toHaveBeenCalled();
  });

  it('calls announceDiversion instead, and suppresses announceAtStop, when diversion is active', () => {
    announceStopEvent({
      nextStopId: 'stop-2',
      nextStopName: 'Church Road',
      isFinal: false,
      diversionActive: true,
      serviceCode: 'S125S',
      destination: 'Boston College',
    });

    expect(announcements.announceDiversion).toHaveBeenCalledOnce();
    expect(announcements.announceAtStop).not.toHaveBeenCalled();
  });

  it('does not pass stop details through to announceDiversion — no dynamic content path', () => {
    announceStopEvent({
      nextStopId: 'stop-2',
      nextStopName: 'Church Road',
      isFinal: false,
      diversionActive: true,
      serviceCode: 'S125S',
      destination: 'Boston College',
    });

    expect(announcements.announceDiversion).toHaveBeenCalledWith();
  });

  it('still announces final-stop correctly when diversion is not active', () => {
    announceStopEvent({
      nextStopId: null,
      nextStopName: null,
      isFinal: true,
      diversionActive: false,
      serviceCode: 'S125S',
      destination: 'Boston College',
    });

    expect(announcements.announceAtStop).toHaveBeenCalledWith({
      nextStopId: null,
      nextStopName: null,
      isFinal: true,
      serviceCode: 'S125S',
      destination: 'Boston College',
    });
  });
});
