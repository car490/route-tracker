// Never print a secret (tests in redact.test.mjs).
//
// The tablet's page URL carries its device token (?announce-device-token=<JWT>, valid for 100
// years), and the sign's own console can echo URLs that carry a token too. Anything a script
// prints that came from the tablet goes through redactSecrets(): URL query strings, JWT-shaped
// strings, bearer values and token=value pairs are removed. It errs towards removing too much:
// the paths of URLs stay, so a failing clip or page is still recognisable.

const QUERY_MARK = '[query redacted]';

// A URL's query, up to whitespace, a quote, a bracket or the fragment. The lookahead makes it
// idempotent (an already-redacted "?[query redacted]" is not redacted again).
const URL_QUERY = /((?:https?|wss?):\/\/[^\s?"'<>#)\]]*)\?(?!\[query redacted\])[^\s"'<>#)\]]*/g;
const JWT = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const BEARER = /\b(bearer)\s+[A-Za-z0-9._~+/=-]+/gi;
const TOKEN_PAIR = /\b(announce-device-token|announce-token|token)\b(\s*[=:]\s*)(?!\[redacted\])[^\s&"']+/gi;

export function redactSecrets(value) {
  let text;
  if (typeof value === 'string') text = value;
  else if (value === undefined) text = 'undefined';
  else {
    try { text = JSON.stringify(value); } catch { text = String(value); }
    if (typeof text !== 'string') text = String(value);
  }
  return text
    .replace(URL_QUERY, `$1?${QUERY_MARK}`)
    .replace(JWT, '[jwt redacted]')
    .replace(BEARER, '$1 [redacted]')
    .replace(TOKEN_PAIR, '$1$2[redacted]');
}
