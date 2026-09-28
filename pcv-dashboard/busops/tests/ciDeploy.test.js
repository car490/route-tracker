// tests/ciDeploy.test.js
//
// The Driver deploy jobs in .github/workflows/ci.yml must never let an older
// commit's deploy land after a newer one. On 2026-09-27 PRs #100 and #101 were
// merged 3 s apart; both CI runs deployed to driver-dev and #100's (without
// the operator logo) finished last, so the site served code develop no
// longer had. Two guards, both needed:
// - concurrency: one deploy per site at a time (never cancelled mid-deploy);
// - a head check: a job whose commit is no longer the branch head skips the
//   deploy, because the newer commit's run deploys it. concurrency alone
//   serialises the jobs but does not order them.

import fs from 'fs';
import path from 'path';

const ci = fs.readFileSync(path.join(__dirname, '..', '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');

// The text of one top-level job: from its key to the next two-space-indented key.
function jobBlock(name) {
  const m = ci.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w-]+:\\n|(?![\\s\\S]))`, 'm'));
  if (!m) throw new Error(`job ${name} not found in ci.yml`);
  return m[1];
}

describe.each([
  ['deploy-driver-pwa-dev', 'develop'],
  ['deploy-driver-pwa-production', 'master'],
])('%s', (job, branch) => {
  const block = jobBlock(job);

  test('runs one deploy per site at a time, never cancelling one mid-deploy', () => {
    expect(block).toMatch(/^    concurrency:\n      group: deploy-driver-\$\{\{ github\.ref \}\}\n      cancel-in-progress: false$/m);
  });

  test(`checks the commit is still the head of ${branch} before deploying`, () => {
    expect(block).toContain(`git ls-remote --exit-code origin refs/heads/${branch}`);
    expect(block).toMatch(/^        id: head$/m);
    // The default step shell has no pipefail: an empty head must fail the
    // job rather than read as "a newer commit exists" and skip the deploy.
    expect(block).toContain('[ -n "$head" ] || {');
  });

  test('installs and deploys only when the commit is the branch head', () => {
    const steps = block.split(/^      - /m).filter((s) => /npm ci|wrangler deploy/.test(s));
    expect(steps).toHaveLength(2);
    for (const step of steps) expect(step).toMatch(/^        if: steps\.head\.outputs\.latest == 'true'$/m);
  });
});
