// node --test scripts/db-drift/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareFingerprints, parseFingerprintRows, parseExpectedDifferences, isProjectRef, formatReport,
} from './driftCompare.mjs';

const row = (kind, name, detail) => ({ kind, name, detail });

test('identical fingerprints match, whatever the row order', () => {
  const dev = [row('function', 'a()', 'h1'), row('table_grant', 'stops:anon', 'SELECT')];
  const prod = [row('table_grant', 'stops:anon', 'SELECT'), row('function', 'a()', 'h1')];
  const r = compareFingerprints(dev, prod);
  assert.equal(r.matches, true);
  assert.deepEqual([r.onlyDev, r.onlyProd, r.differ], [[], [], []]);
});

test('reports objects on one side only and objects that differ', () => {
  const dev = [row('table_grant', 'stops:anon', 'DELETE,INSERT,SELECT,UPDATE'), row('index', 'e.idx', 'x')];
  const prod = [row('table_grant', 'stops:anon', 'SELECT'), row('relation', 'old_table', 'table rls=true force=false')];
  const r = compareFingerprints(dev, prod);
  assert.equal(r.matches, false);
  assert.deepEqual(r.onlyDev.map((x) => x.name), ['e.idx']);
  assert.deepEqual(r.onlyProd.map((x) => x.name), ['old_table']);
  assert.deepEqual(r.differ, [{ kind: 'table_grant', name: 'stops:anon', dev: 'DELETE,INSERT,SELECT,UPDATE', prod: 'SELECT' }]);
});

test('an expected difference is set aside, with its reason, and does not fail the check', () => {
  const dev = [row('default_acl', 'supabase_admin:public:r:anon', 'DELETE,INSERT,SELECT,UPDATE')];
  const prod = [row('extension', 'hypopg', 'installed')];
  const expected = [
    { kind: 'default_acl', name: 'supabase_admin:*', reason: 'platform role' },
    { kind: 'extension', name: 'hypopg', reason: 'advisor' },
  ];
  const r = compareFingerprints(dev, prod, expected);
  assert.equal(r.matches, true);
  assert.deepEqual(r.expected.map((x) => x.reason), ['platform role', 'advisor']);
  assert.deepEqual(r.unusedExpected, []);
});

test('an expected-difference entry that no longer matches anything is reported, so the list cannot rot', () => {
  const r = compareFingerprints([], [], [{ kind: 'extension', name: 'hypopg', reason: 'advisor' }]);
  assert.equal(r.matches, true);
  assert.deepEqual(r.unusedExpected.map((e) => e.name), ['hypopg']);
});

test('a wildcard is only a trailing prefix; it never matches other kinds', () => {
  const dev = [row('table_grant', 'supabase_admin:anon', 'SELECT')];
  const r = compareFingerprints(dev, [], [{ kind: 'default_acl', name: 'supabase_admin:*', reason: 'x' }]);
  assert.equal(r.matches, false);
});

test('duplicate keys in a fingerprint are refused rather than silently collapsed', () => {
  assert.throws(() => parseFingerprintRows([row('function', 'a()', 'h1'), row('function', 'a()', 'h2')]), /duplicate/);
});

test('fingerprint rows must be plain {kind, name, detail} strings', () => {
  assert.deepEqual(parseFingerprintRows([{ kind: 'bucket', name: 'b', detail: 'public=true', extra: 1 }]),
    [row('bucket', 'b', 'public=true')]);
  for (const bad of [null, {}, [{ kind: 'x' }], [{ kind: 1, name: 'n', detail: 'd' }], 'text']) {
    assert.throws(() => parseFingerprintRows(bad), /fingerprint/, JSON.stringify(bad));
  }
});

test('the expected-differences file needs a kind, a name and a reason for every entry', () => {
  assert.deepEqual(parseExpectedDifferences({ differences: [{ kind: 'extension', name: 'hypopg', reason: 'r' }] }),
    [{ kind: 'extension', name: 'hypopg', reason: 'r' }]);
  assert.throws(() => parseExpectedDifferences({ differences: [{ kind: 'extension', name: 'hypopg' }] }), /reason/);
  assert.throws(() => parseExpectedDifferences({ differences: [{ kind: 'x', name: '*', reason: 'r' }] }), /whole kind/);
  assert.throws(() => parseExpectedDifferences([]), /differences/);
});

test('only well-formed Supabase project refs are accepted (they go into an API URL)', () => {
  assert.equal(isProjectRef('cgcbfgceputvdvhzrgio'), true);
  for (const bad of ['', 'CGCBFGCEPUTVDVHZRGIO', 'cgcbfgceputvdvhzrgi', '../../v1/projects', 'cgcbfgceputvdvhzrgio/x', null]) {
    assert.equal(isProjectRef(bad), false, String(bad));
  }
});

test('the report names every difference and says plainly whether they match', () => {
  const r = compareFingerprints(
    [row('table_grant', 'stops:anon', 'INSERT,SELECT'), row('index', 'e.idx', 'x')],
    [row('table_grant', 'stops:anon', 'SELECT')],
  );
  const text = formatReport(r);
  assert.match(text, /DIFFERENT/);
  assert.match(text, /table_grant stops:anon\n\s+dev:\s+INSERT,SELECT\n\s+prod:\s+SELECT/);
  assert.match(text, /only on dev.*\n\s+index e\.idx/);
  assert.match(formatReport(compareFingerprints([], [])), /^Dev and production match/);
});
