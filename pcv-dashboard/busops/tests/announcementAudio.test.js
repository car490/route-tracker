// tests/announcementAudio.test.js
//
// shared/announcementAudio.js's clipKeysFor() is the one place that must
// stay in sync with scripts/generate-announcement-audio.mjs's own job keys
// (see that script's buildJobs()) — both driver/src/announcements.js
// (Driver/Lite) and announce/src/announceSpeech.js (Announce Solo) resolve
// their pre-rendered clip lookups through this same shared function, so a
// regression here silently breaks natural-voice audio on both tiers at
// once.

import { clipKeysFor } from '../shared/announcementAudio.js';
import { ANNOUNCE_STATES } from '../shared/announceStates.js';

describe('clipKeysFor', () => {
  it('ROUTE_START — service+destination, slugged and stripped of NaPTAN indicators', () => {
    expect(clipKeysFor(ANNOUNCE_STATES.ROUTE_START, {}, { serviceCode: 'S125S', destination: 'Boston College (opp)' }))
      .toEqual(['service/s125s__boston-college']);
  });

  it('ROUTE_START — missing ids falls back to live synthesis (null)', () => {
    expect(clipKeysFor(ANNOUNCE_STATES.ROUTE_START, {}, {})).toBeNull();
  });

  it('APPROACHING — keyed by the current stop', () => {
    expect(clipKeysFor(ANNOUNCE_STATES.APPROACHING, {}, { stopId: 'stop-1' })).toEqual(['approach/stop-1']);
  });

  it('APPROACHING — missing stopId falls back to live synthesis (null)', () => {
    expect(clipKeysFor(ANNOUNCE_STATES.APPROACHING, {}, {})).toBeNull();
  });

  it('STOP_DEPARTURE — keyed by the *next* stop, not the current one', () => {
    expect(clipKeysFor(ANNOUNCE_STATES.STOP_DEPARTURE, {}, { nextStopId: 'stop-2' })).toEqual(['departure/stop-2']);
  });

  it('STOP_DEPARTURE — missing nextStopId falls back to live synthesis (null)', () => {
    expect(clipKeysFor(ANNOUNCE_STATES.STOP_DEPARTURE, {}, {})).toBeNull();
  });

  it('AT_STOP — fixed terminus clip, no ids needed', () => {
    expect(clipKeysFor(ANNOUNCE_STATES.AT_STOP, {}, {})).toEqual(['terminus']);
  });

  it('DIVERSION — fixed clip, no ids needed', () => {
    expect(clipKeysFor(ANNOUNCE_STATES.DIVERSION, {}, {})).toEqual(['diversion']);
  });

  it('IDLE (or any other state) has no clip', () => {
    expect(clipKeysFor(ANNOUNCE_STATES.IDLE, {}, {})).toBeNull();
  });
});
