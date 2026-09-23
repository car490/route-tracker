// tests/headlineLines.test.js
//
// BusOps Announce sign sizing, slice C: the route-start panel is laid out like
// every other stop — Line 1 "This is an S116T to", Lines 2 and 3 the
// destination split at its first comma. A destination with no comma keeps the
// sentence. The sign also records which state it is showing (data-state on
// #onboard-sign) so CSS never has to guess from the wording. Written BEFORE
// announce/src/headlineLines.js (TDD).
//
// Display only: the spoken text (shared/announceStates.js
// resolveAnnouncementText) is unchanged. PSVAIR Reg 12(1) governs the audio and
// visual forms being consistent, not identical line-breaking.

import fs from 'fs';
import path from 'path';
import { ANNOUNCE_STATES, articleFor } from '../shared/announceStates.js';
import { headlineLines, signStateAttribute } from '../announce/src/headlineLines.js';

const ROUTE_START = (serviceCode, destination) =>
  headlineLines(ANNOUNCE_STATES.ROUTE_START, { serviceCode, destination });

describe('headlineLines — route start (slice C)', () => {
  it('"This is an S116T to" / Boston / Bus Station', () => {
    expect(ROUTE_START('S116T', 'Boston, Bus Station')).toEqual({
      verb: 'This is an S116T to', town: 'Boston', stop: 'Bus Station',
    });
  });

  it('splits the stored comma convention (no space) the same way', () => {
    expect(ROUTE_START('S116T', 'Boston,Bus Station')).toEqual({
      verb: 'This is an S116T to', town: 'Boston', stop: 'Bus Station',
    });
  });

  it.each([
    ['S125S', 'an'], // spoken "Ess..."
    ['S116T', 'an'],
    ['44', 'a'], // "forty-four"
    ['8', 'an'], // "eight"
    ['11', 'an'], // "eleven"
    ['22', 'a'], // "twenty-two"
    ['B1', 'a'], // "Bee..."
    ['X1', 'an'], // "Ex..."
  ])('the article for %s is "%s", from the sign\'s own articleFor()', (code, article) => {
    expect(articleFor(code)).toBe(article); // pins the shared rule this relies on
    expect(ROUTE_START(code, 'A,B').verb).toBe(`This is ${article} ${code} to`);
  });

  it('a destination with no comma cannot be split: null, so the sentence is kept', () => {
    expect(ROUTE_START('S116T', 'Peterborough')).toBeNull();
    expect(ROUTE_START('S116T', 'Boston Bus Station')).toBeNull();
  });

  it('has no trailing full stop on Line 3 (the spoken sentence keeps its own)', () => {
    expect(ROUTE_START('S1', 'Boston,Bus Station').stop.endsWith('.')).toBe(false);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['a number', 116],
    ['null', null],
  ])('a %s service code gives null rather than "This is undefined to"', (_l, code) => {
    expect(ROUTE_START(code, 'Boston,Bus Station')).toBeNull();
  });

  it.each([
    ['missing', undefined],
    ['a number', 5],
    ['null', null],
  ])('a %s destination gives null', (_l, destination) => {
    expect(ROUTE_START('S1', destination)).toBeNull();
  });

  it('missing vars entirely gives null, never a throw (a bad feed message must not crash the sign)', () => {
    expect(headlineLines(ANNOUNCE_STATES.ROUTE_START, undefined)).toBeNull();
    expect(headlineLines(ANNOUNCE_STATES.ROUTE_START, null)).toBeNull();
    expect(headlineLines(ANNOUNCE_STATES.ROUTE_START)).toBeNull();
  });
});

describe('headlineLines — the two stop states keep their existing behaviour', () => {
  it('APPROACHING: "This is" / town / stop', () => {
    expect(headlineLines(ANNOUNCE_STATES.APPROACHING, { stopName: 'Donington,Market Place' })).toEqual({
      verb: 'This is', town: 'Donington', stop: 'Market Place',
    });
  });

  it('STOP_DEPARTURE: "The next stop is" / town / stop', () => {
    expect(headlineLines(ANNOUNCE_STATES.STOP_DEPARTURE, { nextStopName: 'Wyberton,Fen Road Sainsbury Local' })).toEqual({
      verb: 'The next stop is', town: 'Wyberton', stop: 'Fen Road Sainsbury Local',
    });
  });

  it('each state reads only its own field', () => {
    expect(headlineLines(ANNOUNCE_STATES.APPROACHING, { nextStopName: 'A,B' })).toBeNull();
    expect(headlineLines(ANNOUNCE_STATES.STOP_DEPARTURE, { stopName: 'A,B' })).toBeNull();
    expect(headlineLines(ANNOUNCE_STATES.ROUTE_START, { stopName: 'A,B', nextStopName: 'A,B' })).toBeNull();
  });

  it('a stop name with no comma keeps the sentence', () => {
    expect(headlineLines(ANNOUNCE_STATES.APPROACHING, { stopName: 'Bicker Bar Hotel' })).toBeNull();
    expect(headlineLines(ANNOUNCE_STATES.STOP_DEPARTURE, { nextStopName: 'Bicker Bar Hotel' })).toBeNull();
  });
});

describe('headlineLines — how the name is split (every state)', () => {
  const stop = (name) => headlineLines(ANNOUNCE_STATES.APPROACHING, { stopName: name });

  it('splits at the FIRST comma only; everything after it is Line 3', () => {
    expect(stop('Boston,Bus Station, Bay 8')).toEqual({ verb: 'This is', town: 'Boston', stop: 'Bus Station, Bay 8' });
  });

  it('trims the space on either side of the comma', () => {
    expect(stop('  Boston , Bus Station  ')).toEqual({ verb: 'This is', town: 'Boston', stop: 'Bus Station' });
  });

  it.each([',Bus Station', 'Boston,', ' , ', ',', 'Boston,   '])(
    'an empty line ("%s") gives null, so the sentence is shown instead of a blank Line 2 or 3',
    (name) => {
      expect(stop(name)).toBeNull();
      expect(ROUTE_START('S1', name)).toBeNull();
    },
  );

  it('returns markup as literal text, unchanged (the sign writes it with textContent only)', () => {
    const evil = '<img src=x onerror=alert(1)>,<b>Stop</b>';
    expect(stop(evil)).toEqual({ verb: 'This is', town: '<img src=x onerror=alert(1)>', stop: '<b>Stop</b>' });
    expect(ROUTE_START('<i>S1</i>', 'A,B').verb).toContain('<i>S1</i>');
  });
});

describe('headlineLines — states that are never three-line', () => {
  it.each([
    ['idle', ANNOUNCE_STATES.IDLE],
    ['at_stop (terminus)', ANNOUNCE_STATES.AT_STOP],
    ['diversion', ANNOUNCE_STATES.DIVERSION],
    ['an unknown state', 'made_up'],
    ['no state', undefined],
    ['a prototype key', 'constructor'],
  ])('%s gives null even if the vars carry comma-separated names', (_l, stateKey) => {
    expect(headlineLines(stateKey, {
      stopName: 'A,B', nextStopName: 'A,B', destination: 'A,B', serviceCode: 'S1',
    })).toBeNull();
  });
});

describe('signStateAttribute — the value recorded as data-state on #onboard-sign', () => {
  it.each(Object.values(ANNOUNCE_STATES))('passes the known state "%s" through', (state) => {
    expect(signStateAttribute(state)).toBe(state);
  });

  it('records every state the sign can show, including idle', () => {
    expect(Object.values(ANNOUNCE_STATES).map(signStateAttribute).sort())
      .toEqual(['approaching', 'at_stop', 'diversion', 'idle', 'route_start', 'stop_departure']);
  });

  it.each([undefined, null])('no state (%s) is recorded as idle', (state) => {
    expect(signStateAttribute(state)).toBe('idle');
  });

  it.each(['made_up', '', 'constructor', '__proto__', 'ROUTE_START', 7, {}])(
    'an unrecognised value (%p) is recorded as "unknown", never echoed into the page',
    (state) => {
      expect(signStateAttribute(state)).toBe('unknown');
    },
  );
});

describe('the sign writes feed text with textContent only', () => {
  // Untrusted text (service code, destination, stop names) arrives from feeds and
  // the database. None of the ways of writing HTML may appear in the sign's code.
  const files = ['onboard.js', 'headlineLines.js', 'panelSizing.js'];
  it.each(files)('%s never uses innerHTML, outerHTML, insertAdjacentHTML or document.write', (file) => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'announce', 'src', file), 'utf8');
    expect(src).not.toMatch(/\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write\b/);
  });
});

describe('service worker precache', () => {
  // Network-first with runtime caching, so a missing entry only hurts a tablet that is
  // offline on its first load after a deploy — exactly the moment a kiosk cannot recover.
  it('lists announce/src/headlineLines.js so the new module is available offline', () => {
    const sw = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
    expect(sw).toContain("'./announce/src/headlineLines.js'");
  });
});
