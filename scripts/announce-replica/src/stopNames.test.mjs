// Slice 2 — stop-name review logic. Tests written BEFORE the code.
//
// Mirrors how the real sign consumes stops.announcement_name:
//   shared/announceStates.js stripIndicator(): drops one trailing "(...)" and puts a
//     space after every comma that lacks one;
//   announce/src/onboard.js renderHeadlineText(): splits at the FIRST comma, trims each
//     half; Line 2 = before the comma (locale), Line 3 = after it (actual stop). No comma
//     => one flowing sentence, where the stop name is NOT held to the 22 mm rule.
// Read-only: nothing here touches a database.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  stripIndicator, splitLikeSign, parsePipeRows, reviewStop, suggestFor, summarise, csvCell, toCsv,
} from './stopNames.mjs';

const row = (name, ann, atco = '2700TEST0001') => ({ atcoCode: atco, name, announcementName: ann });
const ids = (r) => r.flags.map((f) => f.id);

describe('stripIndicator and splitLikeSign mirror the sign', () => {
  test('drops one trailing parenthetical and spaces every comma', () => {
    assert.equal(stripIndicator('Kirton End,Post Office (SW-bound)'), 'Kirton End, Post Office');
    assert.equal(stripIndicator('Boston,Bus Station'), 'Boston, Bus Station');
    assert.equal(stripIndicator('Plain Name'), 'Plain Name');
  });

  test('splits at the first comma only and trims both halves', () => {
    assert.deepEqual(splitLikeSign('Boston,Bus Station'), { threeLine: true, town: 'Boston', stop: 'Bus Station' });
    assert.deepEqual(splitLikeSign(' Wyberton, High Bridge (NE-bound)'), { threeLine: true, town: 'Wyberton', stop: 'High Bridge' });
    assert.deepEqual(splitLikeSign('Lincoln Road,Retail Park, Peterborough'), { threeLine: true, town: 'Lincoln Road', stop: 'Retail Park, Peterborough' });
  });

  test('no comma means the sentence path, with no town/stop split', () => {
    assert.deepEqual(splitLikeSign('Wheatsheaf PH'), { threeLine: false, town: null, stop: null });
  });
});

describe('parsePipeRows', () => {
  test('parses atco|name|announcement, empty announcement becomes null, empty atco becomes null', () => {
    const rows = parsePipeRows('2700A|Name One|Town,Stop\n|Name Two|\n');
    assert.deepEqual(rows, [
      { atcoCode: '2700A', name: 'Name One', announcementName: 'Town,Stop' },
      { atcoCode: null, name: 'Name Two', announcementName: null },
    ]);
  });

  test('keeps leading and trailing spaces in the data exactly (they are findings)', () => {
    const [r] = parsePipeRows('A|N| Wyberton,Stop \n');
    assert.equal(r.announcementName, ' Wyberton,Stop ');
  });

  test('rejects a line without exactly three fields', () => {
    assert.throws(() => parsePipeRows('only|two'));
    assert.throws(() => parsePipeRows('a|b|c|d'));
  });
});

describe('reviewStop — flags', () => {
  test('a clean Town,Stop is clean', () => {
    const r = reviewStop(row('Boots (o/s)', 'Boston,Market Place'));
    assert.deepEqual(r.flags, []);
    assert.equal(r.severity, 'ok');
    assert.equal(r.town, 'Boston');
    assert.equal(r.stop, 'Market Place');
  });

  test('no announcement name: falls back to the NaPTAN name and says so', () => {
    const r = reviewStop(row('Wheatsheaf PH (opp)', null));
    assert.ok(ids(r).includes('no-announcement-name'));
    assert.ok(ids(r).includes('no-comma'));
    assert.equal(r.severity, 'error');
    assert.equal(r.effective, 'Wheatsheaf PH (opp)');
  });

  test('no comma is an error: the stop name would not be held to 22 mm', () => {
    const r = reviewStop(row('Bicker Bar Hotel', 'Bicker Bar Hotel'));
    assert.ok(ids(r).includes('no-comma'));
    assert.equal(r.flags.find((f) => f.id === 'no-comma').severity, 'error');
  });

  test('multiple commas: everything after the first goes on Line 3', () => {
    const r = reviewStop(row('x', 'Lincoln Road,Retail Park, Peterborough'));
    assert.ok(ids(r).includes('multiple-commas'));
    assert.equal(r.stop, 'Retail Park, Peterborough');
  });

  test('an address is not a name: too many parts or far too long', () => {
    const long = 'The Donington Cowley Endowed Primary School, Town Dam Lane, Donington CP, South Holland, Lincolnshire, Greater Lincolnshire, England, PE11 4TR, United Kingdom';
    assert.ok(ids(reviewStop(row(long, long))).includes('address-not-a-name'));
    assert.ok(!ids(reviewStop(row('x', 'Boston,Bus Station'))).includes('address-not-a-name'));
  });

  test('comma followed by a space is flagged: not the stored Locality,Description convention', () => {
    assert.ok(ids(reviewStop(row('x', 'Bicker Bar, Hotel'))).includes('comma-space'));
    assert.ok(!ids(reviewStop(row('x', 'Bicker Bar,Hotel'))).includes('comma-space'));
  });

  test('a copy of the NaPTAN name is flagged as unreviewed', () => {
    const r = reviewStop(row('Armtree Road, Langrick', 'Armtree Road, Langrick'));
    assert.ok(ids(r).includes('unreviewed-copy'));
  });

  test('leading, trailing and doubled spaces are flagged', () => {
    assert.ok(ids(reviewStop(row('x', 'Astons Gowt,Telephone Box '))).includes('stray-space'));
    assert.ok(ids(reviewStop(row('x', ' Wyberton,High Bridge'))).includes('stray-space'));
    assert.ok(ids(reviewStop(row('x', 'Boston,Bus  Station'))).includes('stray-space'));
  });

  test('odd capitals such as KIrton are flagged', () => {
    assert.ok(ids(reviewStop(row('x', 'KIrton,Thomas Middlecott'))).includes('odd-capitals'));
    assert.ok(!ids(reviewStop(row('x', 'Kirton,Thomas Middlecott'))).includes('odd-capitals'));
    assert.ok(!ids(reviewStop(row('x', 'Boston,McDonalds'))).includes('odd-capitals'));
  });

  test('a word in capitals only is an error (Reg 14(5)(a)); short acronyms are not', () => {
    const r = reviewStop(row('x', 'Boston,BUS STATION'));
    assert.equal(r.flags.find((f) => f.id === 'all-caps').severity, 'error');
    assert.ok(!ids(reviewStop(row('x', 'Boston,Golden Cross PH'))).includes('all-caps'));
    assert.ok(!ids(reviewStop(row('x', 'Peterborough,A16 Stop'))).includes('all-caps'));
  });

  test('abbreviations are surfaced for a decision (they are also read aloud)', () => {
    assert.ok(ids(reviewStop(row('x', 'Swineshead,Blackjack X Rds'))).includes('abbreviation'));
    assert.ok(ids(reviewStop(row('x', 'Kirton,Golden Cross PH'))).includes('abbreviation'));
    assert.ok(!ids(reviewStop(row('x', 'Boston,Market Place'))).includes('abbreviation'));
  });

  test('a trailing indicator is noted, since the sign strips it', () => {
    assert.ok(ids(reviewStop(row('x', 'Wyberton,High Bridge (NE-bound)'))).includes('indicator'));
  });

  test('an empty half is an error', () => {
    assert.ok(ids(reviewStop(row('x', ',Bus Station'))).includes('empty-half'));
    assert.ok(ids(reviewStop(row('x', 'Boston,'))).includes('empty-half'));
  });

  test('severity is the worst flag; info-only rows are "info"', () => {
    assert.equal(reviewStop(row('x', 'Wyberton,High Bridge (NE-bound)')).severity, 'info');
    assert.equal(reviewStop(row('x', 'Bicker Bar, Hotel')).severity, 'warn');
  });
});

describe('reviewStop — fit at 22 mm (needs measured widths)', () => {
  test('flags a half wider than the line as scrolling, and says by how much', () => {
    const r = reviewStop(row('x', 'Frampton Marsh Village,Church'), { availablePx: 1370, widthsPx: { town: 2100, stop: 700 } });
    assert.deepEqual(ids(r), ['town-scrolls']);
    assert.equal(r.fit.townOverPx, 730);
    assert.equal(r.fit.stopOverPx, 0);
  });

  test('a half that fits is not flagged; exact fit passes', () => {
    const r = reviewStop(row('x', 'Boston,Market Place'), { availablePx: 1370, widthsPx: { town: 900, stop: 1370 } });
    assert.deepEqual(r.flags, []);
  });

  test('no widths given means no fit judgement, and the row says so', () => {
    const r = reviewStop(row('x', 'Boston,Market Place'));
    assert.equal(r.fit, null);
  });

  test('fit flags are warnings; long names scroll but do not break the sign', () => {
    const r = reviewStop(row('x', 'A,B'), { availablePx: 100, widthsPx: { town: 500, stop: 10 } });
    assert.equal(r.flags[0].severity, 'warn');
  });
});

describe('suggestFor — only mechanical tidies, and one clearly-labelled reorder', () => {
  test('tidy: trims, collapses spaces, uses the no-space comma convention, fixes odd capitals', () => {
    assert.deepEqual(suggestFor(row('x', 'Bicker Bar, Hotel')), { text: 'Bicker Bar,Hotel', kind: 'tidy' });
    assert.deepEqual(suggestFor(row('x', 'Astons Gowt,Telephone Box ')), { text: 'Astons Gowt,Telephone Box', kind: 'tidy' });
    assert.deepEqual(suggestFor(row('x', ' Wyberton, High Bridge (NE-bound)')), { text: 'Wyberton,High Bridge (NE-bound)', kind: 'tidy' });
    assert.deepEqual(suggestFor(row('x', 'KIrton,Thomas Middlecott')), { text: 'Kirton,Thomas Middlecott', kind: 'tidy' });
  });

  test('tidy only touches the FIRST comma; later commas keep their space', () => {
    assert.deepEqual(suggestFor(row('x', 'Lincoln Road,Retail Park,Peterborough')), null);
    assert.deepEqual(suggestFor(row('x', 'Lincoln Road, Retail Park, Peterborough')), { text: 'Lincoln Road,Retail Park, Peterborough', kind: 'tidy' });
  });

  test('reorder: an unreviewed copy of "Description, Locality" is offered as "Locality,Description"', () => {
    assert.deepEqual(suggestFor(row('Armtree Road, Langrick', 'Armtree Road, Langrick')), { text: 'Langrick,Armtree Road', kind: 'reorder' });
    assert.deepEqual(
      suggestFor(row('Ancaster Court, Broadfield Lane, Boston', 'Ancaster Court, Broadfield Lane, Boston')),
      { text: 'Boston,Ancaster Court, Broadfield Lane', kind: 'reorder' },
    );
  });

  test('a reviewed override that already looks right gets no suggestion', () => {
    assert.equal(suggestFor(row('Boots (o/s)', 'Boston,Market Place')), null);
  });

  test('no suggestion when there is nothing safe to say (no announcement name, no comma)', () => {
    assert.equal(suggestFor(row('Wheatsheaf PH (opp)', null)), null);
    assert.equal(suggestFor(row('Bicker Bar Hotel', 'Bicker Bar Hotel')), null);
  });

  test('an address gets no reorder guess', () => {
    const long = 'The Donington Cowley Endowed Primary School, Town Dam Lane, Donington CP, South Holland, Lincolnshire, Greater Lincolnshire, England, PE11 4TR, United Kingdom';
    assert.equal(suggestFor(row(long, long)), null);
  });
});

describe('summarise', () => {
  test('counts rows by severity and by flag', () => {
    const reviews = [
      reviewStop(row('a', 'Boston,Market Place')),
      reviewStop(row('b', 'Bicker Bar, Hotel')),
      reviewStop(row('c', null)),
    ];
    const s = summarise(reviews);
    assert.equal(s.total, 3);
    assert.equal(s.bySeverity.ok, 1);
    assert.equal(s.bySeverity.warn, 1);
    assert.equal(s.bySeverity.error, 1);
    assert.equal(s.byFlag['comma-space'], 1);
    assert.equal(s.byFlag['no-comma'], 1);
  });
});

describe('CSV output is safe to open in a spreadsheet (the data is untrusted)', () => {
  test('quotes commas, quotes and newlines', () => {
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell('l1\nl2'), '"l1\nl2"');
    assert.equal(csvCell('plain'), 'plain');
  });

  test('neutralises spreadsheet formulas by prefixing an apostrophe', () => {
    for (const evil of ['=HYPERLINK("http://x","y")', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1']) {
      assert.match(csvCell(evil), /^"?'/, evil);
    }
  });

  test('null and undefined become empty cells; numbers stay numbers', () => {
    assert.equal(csvCell(null), '');
    assert.equal(csvCell(undefined), '');
    assert.equal(csvCell(12.5), '12.5');
    assert.equal(csvCell(-3), '-3');
  });

  test('toCsv writes a header and one line per review, with a BOM so Excel reads UTF-8', () => {
    const out = toCsv([reviewStop(row('Boots (o/s)', 'Boston,Market Place'))]);
    assert.ok(out.startsWith('﻿'));
    const lines = out.replace('﻿', '').trim().split('\r\n');
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^atco_code,name,announcement_name,/);
    assert.match(lines[0], /your_value/);
    assert.match(lines[1], /Boston,Market Place|"Boston,Market Place"/);
  });
});
