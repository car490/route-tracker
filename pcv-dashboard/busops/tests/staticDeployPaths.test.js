// tests/staticDeployPaths.test.js
//
// The driver PWA is deployed root-relative (GitHub Pages today, moving to
// driver.pcvtechnologies.co.uk via Cloudflare Workers). These assert the manifest and
// service-worker registration stay path-agnostic — no hardcoded subpath
// prefix (e.g. "/route-tracker/") that would break once the app owns its
// own origin instead of living under a subpath.

import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');

describe('manifest.json start_url/scope', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'driver', 'manifest.json'), 'utf8'));

  test('start_url is root-relative, not tied to a subpath', () => {
    expect(manifest.start_url).toBe('./');
  });

  test('scope is root-relative, not tied to a subpath', () => {
    expect(manifest.scope).toBe('./');
  });
});

describe.each([
  ['driver/index.html', 'index.html'],
  ['announce/onboard.html', 'onboard.html'],
])('%s service worker registration', (relPath, file) => {
  const html = fs.readFileSync(path.join(root, relPath), 'utf8');

  test('registers with a bare relative path, no leading slash or subpath prefix', () => {
    const match = html.match(/serviceWorker\.register\(\s*['"]([^'"]+)['"]/);
    expect(match).not.toBeNull();
    const registeredPath = match[1];
    // Both driver/index.html and announce/onboard.html sit one level below
    // busops/, where service-worker.js lives — its scope must cover both,
    // hence the shared '../service-worker.js' registration path.
    expect(registeredPath).toBe('../service-worker.js');
    expect(registeredPath.startsWith('/')).toBe(false);
  });

  test('registration call passes no explicit scope option that could hardcode a subpath', () => {
    const match = html.match(/serviceWorker\.register\([^)]*\)/);
    expect(match[0]).not.toMatch(/scope\s*:/);
  });
});
