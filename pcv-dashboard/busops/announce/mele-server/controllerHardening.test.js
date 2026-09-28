// mele-server/controllerHardening.test.js
//
// Bus Controller hardening against sudden power loss (docs/HARDWARE.md
// "Sudden power loss / ignition-off", owner-approved 2026-09-28):
//   - read-only system disk (overlayroot, changes kept in RAM) — nothing the
//     Controller writes during a shift needs to survive a power cut
//   - logs in RAM too (journald volatile), no writable partition
//   - hardware watchdog, services restarted whenever they stop, and a
//     1-minute health check that restarts a hung coachmate-onboard
//   - updates only through update-controller.sh, which makes the disk
//     writable for the update alone
// None of this can run here (no MeLE, no overlayroot, no watchdog chip):
// these tests prove the files say the right thing and that the setup
// script actually installs every one of them. Whether it works on the box is
// proven by the bench test, docs/TESTING.md §19 part A.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveScheduleCachePath } from './scheduleCachePath.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(HERE, rel), 'utf8');
// Directive lines only: comments can mention anything.
const directives = (text) => text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const has = (text, line) => directives(text).includes(line);

const BOOTSTRAP = read('bootstrap-controller.sh');

// [config file in this repo, where the setup script must put it]
const INSTALLED = [
  ['config/overlayroot.conf', '/etc/overlayroot.local.conf'],
  ['config/coachmate-watchdog.conf', '/etc/systemd/system.conf.d/coachmate-watchdog.conf'],
  ['config/coachmate-journald.conf', '/etc/systemd/journald.conf.d/coachmate-volatile.conf'],
  ['config/coachmate-healthcheck.sh', '/usr/local/bin/coachmate-healthcheck'],
  ['config/coachmate-healthcheck.service', '/etc/systemd/system/coachmate-healthcheck.service'],
  ['config/coachmate-healthcheck.timer', '/etc/systemd/system/coachmate-healthcheck.timer'],
  // Drop-ins: an already-installed unit keeps its own lines (the push token,
  // hand-added TLS paths, the kiosk's filled-in URL); these layer the
  // hardening over it.
  ['config/coachmate-onboard-hardening.conf', '/etc/systemd/system/coachmate-onboard.service.d/hardening.conf'],
  ['config/coachmate-kiosk-hardening.conf', '/etc/systemd/system/coachmate-kiosk.service.d/hardening.conf'],
];

describe('read-only system disk', () => {
  it('keeps every change in RAM, so the disk is exactly as installed after each boot', () => {
    expect(has(read('config/overlayroot.conf'), 'overlayroot="tmpfs:recurse=0"')).toBe(true);
  });

  it('logs are kept in RAM, not on the disk', () => {
    const conf = read('config/coachmate-journald.conf');
    expect(has(conf, '[Journal]')).toBe(true);
    expect(has(conf, 'Storage=volatile')).toBe(true);
  });
});

describe('watchdogs', () => {
  it('the hardware watchdog restarts a frozen box', () => {
    const conf = read('config/coachmate-watchdog.conf');
    expect(has(conf, '[Manager]')).toBe(true);
    expect(has(conf, 'RuntimeWatchdogSec=30s')).toBe(true);
  });

  it('both services restart whenever they stop, not only on failure', () => {
    for (const unit of ['config/coachmate-onboard.service', 'config/coachmate-kiosk.service']) {
      expect(has(read(unit), 'Restart=always'), unit).toBe(true);
      expect(has(read(unit), 'Restart=on-failure'), unit).toBe(false);
    }
  });

  it('the same restart rule reaches a unit that was installed before this change', () => {
    for (const dropIn of ['config/coachmate-onboard-hardening.conf', 'config/coachmate-kiosk-hardening.conf']) {
      expect(has(read(dropIn), '[Service]'), dropIn).toBe(true);
      expect(has(read(dropIn), 'Restart=always'), dropIn).toBe(true);
    }
  });

  it('a health check runs every minute, from two minutes after boot', () => {
    const timer = read('config/coachmate-healthcheck.timer');
    expect(has(timer, 'OnBootSec=2min')).toBe(true);
    expect(has(timer, 'OnUnitActiveSec=1min')).toBe(true);
    expect(has(timer, 'WantedBy=timers.target')).toBe(true);
    expect(has(read('config/coachmate-healthcheck.service'), 'ExecStart=/usr/local/bin/coachmate-healthcheck')).toBe(true);
  });

  it('the health check only restarts coachmate-onboard, only while it is meant to be running, only when it stops answering', () => {
    const script = read('config/coachmate-healthcheck.sh');
    expect(script).toMatch(/systemctl is-active --quiet coachmate-onboard \|\| exit 0/);
    expect(script).toMatch(/curl -fs(k)? --max-time 5 .*127\.0\.0\.1/);
    expect(script).toMatch(/systemctl restart coachmate-onboard/);
    expect(script).not.toMatch(/reboot/);
  });
});

describe('where the schedule copy is written', () => {
  // CLAUDE.md: a real default path never exercised by any test once left the
  // Controller silent for months. This checks the path the service really uses.
  it('the service writes it to its own RAM directory, which stays writable with a read-only disk', () => {
    const unit = read('config/coachmate-onboard.service');
    expect(has(unit, 'RuntimeDirectory=coachmate')).toBe(true);
    const env = directives(unit).find((l) => l.startsWith('Environment=SCHEDULE_CACHE_PATH='));
    expect(env).toBe('Environment=SCHEDULE_CACHE_PATH=/run/coachmate/schedule-cache.json');
    const fromService = resolveScheduleCachePath({ SCHEDULE_CACHE_PATH: '/run/coachmate/schedule-cache.json' }, HERE);
    expect(fromService).toBe('/run/coachmate/schedule-cache.json');
  });

  it('the same setting reaches a coachmate-onboard unit installed before this change', () => {
    const dropIn = read('config/coachmate-onboard-hardening.conf');
    expect(has(dropIn, 'RuntimeDirectory=coachmate')).toBe(true);
    expect(has(dropIn, 'Environment=SCHEDULE_CACHE_PATH=/run/coachmate/schedule-cache.json')).toBe(true);
  });

  it('running locally with nothing set, it stays next to server.mjs as before', () => {
    expect(resolveScheduleCachePath({}, HERE)).toBe(path.join(HERE, 'schedule-cache.json'));
  });

  it('server.mjs actually uses it', () => {
    expect(read('server.mjs')).toMatch(/const CACHE_PATH = resolveScheduleCachePath\(process\.env, __dirname\);/);
  });
});

describe('bootstrap-controller.sh', () => {
  it.each(INSTALLED)('installs %s to %s', (source, dest) => {
    const installLine = BOOTSTRAP.split('\n').find((l) => l.includes(source) && l.includes(dest));
    expect(installLine, `no line installs ${source} to ${dest}`).toBeTruthy();
  });

  it('installs overlayroot and turns on the health check timer', () => {
    expect(BOOTSTRAP).toMatch(/apt-get install -y [^\n]*\boverlayroot\b/);
    expect(BOOTSTRAP).toMatch(/systemctl enable --now coachmate-healthcheck\.timer/);
  });

  it('refuses to run with the read-only disk on (its changes would vanish at the next power-off)', () => {
    const guard = BOOTSTRAP.indexOf('overlayroot is on');
    const firstChange = BOOTSTRAP.indexOf('apt-get install');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(firstChange);
  });

  it('switches the read-only disk on last, after everything else is installed', () => {
    const on = BOOTSTRAP.indexOf('/etc/overlayroot.local.conf');
    for (const unit of ['coachmate-onboard', 'coachmate-healthcheck.timer', 'hostapd dnsmasq']) {
      expect(BOOTSTRAP.indexOf(`enable --now ${unit}`), unit).toBeLessThan(on);
    }
  });
});

describe('update-controller.sh', () => {
  const UPDATE = read('update-controller.sh');

  it('makes the disk writable for the update only (inside overlayroot-chroot)', () => {
    expect(UPDATE).toMatch(/overlayroot-chroot/);
  });

  it('only fast-forwards, and installs exact dependency versions', () => {
    expect(UPDATE).toMatch(/git -C "\$REPO_DIR" pull --ff-only origin "\$REPO_BRANCH"/);
    expect(UPDATE).toMatch(/npm ci --omit=dev/);
  });

  it('asks for a restart to run the new version, rather than restarting services on a changed disk', () => {
    expect(UPDATE).toMatch(/reboot/);
  });
});

describe('every shell script', () => {
  const scripts = [
    ...readdirSync(HERE).filter((f) => f.endsWith('.sh')),
    ...readdirSync(path.join(HERE, 'config')).filter((f) => f.endsWith('.sh')).map((f) => `config/${f}`),
  ];

  it.each(scripts)('%s is valid bash', (script) => {
    expect(() => execFileSync('bash', ['-n', path.join(HERE, script)])).not.toThrow();
  });

  it.each(scripts)('%s fails on unset variables and failed pipes', (script) => {
    expect(read(script)).toMatch(/^set -e?uo pipefail$/m);
  });

  // bench-test-ap.sh deliberately runs on past a failed check so it can
  // report them all; scripts that change the box must stop at the first.
  it.each(['bootstrap-controller.sh', 'update-controller.sh', 'config/coachmate-healthcheck.sh'])(
    '%s stops on the first error', (script) => {
      expect(read(script)).toMatch(/^set -euo pipefail$/m);
    },
  );
});
