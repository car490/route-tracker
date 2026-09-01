// src/announceStopEvent.test.js
// (implementation: src/announceStopEvent.js)
//
// The single gate that main.js calls instead of announceState() directly,
// so diversion suppression is enforced in one place rather than duplicated
// at both callsites. stateKey/vars arriving here are already resolved (see
// shared/announceStates.js's resolveApproachOrArrivalState) — this gate
// only decides whether the diversion override applies.
//
// Co-located in src/ to match vitest.config.js's `src/**/*.test.js` include
// pattern (see audioConfigPipeline.test.js for the established Slice 1
// precedent; tests/**/*.test.js runs on Jest).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { announceApproachEvent, announceStopEvent } from './announceStopEvent.js';
import * as announcements from './announcements.js';
import { ANNOUNCE_STATES } from '../../shared/announceStates.js';

vi.mock('./announcements.js', () => ({
  announceState: vi.fn(),
}));

describe('announceApproachEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls announceState for a non-final stop with no diversion active', () => {
    announceApproachEvent(ANNOUNCE_STATES.APPROACHING, { stopName: 'High Street', isFinal: false }, { stopId: 'stop-1' }, false);

    expect(announcements.announceState).toHaveBeenCalledWith(
      ANNOUNCE_STATES.APPROACHING, { stopName: 'High Street', isFinal: false }, { stopId: 'stop-1' }
    );
  });

  it('still announces the final stop — state 6 no longer silently skipped', () => {
    announceApproachEvent(ANNOUNCE_STATES.APPROACHING, { stopName: 'Bus Station', isFinal: true }, { stopId: 'stop-9' }, false);

    expect(announcements.announceState).toHaveBeenCalledWith(
      ANNOUNCE_STATES.APPROACHING, { stopName: 'Bus Station', isFinal: true }, { stopId: 'stop-9' }
    );
  });

  it('suppresses the approach announcement while a diversion is active', () => {
    announceApproachEvent(ANNOUNCE_STATES.APPROACHING, { stopName: 'High Street', isFinal: false }, { stopId: 'stop-1' }, true);

    expect(announcements.announceState).not.toHaveBeenCalled();
  });
});

describe('announceStopEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the resolved state through when no diversion is active', () => {
    announceStopEvent(ANNOUNCE_STATES.AT_STOP, { stopName: 'Church Road', isFinal: false }, { stopId: 'stop-2' }, false);

    expect(announcements.announceState).toHaveBeenCalledWith(
      ANNOUNCE_STATES.AT_STOP, { stopName: 'Church Road', isFinal: false }, { stopId: 'stop-2' }
    );
  });

  it('announces DIVERSION instead, and suppresses the normal state, when diversion is active', () => {
    announceStopEvent(ANNOUNCE_STATES.AT_STOP, { stopName: 'Church Road', isFinal: false }, { stopId: 'stop-2' }, true);

    expect(announcements.announceState).toHaveBeenCalledOnce();
    expect(announcements.announceState).toHaveBeenCalledWith(ANNOUNCE_STATES.DIVERSION, {}, {});
  });

  it('still announces the final stop correctly when diversion is not active', () => {
    announceStopEvent(ANNOUNCE_STATES.AT_STOP, { stopName: 'Boston College', isFinal: true }, { stopId: 'stop-9' }, false);

    expect(announcements.announceState).toHaveBeenCalledWith(
      ANNOUNCE_STATES.AT_STOP, { stopName: 'Boston College', isFinal: true }, { stopId: 'stop-9' }
    );
  });
});
