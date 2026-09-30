// Caller check for Edge Functions invoked by pg_cron / database triggers via
// pg_net. Plain JS with no imports, so the Deno Edge Function and Node's test
// runner (callerAuth.test.mjs) share it.
//
// The caller sends the legacy service-role JWT stored in the vault secret
// naptan_import_token; CALLER_AUTH_TOKEN (an Edge Function secret, one value
// per project) holds the same value. The auto-injected SUPABASE_SERVICE_ROLE_KEY
// is NOT used as the caller credential: on these projects it has moved to the
// new sb_secret_ format, which the platform's verify_jwt gateway rejects, so no
// caller could ever match it (naptan-import returned 401 on every run until
// 2026-09-29). generate-announcement-clip solved the same problem the same way.

// "Bearer <token>" exactly; anything else yields '' (which never matches).
export function bearerToken(header) {
  const m = /^Bearer ([^\s]+)$/.exec(typeof header === 'string' ? header : '');
  return m ? m[1] : '';
}

// Constant-time comparison: hash both sides to fixed-length digests, then
// compare every byte, so response timing reveals nothing about how much of
// the secret a guess got right. An empty token or an unset secret never matches.
export async function tokenMatches(given, expected) {
  if (!given || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// getEnv: (name) => string | undefined, e.g. (k) => Deno.env.get(k).
export async function isAuthorizedCaller(authorizationHeader, getEnv) {
  return tokenMatches(bearerToken(authorizationHeader), getEnv('CALLER_AUTH_TOKEN'));
}
