// mele-server/controllerScripts.test.js
//
// Runs the Controller's power-cut hardening scripts for real, with stand-in
// commands (systemctl, curl, sudo, git, npm, findmnt, id, apt-get) earlier on
// PATH that only record what they were asked to do. Proves behaviour, not
// just file contents (controllerHardening.test.js does that): the health
// check restarts only when it should, the update goes through the chroot
// when the disk is read-only, and setup refuses to run under a read-only
// disk before changing anything.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let dir;
let bin;
let log;

// A stand-in command: appends "<name> <args>" to the log, then runs `body`.
function stub(name, body = 'exit 0') {
  const file = path.join(bin, name);
  writeFileSync(file, `#!/usr/bin/env bash\necho "${name} $*" >> "${log}"\n${body}\n`);
  chmodSync(file, 0o755);
}

function run(script, { env = {}, args = [] } = {}) {
  return spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: path.join(dir, 'home'), ...env },
  });
}

const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'controller-'));
  bin = path.join(dir, 'bin');
  log = path.join(dir, 'calls.log');
  mkdirSync(bin);
  mkdirSync(path.join(dir, 'home'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('coachmate-healthcheck', () => {
  const SCRIPT = path.join(HERE, 'config/coachmate-healthcheck.sh');

  it('leaves a stopped service alone (stopped on purpose)', () => {
    stub('systemctl', '[ "$1" = "is-active" ] && exit 3; exit 0');
    stub('curl', 'exit 7');
    expect(run(SCRIPT).status).toBe(0);
    expect(calls().some((c) => c.startsWith('systemctl restart'))).toBe(false);
  });

  it('does nothing while the server answers', () => {
    stub('systemctl');
    stub('curl');
    expect(run(SCRIPT).status).toBe(0);
    expect(calls().some((c) => c.startsWith('systemctl restart'))).toBe(false);
  });

  it('counts an http-only server (no certificate) as answering', () => {
    stub('systemctl');
    stub('curl', 'case "$*" in *https://*) exit 7;; esac; exit 0');
    expect(run(SCRIPT).status).toBe(0);
    expect(calls().some((c) => c.startsWith('systemctl restart'))).toBe(false);
  });

  it('restarts coachmate-onboard when it is running but not answering', () => {
    stub('systemctl');
    stub('curl', 'exit 28');
    expect(run(SCRIPT).status).toBe(0);
    expect(calls()).toContain('systemctl restart coachmate-onboard');
  });
});

describe('update-controller.sh', () => {
  const SCRIPT = path.join(HERE, 'update-controller.sh');

  beforeEach(() => {
    mkdirSync(path.join(dir, 'home/route-tracker/pcv-dashboard/busops/announce/mele-server'), { recursive: true });
    stub('id', 'echo mele');
    stub('git');
    stub('npm');
    // sudo runs what it was given (dropping -H -u <user>), and overlayroot-chroot
    // just runs its command — enough to follow the path through.
    stub('sudo', 'if [ "$1" = "-H" ]; then shift 3; fi; exec "$@"');
    stub('overlayroot-chroot', 'exec "$@"');
  });

  it('with the read-only disk on, updates the real disk through overlayroot-chroot, then asks for a restart', () => {
    stub('findmnt', 'echo overlay');
    const result = run(SCRIPT);
    expect(result.status).toBe(0);
    expect(calls().some((c) => c.startsWith('sudo overlayroot-chroot /bin/bash -c '))).toBe(true);
    expect(calls().some((c) => c.startsWith('git -C') && c.includes('pull --ff-only origin develop'))).toBe(true);
    expect(calls()).toContain('npm ci --omit=dev');
    expect(result.stdout).toMatch(/sudo reboot/);
  });

  it('with the read-only disk off, updates in place without the chroot', () => {
    stub('findmnt', 'echo ext4');
    const result = run(SCRIPT, { args: ['main'] });
    expect(result.status).toBe(0);
    expect(calls().some((c) => c.includes('overlayroot-chroot'))).toBe(false);
    expect(calls().some((c) => c.startsWith('git -C') && c.includes('pull --ff-only origin main'))).toBe(true);
  });

  it('stops without installing anything if the pull fails (e.g. not a fast-forward)', () => {
    stub('findmnt', 'echo overlay');
    stub('git', 'exit 1');
    const result = run(SCRIPT);
    expect(result.status).not.toBe(0);
    expect(calls().some((c) => c.startsWith('npm'))).toBe(false);
  });

  it('refuses a branch name that is not a plain branch name (it ends up in a command run as root)', () => {
    stub('findmnt', 'echo overlay');
    const result = run(SCRIPT, { args: ["x'; touch /tmp/pwned; '"] });
    expect(result.status).not.toBe(0);
    expect(calls().some((c) => c.startsWith('sudo') || c.startsWith('git'))).toBe(false);
  });

  it('refuses to run as root', () => {
    stub('id', 'echo root');
    stub('findmnt', 'echo overlay');
    const result = run(SCRIPT);
    expect(result.status).not.toBe(0);
    expect(calls().some((c) => c.startsWith('git'))).toBe(false);
  });
});

describe('bootstrap-controller.sh', () => {
  it('refuses to run with the read-only disk on, before changing anything', () => {
    stub('findmnt', 'echo overlay');
    for (const name of ['sudo', 'apt-get', 'git', 'npm', 'systemctl', 'rfkill', 'curl']) stub(name);
    const result = run(path.join(HERE, 'bootstrap-controller.sh'));
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/overlayroot is on/);
    expect(calls()).toEqual(['findmnt -n -o FSTYPE /']);
  });
});
