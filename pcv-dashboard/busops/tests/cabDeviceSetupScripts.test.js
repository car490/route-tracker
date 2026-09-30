// tests/cabDeviceSetupScripts.test.js
//
// Runs the two kiosk tablet setup scripts for real, against a stand-in `adb`
// that only records what it was asked to do (the scripts already take
// ADB=/path/to/adb), with no device attached.
//
// Why (owner, 2026-09-30): both scripts push fully-auto-settings.json to the
// tablet's shared Downloads folder for Fully Kiosk to import, and used to
// leave it there. On the Announce Solo tablet that copy holds the device's
// install link with its long-lived device token; any app with storage access,
// or anyone with a USB cable while debugging is on, could read it. Once Fully
// has imported the settings it keeps its own private copy, so the scripts now
// delete the Downloads copy — but only after the person at the tablet
// confirms it is showing the right page, so a failed import can still be done
// by hand from that file.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const SOLO = path.join(root, 'announce', 'cab-device', 'setup-solo-device.sh');
const DRIVER = path.join(root, 'driver', 'cab-device', 'setup-cab-device.sh');
const ON_DEVICE = '//sdcard/Download/fully-auto-settings.json';
const TOKEN_MARKER = 'TOKEN-MARKER-9f3c';
const INSTALL_LINK = `https://driver-dev.pcvtechnologies.co.uk/announce/onboard.html?announce-device-token=${TOKEN_MARKER}&operator-name=Test`;

// A stand-in adb: logs each call as one line; `shell ls <file>` succeeds only
// while the settings copy "exists" (after a push, before an rm).
function makeBin(dir) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(dir, 'adb.log');
  const exists = path.join(dir, 'on-device-copy');
  fs.writeFileSync(path.join(bin, 'adb'), `#!/bin/bash
echo "$*" >> "${log}"
case "$1 $2" in
  "get-state "*) echo device ;;
  "push "*) touch "${exists}" ;;
  "shell getprop") echo READY ;;
  "shell rm") [ -z "$KEEP_ON_RM" ] && rm -f "${exists}" ;;
  "shell ls") [ -f "${exists}" ] || exit 1 ;;
esac
exit 0
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'sleep'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  return { bin, log };
}

function run(script, { args = [], input = '', env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cab-setup-'));
  const { bin, log } = makeBin(dir);
  const result = spawnSync('bash', [script, ...args], {
    input,
    encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: dir, TMPDIR: dir, ADB: path.join(bin, 'adb'), ...env },
  });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  return { ...result, calls, output: `${result.stdout}${result.stderr}` };
}

const index = (calls, pattern) => calls.findIndex((c) => pattern.test(c));

describe.each([
  ['Solo', SOLO, [INSTALL_LINK]],
  ['Driver', DRIVER, []],
])('%s setup script', (_name, script, args) => {
  test('confirmed on screen: pushes, starts Fully, then deletes the Downloads copy and checks it is gone', () => {
    const r = run(script, { args, input: 'y\n' });
    expect(r.status).toBe(0);
    const push = index(r.calls, /^push .* \/\/sdcard\/Download\/fully-auto-settings\.json$/);
    const start = index(r.calls, /^shell am start -n de\.ozerov\.fully\//);
    const rm = index(r.calls, new RegExp(`^shell rm -f ${ON_DEVICE}$`));
    const check = index(r.calls, new RegExp(`^shell ls ${ON_DEVICE}$`));
    expect(push).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(push);
    expect(rm).toBeGreaterThan(start);
    expect(check).toBeGreaterThan(rm);
    expect(r.output).toMatch(/deleted/i);
  });

  test('not confirmed: keeps the copy for a manual import, says how to delete it, and exits non-zero', () => {
    const r = run(script, { args, input: 'n\n' });
    expect(r.status).not.toBe(0);
    expect(index(r.calls, /^shell rm /)).toBe(-1);
    expect(r.output).toContain(`adb shell rm -f ${ON_DEVICE}`);
  });

  test('no answer at all (not run at a keyboard): keeps the copy and exits non-zero', () => {
    const r = run(script, { args, input: '' });
    expect(r.status).not.toBe(0);
    expect(index(r.calls, /^shell rm /)).toBe(-1);
  });

  test('the copy is still there after the delete: says so and exits non-zero', () => {
    const r = run(script, { args, input: 'y\n', env: { KEEP_ON_RM: '1' } });
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/still on the tablet/i);
  });

  test('the checklist says to set the kiosk PIN on the tablet', () => {
    const r = run(script, { args, input: 'y\n' });
    expect(r.output).toMatch(/KIOSK EXIT PIN/);
  });
});

test('the Solo script never shows the install link or its device token', () => {
  for (const input of ['y\n', 'n\n']) {
    const r = run(SOLO, { args: [INSTALL_LINK], input });
    expect(r.output).not.toContain(TOKEN_MARKER);
  }
});

test('the Driver script names the real production address, not GitHub Pages', () => {
  const r = run(DRIVER, { input: 'y\n' });
  expect(r.output).toContain('https://driver.pcvtechnologies.co.uk/driver/');
  expect(r.output).not.toContain('github.io');
});

// Owner, 2026-09-30: each tablet's kiosk exit PIN is set in Fully's menu and
// never kept in the repo. Left out, not blanked: the tablet re-imports the
// settings file when Fully starts, and a blank value would clear its PIN.
// Both templates carried the same encrypted PIN until then.
test.each([
  ['Solo', path.join(root, 'announce', 'cab-device', 'fully-auto-settings.json')],
  ['Driver', path.join(root, 'driver', 'cab-device', 'fully-auto-settings.json')],
])('the %s settings template carries no kiosk PIN, not even blank', (_name, file) => {
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(Object.keys(settings).filter((k) => /kiosk/i.test(k) && /pin/i.test(k) && !/wifi/i.test(k))).toEqual([]);
});
