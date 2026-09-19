// Slice 2 — stop-name review logic (pure, read-only, no database access).
//
// Mirrors how the real sign consumes stops.announcement_name:
//   shared/announceStates.js stripIndicator(): drops one trailing "(...)" and puts a
//     space after every comma that lacks one;
//   announce/src/onboard.js renderHeadlineText(): splits at the FIRST comma, trims each
//     half. Line 2 = before the comma (locale), Line 3 = after it (actual stop).
//     No comma => one flowing sentence, where the stop name is not held to 22 mm.
// The data is untrusted text: nothing here is ever evaluated, and CSV output
// neutralises spreadsheet formulas.

const SEVERITY_RANK = { ok: 0, info: 1, warn: 2, error: 3 };
const ABBREVIATIONS = new Set(['PH', 'X', 'Rd', 'Rds', 'Ave']);
const MAX_PARTS = 3;      // "Description, Street, Town" is the most a real name needs
const MAX_LENGTH = 60;

// ── mirrors of the sign ─────────────────────────────────────────────────────
export function stripIndicator(name) {
  return String(name).replace(/\s*\([^)]*\)\s*$/, '').replace(/,(?=\S)/g, ', ');
}

export function splitLikeSign(text) {
  const s = stripIndicator(text);
  const i = s.indexOf(',');
  if (i === -1) return { threeLine: false, town: null, stop: null };
  return { threeLine: true, town: s.slice(0, i).trim(), stop: s.slice(i + 1).trim() };
}

// ── input ───────────────────────────────────────────────────────────────────
/** atco|name|announcement, one stop per line. Empty atco/announcement become null. */
export function parsePipeRows(text) {
  return String(text).split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l !== '').map((line, n) => {
    const f = line.split('|');
    if (f.length !== 3) throw new Error(`line ${n + 1}: expected 3 fields, found ${f.length}`);
    return { atcoCode: f[0] === '' ? null : f[0], name: f[1], announcementName: f[2] === '' ? null : f[2] };
  });
}

// ── review ──────────────────────────────────────────────────────────────────
const words = (t) => t.split(/[^A-Za-z0-9'’]+/).filter(Boolean);
const partsOf = (t) => t.split(',').map((p) => p.trim()).filter((p) => p !== '');
const looksLikeAddress = (t) => partsOf(t).length > MAX_PARTS || t.trim().length > MAX_LENGTH;
const hasCommaSpace = (t) => /,\s/.test(t);

function tidy(text) {
  let t = text.trim().replace(/\s{2,}/g, ' ');
  t = t.replace(/\s*,\s*/, ',');                       // first comma only
  t = t.replace(/\b([A-Z])([A-Z])([a-z]+)/g, (_m, a, b, c) => a + b.toLowerCase() + c);
  return t;
}

/** Only mechanical tidies, plus one clearly-labelled reorder for unreviewed NaPTAN copies. */
export function suggestFor({ name, announcementName }) {
  if (announcementName == null) return null;
  const ann = announcementName;
  if (looksLikeAddress(ann)) return null; // an address needs a human, not a guess

  if (ann === name && hasCommaSpace(ann) && !looksLikeAddress(ann)) {
    const parts = partsOf(ann);
    if (parts.length >= 2) {
      const locale = parts[parts.length - 1];
      return { text: `${locale},${parts.slice(0, -1).join(', ')}`, kind: 'reorder' };
    }
  }
  const t = tidy(ann);
  return t !== ann ? { text: t, kind: 'tidy' } : null;
}

export function reviewStop(row, { availablePx, widthsPx } = {}) {
  const { atcoCode, name, announcementName } = row;
  const effective = announcementName ?? name;
  const split = splitLikeSign(effective);
  const flags = [];
  const add = (id, severity, note) => flags.push({ id, severity, note });

  if (announcementName == null) add('no-announcement-name', 'warn', 'No announcement name set; the sign uses the NaPTAN name.');
  if (announcementName != null && announcementName === name && hasCommaSpace(announcementName)) {
    add('unreviewed-copy', 'warn', 'Identical to the NaPTAN name; probably never reviewed (NaPTAN puts the locality last).');
  }

  const stripped = stripIndicator(effective);
  const address = looksLikeAddress(stripped);
  if (address) add('address-not-a-name', 'error', 'Reads as an address, not a stop name.');

  if (!split.threeLine) {
    add('no-comma', 'error', 'No comma: shown as one sentence, so the stop name is not held to 22 mm.');
  } else {
    if (split.town === '' || split.stop === '') add('empty-half', 'error', 'Line 2 or Line 3 would be empty.');
    if (!address && partsOf(stripped).length > 2) add('multiple-commas', 'warn', 'Everything after the first comma goes on Line 3.');
    if (/^[^,]*,\s/.test(effective)) add('comma-space', 'warn', 'Comma followed by a space; stored convention is Locality,Description.');
  }

  if (effective !== effective.trim() || /\s{2,}/.test(effective)) add('stray-space', 'warn', 'Leading, trailing or doubled spaces.');

  const ws = words(stripped);
  if (ws.some((w) => /^[A-Z]{2}[a-z]+/.test(w))) add('odd-capitals', 'warn', 'Unusual capitals inside a word.');
  if (ws.some((w) => /^[A-Z]{3,}$/.test(w))) add('all-caps', 'error', 'A word in capitals only (Regulation 14(5)(a)).');
  if (ws.some((w) => ABBREVIATIONS.has(w))) add('abbreviation', 'info', 'Contains an abbreviation (also read aloud).');
  if (/\([^)]*\)\s*$/.test(effective)) add('indicator', 'info', 'Trailing (indicator); the sign strips it.');

  let fit = null;
  if (widthsPx && availablePx != null && split.threeLine) {
    fit = {
      availablePx,
      townPx: widthsPx.town, stopPx: widthsPx.stop,
      townOverPx: Math.max(0, widthsPx.town - availablePx),
      stopOverPx: Math.max(0, widthsPx.stop - availablePx),
    };
    if (fit.townOverPx > 0) add('town-scrolls', 'warn', 'Line 2 is wider than the screen at 22 mm and will scroll.');
    if (fit.stopOverPx > 0) add('stop-scrolls', 'warn', 'Line 3 is wider than the screen at 22 mm and will scroll.');
  }

  const severity = flags.reduce((w, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[w] ? f.severity : w), 'ok');
  return {
    atcoCode, name, announcementName, effective,
    threeLine: split.threeLine, town: split.town, stop: split.stop,
    flags, severity, fit, suggestion: suggestFor(row),
  };
}

export function summarise(reviews) {
  const bySeverity = { ok: 0, info: 0, warn: 0, error: 0 };
  const byFlag = {};
  for (const r of reviews) {
    bySeverity[r.severity] += 1;
    for (const f of r.flags) byFlag[f.id] = (byFlag[f.id] ?? 0) + 1;
  }
  return { total: reviews.length, bySeverity, byFlag };
}

// ── output ──────────────────────────────────────────────────────────────────
/** One CSV cell. Neutralises spreadsheet formulas (untrusted text), quotes as needed. */
export function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const COLUMNS = [
  ['atco_code', (r) => r.atcoCode],
  ['name', (r) => r.name],
  ['announcement_name', (r) => r.announcementName],
  ['severity', (r) => r.severity],
  ['flags', (r) => r.flags.map((f) => f.id).join(' ')],
  ['line2_shows', (r) => r.town],
  ['line3_shows', (r) => r.stop],
  ['line2_over_px', (r) => r.fit?.townOverPx],
  ['line3_over_px', (r) => r.fit?.stopOverPx],
  ['suggested_value', (r) => r.suggestion?.text],
  ['suggestion_kind', (r) => r.suggestion?.kind],
  ['your_value', () => ''],
];

export function toCsv(reviews) {
  const lines = [COLUMNS.map(([h]) => h).join(',')];
  for (const r of reviews) lines.push(COLUMNS.map(([, f]) => csvCell(f(r))).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}
