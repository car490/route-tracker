import { describe, it, expect } from 'vitest';
import { autoStartReducer, initialAutoStartState, COUNTDOWN_SECONDS } from './autoStartState.js';

const CAND = { departureId: 'd1', serviceCode: 'S116S' };
const OTHER = { departureId: 'd2', serviceCode: 'S116S' };

function run(events, state = initialAutoStartState()) {
  return events.reduce(autoStartReducer, state);
}

describe('autoStartReducer', () => {
  it('starts watching with nothing dismissed', () => {
    expect(initialAutoStartState()).toEqual({ phase: 'watching', candidate: null, shiftMinutes: 0, secondsLeft: 0, dismissed: [] });
  });

  it('a match while watching starts a 10 second countdown', () => {
    expect(COUNTDOWN_SECONDS).toBe(10);
    const s = run([{ type: 'match', candidate: CAND, shiftMinutes: 5 }]);
    expect(s).toMatchObject({ phase: 'countdown', candidate: CAND, shiftMinutes: 5, secondsLeft: 10 });
  });

  it('counts down once a second and moves to starting at zero', () => {
    let s = run([{ type: 'match', candidate: CAND }]);
    for (let i = 0; i < 9; i++) s = autoStartReducer(s, { type: 'tick' });
    expect(s).toMatchObject({ phase: 'countdown', secondsLeft: 1 });
    s = autoStartReducer(s, { type: 'tick' });
    expect(s).toMatchObject({ phase: 'starting', secondsLeft: 0, candidate: CAND });
  });

  it('Start now skips the rest of the countdown', () => {
    expect(run([{ type: 'match', candidate: CAND }, { type: 'startNow' }])).toMatchObject({ phase: 'starting', candidate: CAND });
  });

  it('Not now goes back to watching and never offers that departure again today', () => {
    const s = run([{ type: 'match', candidate: CAND }, { type: 'cancel' }]);
    expect(s).toMatchObject({ phase: 'watching', candidate: null, dismissed: ['d1'] });
    expect(autoStartReducer(s, { type: 'match', candidate: CAND })).toBe(s);
    expect(autoStartReducer(s, { type: 'match', candidate: OTHER }).phase).toBe('countdown');
  });

  it('Change service pauses automatic mode while the driver picks by hand', () => {
    const s = run([{ type: 'match', candidate: CAND }, { type: 'change' }]);
    expect(s).toMatchObject({ phase: 'paused', dismissed: ['d1'] });
    expect(autoStartReducer(s, { type: 'match', candidate: OTHER })).toBe(s);
    expect(autoStartReducer(s, { type: 'resume' }).phase).toBe('watching');
  });

  it('a started journey is running and is not offered again when it ends', () => {
    const s = run([{ type: 'match', candidate: CAND }, { type: 'startNow' }, { type: 'started' }]);
    expect(s).toMatchObject({ phase: 'running', dismissed: ['d1'] });
    expect(autoStartReducer(s, { type: 'match', candidate: OTHER })).toBe(s);
    const ended = autoStartReducer(s, { type: 'journeyEnded' });
    expect(ended).toMatchObject({ phase: 'watching', candidate: null, dismissed: ['d1'] });
  });

  it('a start the server refuses goes back to watching without retrying that departure', () => {
    const s = run([{ type: 'match', candidate: CAND }, { type: 'startNow' }, { type: 'startFailed' }]);
    expect(s).toMatchObject({ phase: 'watching', dismissed: ['d1'] });
  });

  it('a new day clears the dismissed list but keeps the current phase', () => {
    const s = run([{ type: 'match', candidate: CAND }, { type: 'cancel' }, { type: 'newDay' }]);
    expect(s).toMatchObject({ phase: 'watching', dismissed: [] });
  });

  it('ignores events that make no sense in the current phase', () => {
    const watching = initialAutoStartState();
    for (const type of ['tick', 'startNow', 'cancel', 'change', 'started', 'startFailed', 'resume']) {
      expect(autoStartReducer(watching, { type })).toBe(watching);
    }
    const counting = run([{ type: 'match', candidate: CAND }]);
    expect(autoStartReducer(counting, { type: 'match', candidate: OTHER })).toBe(counting);
    expect(autoStartReducer(counting, { type: 'bogus' })).toBe(counting);
  });

  it('never mutates the state it is given', () => {
    const s = Object.freeze({ ...initialAutoStartState(), dismissed: Object.freeze([]) });
    expect(() => run([{ type: 'match', candidate: CAND }, { type: 'cancel' }], s)).not.toThrow();
  });
});
