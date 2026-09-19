// Never print a secret. Tests written BEFORE the implementation (TDD).
//
// The tablet's page URL carries its device token (?announce-device-token=<JWT>, valid for 100
// years), and the sign's own console can echo URLs that carry a token too (a WebSocket URL with
// ?token=...). review-announce-solo.mjs printed both, into terminals, logs and, once, a
// conversation. Everything a script prints that came from the tablet now goes through
// redactSecrets(), which removes URL query strings and anything shaped like a JWT or a bearer token.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { redactSecrets } from './redact.mjs';

// not real: a JWT-shaped string built for the test
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIn0.c2lnbmF0dXJlLWZha2UtMTIzNDU';

describe('URL query strings (where the tokens live)', () => {
  test('the device token URL keeps its path and loses its whole query', () => {
    const out = redactSecrets(`Attached to: https://driver-dev.pcvtechnologies.co.uk/announce/onboard?announce-device-token=${JWT}&panel-profile=lite`);
    assert.equal(out, 'Attached to: https://driver-dev.pcvtechnologies.co.uk/announce/onboard?[query redacted]');
    assert.ok(!out.includes('eyJ'));
  });

  test('a WebSocket URL with ?token= (what the sign echoes when its relay is unreachable)', () => {
    const out = redactSecrets("WebSocket connection to 'ws://127.0.0.1:65258/sign-feed?token=SECRET-TOKEN' failed: 404");
    assert.equal(out, "WebSocket connection to 'ws://127.0.0.1:65258/sign-feed?[query redacted]' failed: 404");
  });

  test('inside JSON.stringify output the query ends at the closing quote', () => {
    const json = JSON.stringify([{ type: 'page', url: `https://h/announce/onboard?announce-device-token=${JWT}`, title: 'x' }]);
    const out = redactSecrets(json);
    assert.ok(!out.includes('eyJ'));
    assert.match(out, /"url":"https:\/\/h\/announce\/onboard\?\[query redacted\]","title":"x"/);
  });

  test('several URLs in one string are all redacted', () => {
    const out = redactSecrets('a https://h/x?a=1 b http://h2/y?b=2&c=3 c');
    assert.equal(out, 'a https://h/x?[query redacted] b http://h2/y?[query redacted] c');
  });

  test('a URL with no query is left exactly as it was (clip failures stay readable)', () => {
    const line = 'clip failed to load: https://x.supabase.co/storage/v1/object/public/announcement-audio/service/s125t__weston.mp3 MediaError';
    assert.equal(redactSecrets(line), line);
  });

  test('a fragment after the query is not swallowed into the redaction wrongly', () => {
    assert.equal(redactSecrets('https://h/p?token=abc#top'), 'https://h/p?[query redacted]#top');
  });
});

describe('secrets that are not in a URL', () => {
  test('a bare JWT is redacted', () => {
    const out = redactSecrets(`token is ${JWT} ok`);
    assert.equal(out, 'token is [jwt redacted] ok');
  });

  test('an Authorization bearer value is redacted', () => {
    assert.equal(redactSecrets('Authorization: Bearer abc.def-123_XYZ'), 'Authorization: Bearer [redacted]');
    assert.equal(redactSecrets('authorization: bearer SECRETVALUE'), 'authorization: bearer [redacted]');
  });

  test('token=value outside a URL is redacted', () => {
    assert.equal(redactSecrets('retrying with token=SECRETVALUE now'), 'retrying with token=[redacted] now');
    assert.equal(redactSecrets('announce-device-token: SECRETVALUE'), 'announce-device-token: [redacted]');
  });
});

describe('what it must not do', () => {
  test('text with no secret is returned unchanged', () => {
    for (const s of ['', 'nothing to see', 'Journey started on the tablet.', 'x-height 21.92 mm (letter "u")', 'a?b is a question, not a URL']) {
      assert.equal(redactSecrets(s), s);
    }
  });

  test('an ordinary word ending in "token" is not mangled', () => {
    assert.equal(redactSecrets('the tokenizer ran'), 'the tokenizer ran');
  });

  test('non-strings are turned into text first, never thrown on', () => {
    assert.equal(redactSecrets(undefined), 'undefined');
    assert.equal(redactSecrets(null), 'null');
    assert.equal(redactSecrets(42), '42');
    assert.ok(!redactSecrets({ url: `https://h/p?announce-device-token=${JWT}` }).includes('eyJ'));
  });

  test('is idempotent: redacting twice gives the same text', () => {
    const once = redactSecrets(`https://h/p?announce-device-token=${JWT}`);
    assert.equal(redactSecrets(once), once);
  });
});

describe('the scripts that talk to the tablet use it', () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

  test('review-announce-solo.mjs never prints the raw target URL or the raw target list', () => {
    const src = read('../../review-announce-solo.mjs');
    assert.ok(!/\$\{target\.url\}/.test(src), 'prints target.url unredacted');
    assert.ok(!/JSON\.stringify\(targets\)\}/.test(src.replace(/redactSecrets\(JSON\.stringify\(targets\)\)/g, '')), 'prints the raw target list');
    assert.match(src, /import \{ redactSecrets \}/);
  });

  test('review-announce-solo.mjs redacts what the tablet says (console lines and page errors)', () => {
    const src = read('../../review-announce-solo.mjs');
    assert.match(src, /\[tablet:\$\{p\.type\}\] \$\{redactSecrets\(text\)\}/);
    assert.match(src, /redactSecrets\(p\.exceptionDetails/);
  });

  test('measure-announce-solo.mjs redacts its error messages', () => {
    const src = read('../../measure-announce-solo.mjs');
    assert.match(src, /import \{ redactSecrets \}/);
    assert.match(src, /redactSecrets\(err\.message\)/);
  });
});
