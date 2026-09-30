// node --test supabase/functions/_shared/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bearerToken, tokenMatches, isAuthorizedCaller } from './callerAuth.mjs';

const SECRET = 'eyJhbGciOiJIUzI1NiJ9.legacy-service-role-jwt';

test('the bearer token is read only from a well-formed "Bearer <token>" header', () => {
  assert.equal(bearerToken(`Bearer ${SECRET}`), SECRET);
  for (const bad of [null, undefined, '', 'Bearer', 'Bearer ', `bearer ${SECRET}`, SECRET, `Basic ${SECRET}`, `Bearer  ${SECRET}`, `Bearer ${SECRET} extra`]) {
    assert.equal(bearerToken(bad), '', String(bad));
  }
});

test('tokens match only when identical', async () => {
  assert.equal(await tokenMatches(SECRET, SECRET), true);
  assert.equal(await tokenMatches(SECRET + 'x', SECRET), false);
  assert.equal(await tokenMatches(SECRET.slice(0, -1), SECRET), false);
});

test('an empty token or an unset secret never matches (fails closed)', async () => {
  assert.equal(await tokenMatches('', SECRET), false);
  assert.equal(await tokenMatches(SECRET, undefined), false);
  assert.equal(await tokenMatches(SECRET, ''), false);
  assert.equal(await tokenMatches('', ''), false);
});

test('a caller is authorized only by the CALLER_AUTH_TOKEN secret', async () => {
  const env = (k) => ({ CALLER_AUTH_TOKEN: SECRET, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_other' })[k];
  assert.equal(await isAuthorizedCaller(`Bearer ${SECRET}`, env), true);
  assert.equal(await isAuthorizedCaller('Bearer sb_secret_other', env), false, 'the service-role key is not a caller credential');
  assert.equal(await isAuthorizedCaller(null, env), false);
  assert.equal(await isAuthorizedCaller(`Bearer ${SECRET}`, () => undefined), false, 'secret not set: refuse');
});
