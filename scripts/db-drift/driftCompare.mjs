// Pure comparison logic for scripts/db-drift/check.mjs: no network, no files.
// A fingerprint is the row set produced by fingerprint.sql: { kind, name, detail }.

// Supabase project refs are 20 lower-case letters. Checked before a ref is
// placed in an API URL, so a typo or crafted value can't redirect the request.
export function isProjectRef(ref) {
  return typeof ref === 'string' && /^[a-z]{20}$/.test(ref);
}

const keyOf = (r) => `${r.kind}\u0000${r.name}`;

// Accepts the rows the database returned; keeps only the three known string
// fields and refuses anything else, including two rows for the same object.
export function parseFingerprintRows(rows) {
  if (!Array.isArray(rows)) throw new Error('fingerprint: expected an array of rows');
  const seen = new Set();
  return rows.map((r, i) => {
    if (!r || typeof r !== 'object' || !['kind', 'name', 'detail'].every((f) => typeof r[f] === 'string')) {
      throw new Error(`fingerprint: row ${i} is not {kind, name, detail} strings`);
    }
    const clean = { kind: r.kind, name: r.name, detail: r.detail };
    const k = keyOf(clean);
    if (seen.has(k)) throw new Error(`fingerprint: duplicate row for ${clean.kind} ${clean.name}`);
    seen.add(k);
    return clean;
  });
}

// expected-differences.json: { differences: [{ kind, name, reason }] }.
// name may end in '*' (prefix match within that kind). A bare '*' would hide a
// whole kind, which is exactly the drift this check exists to catch: refused.
export function parseExpectedDifferences(json) {
  if (!json || !Array.isArray(json.differences)) throw new Error('expected differences: needs a "differences" array');
  return json.differences.map((d, i) => {
    for (const f of ['kind', 'name', 'reason']) {
      if (typeof d?.[f] !== 'string' || !d[f].trim()) throw new Error(`expected differences: entry ${i} needs a ${f}`);
    }
    if (d.name.trim() === '*') throw new Error(`expected differences: entry ${i} would hide a whole kind`);
    return { kind: d.kind, name: d.name, reason: d.reason };
  });
}

function matchesExpected(entry, kind, name) {
  if (entry.kind !== kind) return false;
  return entry.name.endsWith('*') ? name.startsWith(entry.name.slice(0, -1)) : entry.name === name;
}

export function compareFingerprints(devRows, prodRows, expectedDifferences = []) {
  const dev = new Map(parseFingerprintRows(devRows).map((r) => [keyOf(r), r]));
  const prod = new Map(parseFingerprintRows(prodRows).map((r) => [keyOf(r), r]));
  const used = new Set();
  const onlyDev = [], onlyProd = [], differ = [], expected = [];

  const setAside = (kind, name, what) => {
    const entry = expectedDifferences.find((e) => matchesExpected(e, kind, name));
    if (!entry) return false;
    used.add(entry);
    expected.push({ kind, name, what, reason: entry.reason });
    return true;
  };

  const keys = [...new Set([...dev.keys(), ...prod.keys()])].sort();
  for (const k of keys) {
    const d = dev.get(k), p = prod.get(k);
    const { kind, name } = d ?? p;
    if (d && p && d.detail === p.detail) continue;
    const what = !p ? 'only on dev' : !d ? 'only on production' : 'different';
    if (setAside(kind, name, what)) continue;
    if (!p) onlyDev.push(d);
    else if (!d) onlyProd.push(p);
    else differ.push({ kind, name, dev: d.detail, prod: p.detail });
  }

  return {
    matches: onlyDev.length + onlyProd.length + differ.length === 0,
    onlyDev, onlyProd, differ, expected,
    unusedExpected: expectedDifferences.filter((e) => !used.has(e)),
  };
}

export function formatReport(r) {
  const lines = [];
  lines.push(r.matches
    ? 'Dev and production match (structure and access rules).'
    : `Dev and production are DIFFERENT: ${r.differ.length} changed, ${r.onlyDev.length} only on dev, ${r.onlyProd.length} only on production.`);
  if (r.differ.length) {
    lines.push('', 'Different on each side:');
    for (const x of r.differ) lines.push(`  ${x.kind} ${x.name}`, `    dev:  ${x.dev}`, `    prod: ${x.prod}`);
  }
  if (r.onlyDev.length) {
    lines.push('', 'Present only on dev:');
    for (const x of r.onlyDev) lines.push(`  ${x.kind} ${x.name}  (${x.detail})`);
  }
  if (r.onlyProd.length) {
    lines.push('', 'Present only on production:');
    for (const x of r.onlyProd) lines.push(`  ${x.kind} ${x.name}  (${x.detail})`);
  }
  if (r.expected.length) {
    lines.push('', `Expected differences (${r.expected.length}, see expected-differences.json):`);
    for (const x of r.expected) lines.push(`  ${x.kind} ${x.name}: ${x.what} — ${x.reason}`);
  }
  if (r.unusedExpected.length) {
    lines.push('', 'Expected-difference entries that no longer match anything (remove them):');
    for (const e of r.unusedExpected) lines.push(`  ${e.kind} ${e.name}`);
  }
  return lines.join('\n');
}
