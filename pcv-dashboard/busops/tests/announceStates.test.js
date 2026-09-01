// tests/announceStates.test.js
//
// shared/announceStates.js is the single source of truth for the onboard
// sign's headline text and the spoken PSVAIR announcement — this is what
// makes Regulation 12(1) ("the audio and visual forms... are consistent
// with one another") structural. One assertion per state's exact wording.

import { ANNOUNCE_STATES, resolveAnnouncementText, resolveApproachOrArrivalState, articleFor } from '../shared/announceStates.js';

describe('resolveAnnouncementText', () => {
  it('IDLE has no text — brand shown instead', () => {
    expect(resolveAnnouncementText(ANNOUNCE_STATES.IDLE, {})).toBeNull();
  });

  it('ROUTE_START — "an" before S125S (spoken "Ess...")', () => {
    expect(resolveAnnouncementText(ANNOUNCE_STATES.ROUTE_START, { serviceCode: 'S125S', destination: 'Boston College' }))
      .toBe('This is an S125S to Boston College.');
  });

  it('STOP_DEPARTURE — "a" before 44 (spoken "forty-four")', () => {
    expect(resolveAnnouncementText(ANNOUNCE_STATES.STOP_DEPARTURE, {
      serviceCode: '44', destination: 'Boston College', nextStopName: 'Church Road',
    })).toBe('This is a 44 to Boston College. The next stop will be Church Road.');
  });

  it('APPROACHING, non-final', () => {
    expect(resolveAnnouncementText(ANNOUNCE_STATES.APPROACHING, { stopName: 'Church Road', isFinal: false }))
      .toBe('The next stop will be Church Road.');
  });

  it('APPROACHING, final', () => {
    expect(resolveAnnouncementText(ANNOUNCE_STATES.APPROACHING, { stopName: 'Bus Station', isFinal: true }))
      .toBe('The next stop is Bus Station. This bus terminates here, all change please.');
  });

  it('AT_STOP, non-final', () => {
    expect(resolveAnnouncementText(ANNOUNCE_STATES.AT_STOP, { stopName: 'Church Road', isFinal: false }))
      .toBe('This stop is Church Road.');
  });

  it('AT_STOP, final', () => {
    expect(resolveAnnouncementText(ANNOUNCE_STATES.AT_STOP, { stopName: 'Bus Station', isFinal: true }))
      .toBe('This is Bus Station. This bus terminates here, all change please.');
  });

  it('DIVERSION — fixed text, ignores vars', () => {
    expect(resolveAnnouncementText(ANNOUNCE_STATES.DIVERSION, { anything: 'ignored' }))
      .toBe('Attention, this bus is on diversion.');
  });

  it('returns null for an unknown state key', () => {
    expect(resolveAnnouncementText('not-a-real-state', {})).toBeNull();
  });
});

describe('articleFor', () => {
  it('"an" before a letter-led code whose letter name starts with a vowel sound', () => {
    expect(articleFor('S125S')).toBe('an'); // "Ess..."
    expect(articleFor('X1')).toBe('an');    // "Ex..."
    expect(articleFor('M1')).toBe('an');    // "Em..."
  });

  it('"a" before a letter-led code whose letter name starts with a consonant sound', () => {
    expect(articleFor('T5')).toBe('a');  // "Tee..."
    expect(articleFor('B12')).toBe('a'); // "Bee..."
  });

  it('"an" before a digit-led code spoken with a leading vowel sound', () => {
    expect(articleFor('8')).toBe('an');   // "eight"
    expect(articleFor('80')).toBe('an');  // "eighty"
    expect(articleFor('18')).toBe('an');  // "eighteen"
    expect(articleFor('11')).toBe('an');  // "eleven"
  });

  it('"a" before a digit-led code spoken with a leading consonant sound', () => {
    expect(articleFor('44')).toBe('a');  // "forty-four"
    expect(articleFor('12')).toBe('a');  // "twelve"
    expect(articleFor('1')).toBe('a');   // "one" — spelled with a vowel, spoken "won"
  });

  it('falls back to "a" for an empty/missing service code', () => {
    expect(articleFor('')).toBe('a');
    expect(articleFor(undefined)).toBe('a');
  });
});

describe('resolveApproachOrArrivalState', () => {
  const allStops = [{ name: 'Weston' }, { name: 'Church Road' }, { name: 'Bus Station' }];

  it('resolves APPROACHING with isFinal:false for a non-last stop', () => {
    const result = resolveApproachOrArrivalState({ approaching: { stopIndex: 1 }, atStop: null, allStops });
    expect(result).toEqual({ stateKey: ANNOUNCE_STATES.APPROACHING, vars: { stopName: 'Church Road', isFinal: false } });
  });

  it('resolves APPROACHING with isFinal:true for the last stop', () => {
    const result = resolveApproachOrArrivalState({ approaching: { stopIndex: 2 }, atStop: null, allStops });
    expect(result).toEqual({ stateKey: ANNOUNCE_STATES.APPROACHING, vars: { stopName: 'Bus Station', isFinal: true } });
  });

  it('resolves AT_STOP with isFinal:false for a non-last stop', () => {
    const result = resolveApproachOrArrivalState({ approaching: null, atStop: { stopIndex: 0 }, allStops });
    expect(result).toEqual({ stateKey: ANNOUNCE_STATES.AT_STOP, vars: { stopName: 'Weston', isFinal: false } });
  });

  it('resolves AT_STOP with isFinal:true for the last stop', () => {
    const result = resolveApproachOrArrivalState({ approaching: null, atStop: { stopIndex: 2 }, allStops });
    expect(result).toEqual({ stateKey: ANNOUNCE_STATES.AT_STOP, vars: { stopName: 'Bus Station', isFinal: true } });
  });

  it('approaching takes priority when both signals are somehow present', () => {
    const result = resolveApproachOrArrivalState({ approaching: { stopIndex: 1 }, atStop: { stopIndex: 0 }, allStops });
    expect(result.stateKey).toBe(ANNOUNCE_STATES.APPROACHING);
  });

  it('returns null when neither signal is set', () => {
    expect(resolveApproachOrArrivalState({ approaching: null, atStop: null, allStops })).toBeNull();
  });
});
