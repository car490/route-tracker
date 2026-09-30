// tests/soloKioskSettings.test.js
//
// Guards the Announce Solo tablet's Fully Kiosk settings
// (announce/cab-device/fully-auto-settings.json). Nothing checked this file
// before, so one wrong value could leave the sign dark after a power cut, or
// open the tablet up, with no test noticing.
//
// What it protects (docs/DECISIONS.md "Solo screen power", owner 2026-09-30):
//   - the path from power-on to the idle page with nobody touching it
//   - the screen switched by the sign itself through Fully's JavaScript
//     interface (PLUS) — allowed only with the kiosk restricted to our own
//     hosts, because that interface can do far more than switch the screen
//   - the power menu hidden, debugging and remote admin off
//   - no device token committed (the start URL is filled in at setup time)

const fs = require('fs');
const path = require('path');

const settings = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'announce', 'cab-device', 'fully-auto-settings.json'), 'utf8'
));

// Every host the sign loads anything from: the page (production and dev),
// Supabase (production and dev), Google Fonts' stylesheet and font files.
const ALLOWED_HOSTS = [
  'driver.pcvtechnologies.co.uk',
  'driver-dev.pcvtechnologies.co.uk',
  'nwhayupsvcelyiwltdqo.supabase.co',
  'cgcbfgceputvdvhzrgio.supabase.co',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

const whitelist = () => settings.urlWhitelist.split('\n').map((s) => s.trim()).filter(Boolean);

describe('Solo kiosk settings: power-on to the idle page, nobody touching it', () => {
  test.each([
    ['launchOnBoot', true],
    ['kioskMode', true],
    ['disableHomeButton', true],
    ['forceScreenUnlock', true],
    ['forceSwipeUnlock', true],
    ['restartOnCrash', true],
    ['runInForeground', true],
    ['autoImportSettings', true],
    ['wakeupOnPowerConnect', true],
    ['reloadOnInternet', true],
    ['reloadOnWifiOn', true],
    ['reloadPageFailure', '10'],
    // "Waiting for Connection" once held a tablet on a splash screen forever.
    ['waitInternetOnReload', false],
    // Fully must not put the screen to sleep on its own; the sign decides.
    ['sleepOnPowerDisconnect', false],
    ['forceSleepIfUnplugged', false],
    ['screenOffOnPowerConnect', false],
    ['sleepSchedule', ''],
  ])('%s is %p', (key, expected) => {
    expect(settings[key]).toBe(expected);
  });
});

describe('Solo kiosk settings: the sign switches its own screen', () => {
  test('Fully\'s JavaScript interface is on (fully.turnScreenOn/turnScreenOff)', () => {
    expect(settings.websiteIntegration).toBe(true);
  });

  test('the JavaScript interface is only ever on with the kiosk restricted to our own hosts', () => {
    if (!settings.websiteIntegration) return;
    expect(settings.urlWhitelist).toBeTruthy();
    const hostOf = (entry) => entry.match(/^https:\/\/([^/]+)\/\*$/)?.[1];
    for (const entry of whitelist()) {
      expect(ALLOWED_HOSTS).toContain(hostOf(entry));
    }
  });

  test('the restriction still lets the sign load everything it needs', () => {
    expect(whitelist()).toEqual(ALLOWED_HOSTS.map((host) => `https://${host}/*`));
  });

  test('no wildcard host, no plain http', () => {
    for (const entry of whitelist()) {
      expect(entry.startsWith('https://')).toBe(true);
      expect(entry.slice('https://'.length).split('/')[0]).not.toContain('*');
    }
  });
});

describe('Solo kiosk settings: locked down', () => {
  test.each([
    ['disableSystemDialogs', true], // hides the power menu (a 10 s hard press still restarts safely)
    ['webviewDebugging', false], // measure:announce-solo turns it on by hand when needed
    ['remoteAdmin', false],
    ['enablePopups', false],
    ['enableUrlOtherApps', false],
    ['fileUploads', false],
    ['ignoreSSLerrors', false],
    ['enableLocalhost', false],
    ['injectJsCode', ''],
  ])('%s is %p', (key, expected) => {
    expect(settings[key]).toBe(expected);
  });

  // Owner, 2026-09-30: the kiosk exit PIN is set on each tablet in Fully's
  // menu and never kept in the repo. The key is left out, not blanked: the
  // tablet re-imports this file when Fully starts, and an empty value there
  // would clear the tablet's own PIN on every restart.
  test('no kiosk PIN is committed, not even blank', () => {
    expect(Object.keys(settings).filter((k) => /pin/i.test(k) && /kiosk/i.test(k) && !/wifi/i.test(k))).toEqual([]);
  });

  test('no device token is committed: the start URL is filled in by setup-solo-device.sh', () => {
    expect(settings.startURL).toBe('__START_URL__');
  });
});
