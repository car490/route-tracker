// tests/assetsIgnore.test.js
//
// `wrangler deploy` publishes everything under busops/ to
// driver.pcvtechnologies.co.uk except what .assetsignore lists. Until
// 2026-09-30 that list missed announce/cab-device/ — so the Announce Solo
// tablet's Fully Kiosk settings (lockdown settings, encrypted kiosk PIN) and
// its setup script were public — and every *.test.js. This walks the real
// folder, applies the ignore rules the way wrangler does (gitignore syntax)
// and checks that only the app itself is left, so a new folder of tooling
// fails here instead of going public.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const rules = fs.readFileSync(path.join(root, '.assetsignore'), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

// The subset of gitignore syntax .assetsignore uses: "dir/", "a/b/",
// "name", "*.ext", ".env.*". A rule with no inner slash matches at any depth.
const globToRe = (glob) => new RegExp(`^${glob.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);

function isIgnored(rel) {
  const parts = rel.split('/');
  return rules.some((rule) => {
    const dirOnly = rule.endsWith('/');
    const pattern = dirOnly ? rule.slice(0, -1) : rule;
    const re = globToRe(pattern);
    if (pattern.includes('/')) {
      // Anchored to busops/.
      if (dirOnly) return rel.startsWith(`${pattern}/`);
      return re.test(rel);
    }
    const candidates = dirOnly ? parts.slice(0, -1) : parts;
    return candidates.some((p) => re.test(p));
  });
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue; // big, and ignored anyway
      walk(rel, out);
    } else {
      out.push(rel);
    }
  }
  return out;
}

const published = walk('').filter((rel) => !isIgnored(rel));

// What the Driver PWA and the Announce sign actually serve.
const APP = [
  /^service-worker\.js$/,
  /^_headers$/, /^_redirects$/, // Cloudflare's own config, read at deploy
  /^driver\/(index\.html|manifest\.json|style\.css)$/,
  /^driver\/lib\/leaflet\.min\.(js|css)$/,
  /^driver\/src\/([a-z]+\/)?[A-Za-z0-9_-]+\.js$/,
  /^driver\/src\/schedule\.json$/,
  /^driver\/audio\/announcements\/([a-z-]+\/)?[A-Za-z0-9_.-]+\.(mp3|json)$/,
  /^announce\/onboard\.(html|css)$/,
  /^announce\/lib\/supabase\.min\.js$/,
  /^announce\/src\/([A-Za-z]+\/)?[A-Za-z0-9_-]+\.js$/,
  /^shared\/[A-Za-z0-9_-]+\.(js|css)$/,
  /^shared\/icons\/[A-Za-z0-9_.-]+\.(png|svg|ico)$/,
];

test('the ignore rules read the way wrangler reads them', () => {
  expect(isIgnored('announce/mele-server/DEPLOY.md')).toBe(true);
  expect(isIgnored('node_modules/x/index.js')).toBe(true);
  expect(isIgnored('.env.local')).toBe(true);
  expect(isIgnored('announce/onboard.html')).toBe(false);
});

test('only the app itself is published', () => {
  expect(published.filter((rel) => !APP.some((re) => re.test(rel)))).toEqual([]);
});

test.each([
  'announce/cab-device/fully-auto-settings.json', // kiosk lockdown + encrypted PIN
  'announce/cab-device/setup-solo-device.sh',
  'driver/cab-device/fully-auto-settings.json',
  'driver/cab-device/setup-cab-device.sh',
  'announce/mele-server/DEPLOY.md',
  'announce/src/announceSoloAutopilot.test.js',
  'driver/src/main.dutyCard.test.js',
  'shared/escapeHtml.test.js',
  '_demo-real-controller.mjs',
  '.env.audio.example',
  '.assetsignore',
])('%s is not published', (rel) => {
  expect(isIgnored(rel)).toBe(true);
});

test('nothing a page loads is ignored (every precached asset is published)', () => {
  const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
  const assets = [...sw.match(/const STATIC_ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
  expect(assets.length).toBeGreaterThan(40);
  expect(assets.filter(isIgnored)).toEqual([]);
});
