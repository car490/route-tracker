// node --test scripts/db-drift/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runCheck, DEV_REF, PROD_REF } from './check.mjs';

const TOKEN = 'sbp_secret_token_value_1234567890';
const row = (kind, name, detail) => ({ kind, name, detail });
const QUERY = readFileSync(new URL('./fingerprint.sql', import.meta.url), 'utf8');

function harness({ files = {}, responses = {}, env = { SUPABASE_ACCESS_TOKEN: TOKEN } } = {}) {
  const out = [], calls = [], written = {};
  return {
    out, calls, written,
    deps: {
      env,
      log: (s) => out.push(String(s)),
      readText: (p) => {
        if (p in files) return files[p];
        return readFileSync(p, 'utf8'); // the committed fingerprint.sql / expected-differences.json
      },
      writeText: (p, s) => { written[p] = s; },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        const ref = url.split('/projects/')[1]?.split('/')[0];
        const r = responses[ref] ?? { status: 200, body: [] };
        return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) };
      },
    },
  };
}

test('live: reads both projects with the fixed read-only query, and exits 0 when they match', async () => {
  const same = [row('function', 'a()', 'h')];
  const h = harness({ responses: { [DEV_REF]: { status: 201, body: same }, [PROD_REF]: { status: 201, body: same } } });
  const code = await runCheck([], h.deps);
  assert.equal(code, 0);
  assert.equal(h.calls.length, 2);
  for (const c of h.calls) {
    assert.match(c.url, /^https:\/\/api\.supabase\.com\/v1\/projects\/[a-z]{20}\/database\/query$/);
    assert.equal(c.init.method, 'POST');
    assert.equal(c.init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.deepEqual(JSON.parse(c.init.body), { query: QUERY, read_only: true });
  }
  assert.match(h.out.join('\n'), /match/);
});

test('live: exits 1 and lists the drift when the projects differ', async () => {
  const h = harness({ responses: {
    [DEV_REF]: { status: 201, body: [row('table_grant', 'stops:anon', 'INSERT,SELECT')] },
    [PROD_REF]: { status: 201, body: [row('table_grant', 'stops:anon', 'SELECT')] },
  } });
  assert.equal(await runCheck([], h.deps), 1);
  assert.match(h.out.join('\n'), /table_grant stops:anon/);
});

test('without an access token it cannot run: exit 2 and says how to provide one', async () => {
  const h = harness({ env: {} });
  assert.equal(await runCheck([], h.deps), 2);
  assert.equal(h.calls.length, 0);
  assert.match(h.out.join('\n'), /SUPABASE_ACCESS_TOKEN/);
});

test('an API refusal exits 2 and never prints the token', async () => {
  const h = harness({ responses: { [DEV_REF]: { status: 401, body: { message: `bad token ${TOKEN}` } } } });
  assert.equal(await runCheck([], h.deps), 2);
  const printed = h.out.join('\n');
  assert.match(printed, /401/);
  assert.doesNotMatch(printed, new RegExp(TOKEN));
});

test('a malformed project ref is refused before any request', async () => {
  const h = harness();
  assert.equal(await runCheck(['--dev', '../../v1/organizations'], h.deps), 2);
  assert.equal(h.calls.length, 0);
});

test('offline: compares two saved fingerprints without a token or network', async () => {
  const h = harness({
    env: {},
    files: {
      'dev.json': JSON.stringify([row('extension', 'hypopg', 'installed')]),
      'prod.json': JSON.stringify([]),
      'expected.json': JSON.stringify({ differences: [{ kind: 'extension', name: 'hypopg', reason: 'advisor' }] }),
    },
  });
  assert.equal(await runCheck(['--from-json', 'dev.json', 'prod.json', '--expected', 'expected.json'], h.deps), 0);
  assert.equal(h.calls.length, 0);
});

test('--save writes each side\'s fingerprint for later comparison', async () => {
  const h = harness({ responses: { [DEV_REF]: { status: 201, body: [] }, [PROD_REF]: { status: 201, body: [] } } });
  assert.equal(await runCheck(['--save', 'snap'], h.deps), 0);
  assert.deepEqual(Object.keys(h.written).sort(), ['snap/dev.json', 'snap/prod.json']);
});

test('the committed expected-differences file is valid', async () => {
  const { parseExpectedDifferences } = await import('./driftCompare.mjs');
  const json = JSON.parse(readFileSync(new URL('./expected-differences.json', import.meta.url), 'utf8'));
  assert.ok(parseExpectedDifferences(json).length >= 1);
});
