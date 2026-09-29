#!/usr/bin/env node
// Dev/production database parity check (read-only).
//
//   SUPABASE_ACCESS_TOKEN=<personal access token> node scripts/db-drift/check.mjs
//   node scripts/db-drift/check.mjs --save <dir>            # also keep both fingerprints
//   node scripts/db-drift/check.mjs --from-json dev.json prod.json   # compare saved ones, offline
//   options: --dev <ref> --prod <ref> --expected <file>
//
// Runs fingerprint.sql (catalog reads only, sent with read_only: true) on both
// projects through the Supabase Management API and compares the results.
// Exit 0: they match. 1: they differ (listed). 2: the check could not run.
// Dev and production must match; see supabase/migration_dev_prod_parity.sql.
//
// The token is read from the environment only, sent only to api.supabase.com,
// and never printed. The query is always the committed fingerprint.sql; there
// is no option to send any other SQL.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareFingerprints, formatReport, parseExpectedDifferences, parseFingerprintRows, isProjectRef } from './driftCompare.mjs';

export const DEV_REF = 'cgcbfgceputvdvhzrgio';   // route-tracker-dev (CLAUDE.md)
export const PROD_REF = 'nwhayupsvcelyiwltdqo';  // production
const HERE = dirname(fileURLToPath(import.meta.url));
const QUERY_FILE = join(HERE, 'fingerprint.sql');
const DEFAULT_EXPECTED = join(HERE, 'expected-differences.json');

class CannotRun extends Error {}

function parseArgs(argv) {
  const opts = { dev: DEV_REF, prod: PROD_REF, expected: DEFAULT_EXPECTED, save: null, fromJson: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new CannotRun(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--dev') opts.dev = next();
    else if (a === '--prod') opts.prod = next();
    else if (a === '--expected') opts.expected = next();
    else if (a === '--save') opts.save = next();
    else if (a === '--from-json') opts.fromJson = [next(), next()];
    else throw new CannotRun(`unknown option ${a}`);
  }
  return opts;
}

async function fetchFingerprint(ref, token, query, fetchImpl) {
  if (!isProjectRef(ref)) throw new CannotRun(`not a Supabase project ref: ${JSON.stringify(ref)}`);
  const res = await fetchImpl(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, read_only: true }),
  });
  if (!res.ok) {
    // The status is enough to act on; the body is not printed in case it echoes the request.
    throw new CannotRun(`the Supabase API refused the query for project ${ref} (HTTP ${res.status}). ` +
      'Check SUPABASE_ACCESS_TOKEN has access to this project.');
  }
  return parseFingerprintRows(await res.json());
}

export async function runCheck(argv, deps) {
  const { env, log, readText, writeText, fetchImpl } = deps;
  try {
    const opts = parseArgs(argv);
    const expected = parseExpectedDifferences(JSON.parse(readText(opts.expected)));

    let dev, prod;
    if (opts.fromJson) {
      dev = parseFingerprintRows(JSON.parse(readText(opts.fromJson[0])));
      prod = parseFingerprintRows(JSON.parse(readText(opts.fromJson[1])));
    } else {
      const token = env.SUPABASE_ACCESS_TOKEN;
      if (!token) {
        throw new CannotRun('SUPABASE_ACCESS_TOKEN is not set. Create a personal access token at ' +
          'https://supabase.com/dashboard/account/tokens and set it in your shell for this command only; never commit it.');
      }
      const query = readText(QUERY_FILE);
      dev = await fetchFingerprint(opts.dev, token, query, fetchImpl);
      prod = await fetchFingerprint(opts.prod, token, query, fetchImpl);
      if (opts.save) {
        writeText(join(opts.save, 'dev.json'), JSON.stringify(dev, null, 1));
        writeText(join(opts.save, 'prod.json'), JSON.stringify(prod, null, 1));
      }
    }

    const result = compareFingerprints(dev, prod, expected);
    log(formatReport(result));
    return result.matches ? 0 : 1;
  } catch (err) {
    log(`Could not check dev/production parity: ${err instanceof CannotRun ? err.message : err?.message ?? err}`);
    return 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const code = await runCheck(process.argv.slice(2), {
    env: process.env,
    log: (s) => console.log(s),
    readText: (p) => readFileSync(p, 'utf8'),
    writeText: (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); },
    fetchImpl: fetch,
  });
  process.exit(code);
}
