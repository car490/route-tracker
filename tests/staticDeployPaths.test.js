// tests/staticDeployPaths.test.js
//
// The driver PWA is deployed root-relative (GitHub Pages today, moving to
// driver.coachmate.uk via Cloudflare Workers). These assert the manifest and
// service-worker registration stay path-agnostic — no hardcoded subpath
// prefix (e.g. "/route-tracker/") that would break once the app owns its
// own origin instead of living under a subpath.

import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');

describe('manifest.json start_url/scope', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

  test('start_url is root-relative, not tied to a subpath', () => {
    expect(manifest.start_url).toBe('./');
  });

  test('scope is root-relative, not tied to a subpath', () => {
    expect(manifest.scope).toBe('./');
  });
});

describe.each(['index.html', 'onboard.html'])('%s service worker registration', (file) => {
  const html = fs.readFileSync(path.join(root, file), 'utf8');

  test('registers with a bare relative path, no leading slash or subpath prefix', () => {
    const match = html.match(/serviceWorker\.register\(\s*['"]([^'"]+)['"]/);
    expect(match).not.toBeNull();
    const registeredPath = match[1];
    expect(registeredPath).toBe('service-worker.js');
    expect(registeredPath.startsWith('/')).toBe(false);
  });

  test('registration call passes no explicit scope option that could hardcode a subpath', () => {
    const match = html.match(/serviceWorker\.register\([^)]*\)/);
    expect(match[0]).not.toMatch(/scope\s*:/);
  });
});
