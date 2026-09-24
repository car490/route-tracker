// Brief test 7: no ElevenLabs (or other) API key is ever committed. Scans every
// git-tracked file, including the Controller's clip folder and its manifest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dirname(fileURLToPath(import.meta.url)) }).toString().trim();
const files = execFileSync('git', ['ls-files'], { cwd: repoRoot }).toString().split('\n').filter(Boolean);

// ElevenLabs keys are "sk_" plus 40+ hex characters. The xi-api-key pattern
// catches a key pasted as a literal header value.
const PATTERNS = [
  /\bsk_[0-9a-f]{40,}\b/,
  /xi-api-key['"]?\s*[:=]\s*['"][A-Za-z0-9_]{20,}['"]/,
];

test('no API key is committed anywhere in the repo', () => {
  const hits = [];
  for (const f of files) {
    if (/\.(mp3|png|jpg|jpeg|gif|ico|pdf|woff2?|ttf|pbf|jar|zip)$/i.test(f)) continue;
    let text;
    try { text = readFileSync(join(repoRoot, f), 'utf8'); } catch { continue; }
    for (const p of PATTERNS) if (p.test(text)) hits.push(`${f} (${p})`);
  }
  assert.deepEqual(hits, []);
});
