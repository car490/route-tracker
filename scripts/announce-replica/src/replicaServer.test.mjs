// Slice 2 — replica harness server. Tests written BEFORE the implementation.
//
// Security posture under test (paramount for this project):
//   * localhost only, GET/HEAD only, read-only, no directory listings
//   * strict ALLOWLIST of what is served from the busops folder: the sign's own
//     html/css/js, its shared modules and driver/src/config.js. Nothing else —
//     so mele-server/ (which holds local hardware config), cab-device/, .env*
//     and *.local.* files are unreachable even though they sit under busops/
//   * path traversal in every encoding is rejected before touching the disk
//   * symlinks cannot escape the served roots
//   * the service worker is deliberately NOT served, so the harness can never
//     cache a stale copy of the sign while its CSS is being tuned

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { classifyRequest, startReplicaServer } from './replicaServer.mjs';

describe('classifyRequest — pure routing and rejection rules', () => {
  test('/ redirects to the harness page', () => {
    assert.deepEqual(classifyRequest('GET', '/'), { kind: 'redirect', location: '/__replica/index.html' });
  });

  test('/ keeps a plain query string across the redirect, but drops anything unusual', () => {
    assert.equal(classifyRequest('GET', '/?hud=1&scenario=3&sizing=x22').location, '/__replica/index.html?hud=1&scenario=3&sizing=x22');
    assert.equal(classifyRequest('GET', '/?measured100=98.5').location, '/__replica/index.html?measured100=98.5');
    for (const q of ['/?a=<script>', '/?a=%0d%0aSet-Cookie:x', '/?x="y"', "/?a='b'", '/?a=b c']) {
      assert.equal(classifyRequest('GET', q).location, '/__replica/index.html', q);
    }
  });

  test('harness files map to the replica root', () => {
    assert.deepEqual(classifyRequest('GET', '/__replica/index.html'), { kind: 'file', root: 'replica', relPath: 'index.html' });
    assert.deepEqual(classifyRequest('GET', '/__replica/replica.js?x=1'), { kind: 'file', root: 'replica', relPath: 'replica.js' });
  });

  test('only signSizing.mjs, replicaLogic.mjs, stopNames.mjs and candidates.mjs are exposed from the library root', () => {
    assert.deepEqual(classifyRequest('GET', '/__lib/signSizing.mjs'), { kind: 'file', root: 'lib', relPath: 'signSizing.mjs' });
    assert.deepEqual(classifyRequest('GET', '/__lib/replicaLogic.mjs'), { kind: 'file', root: 'lib', relPath: 'replicaLogic.mjs' });
    assert.deepEqual(classifyRequest('GET', '/__lib/candidates.mjs'), { kind: 'file', root: 'lib', relPath: 'candidates.mjs' });
    assert.deepEqual(classifyRequest('GET', '/__lib/stopNames.mjs'), { kind: 'file', root: 'lib', relPath: 'stopNames.mjs' });
    assert.equal(classifyRequest('GET', '/__lib/reviewStops.mjs').status, 404);
    assert.equal(classifyRequest('GET', '/__lib/stopNames.test.mjs').status, 404);
    assert.equal(classifyRequest('GET', '/__lib/candidates.test.mjs').status, 404);
    assert.equal(classifyRequest('GET', '/__lib/replicaServer.mjs').status, 404);
    assert.equal(classifyRequest('GET', '/__lib/replicaLogic.test.mjs').status, 404);
    assert.equal(classifyRequest('GET', '/__lib/serveReplica.mjs').status, 404);
    assert.equal(classifyRequest('GET', '/__lib/signSizing.test.mjs').status, 404);
  });

  test('the sign and what it imports are served from the busops root, query string ignored', () => {
    const ok = [
      '/announce/onboard.html?panel-profile=lite',
      '/announce/onboard.css',
      '/announce/branding-logo.png',
      '/announce/src/onboard.js',
      '/announce/src/announceDeviceFeed.js',
      '/announce/lib/supabase.min.js',
      '/shared/announceStates.js',
      '/shared/brand-tokens.css',
      '/shared/icons/icon-192.png',
      '/driver/src/config.js',
    ];
    for (const url of ok) {
      const r = classifyRequest('GET', url);
      assert.equal(r.kind, 'file', `${url} should be served`);
      assert.equal(r.root, 'busops', url);
    }
    assert.equal(classifyRequest('GET', '/announce/onboard.html?panel-profile=lite').relPath, 'announce/onboard.html');
  });

  test('HEAD is allowed like GET', () => {
    assert.equal(classifyRequest('HEAD', '/announce/onboard.css').kind, 'file');
  });

  test('everything outside the allowlist is 404, even if it exists on disk', () => {
    const blocked = [
      '/announce/mele-server/DEPLOY.md',
      '/announce/mele-server/start-temp-mele.local.ps1',
      '/announce/mele-server/autoinstall/user-data.local',
      '/announce/cab-device/setup-solo-device.sh',
      '/announce/cab-device/fully-auto-settings.json',
      '/driver/src/main.js',
      '/driver/src/supabaseApi.js',
      '/driver/index.html',
      '/service-worker.js',
      '/announce/onboard.html.bak',
      '/announce/src/onboard.test.js',
      '/announce/src/announceSoloAutopilot.test.js',
      '/shared/escapeHtml.test.js',
      '/shared/.env',
      '/.env',
      '/.env.local',
      '/package.json',
      '/server.js',
      '/wrangler.jsonc',
    ];
    for (const url of blocked) {
      const r = classifyRequest('GET', url);
      assert.equal(r.kind, 'reject', `${url} should be rejected`);
      assert.equal(r.status, 404, url);
    }
  });

  test('path traversal in every encoding is a 400, never a file', () => {
    const attacks = [
      '/announce/../.env',
      '/announce/%2e%2e/.env',
      '/announce/%2E%2E/%2E%2E/secret',
      '/announce/..%2f..%2fsecret',
      '/announce/..%5c..%5csecret',
      '/announce\\..\\secret',
      '/announce/onboard.html%00.png',
      '/__replica/../src/replicaServer.mjs',
      '/__replica/%2e%2e/src/replicaServer.mjs',
      '//etc/passwd',
      '/announce//onboard.html',
    ];
    for (const url of attacks) {
      const r = classifyRequest('GET', url);
      assert.equal(r.kind, 'reject', `${url} should be rejected`);
      assert.equal(r.status, 400, url);
    }
  });

  test('a malformed percent-escape is a 400 (no exception)', () => {
    assert.equal(classifyRequest('GET', '/announce/%E0%A4%A').status, 400);
  });

  test('anything but GET/HEAD is 405 with an Allow header', () => {
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const r = classifyRequest(m, '/announce/onboard.html');
      assert.equal(r.kind, 'reject');
      assert.equal(r.status, 405);
      assert.equal(r.allow, 'GET, HEAD');
    }
  });

  test('double-encoded traversal stays inert (decoded once it is a literal name, not in the allowlist)', () => {
    const r = classifyRequest('GET', '/announce/%252e%252e/.env');
    assert.equal(r.kind, 'reject');
  });
});

describe('startReplicaServer — real HTTP behaviour on a temp tree', () => {
  let base; // temp dir root
  let busops; let replica; let lib; let outside;
  let running;
  let port;

  before(async () => {
    base = mkdtempSync(join(tmpdir(), 'replica-srv-'));
    busops = join(base, 'busops');
    replica = join(base, 'replica');
    lib = join(base, 'lib');
    outside = join(base, 'outside');
    for (const d of [
      join(busops, 'announce', 'src'),
      join(busops, 'announce', 'mele-server'),
      join(busops, 'shared'),
      replica,
      lib,
      outside,
    ]) mkdirSync(d, { recursive: true });

    writeFileSync(join(busops, 'announce', 'onboard.html'), '<!doctype html><title>sign</title>');
    writeFileSync(join(busops, 'announce', 'onboard.css'), 'body{}');
    writeFileSync(join(busops, 'announce', 'src', 'onboard.js'), 'export const x = 1;');
    writeFileSync(join(busops, 'announce', 'mele-server', 'secret.local.ps1'), 'SECRET');
    writeFileSync(join(busops, '.env'), 'SECRET=1');
    writeFileSync(join(replica, 'index.html'), '<!doctype html><title>replica</title>');
    writeFileSync(join(lib, 'signSizing.mjs'), 'export const y = 2;');
    writeFileSync(join(outside, 'stolen.js'), 'export const stolen = true;');
    try {
      symlinkSync(join(outside, 'stolen.js'), join(busops, 'shared', 'link.js'));
    } catch { /* symlinks unavailable on this platform — that test skips itself */ }

    running = await startReplicaServer({ busopsDir: busops, replicaDir: replica, libDir: lib, port: 0 });
    port = running.port;
  });

  after(async () => {
    await running.close();
    rmSync(base, { recursive: true, force: true });
  });

  const get = (path, { method = 'GET' } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path, method }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      req.on('error', reject);
      req.end();
    });

  test('listens on 127.0.0.1 only', () => {
    assert.equal(running.host, '127.0.0.1');
    assert.equal(running.server.address().address, '127.0.0.1');
  });

  test('serves the sign with safe headers and correct types', async () => {
    const r = await get('/announce/onboard.html?panel-profile=lite');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /^text\/html/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.match(r.body, /<title>sign<\/title>/);

    const js = await get('/announce/src/onboard.js');
    assert.match(js.headers['content-type'], /javascript/);
    const css = await get('/announce/onboard.css');
    assert.match(css.headers['content-type'], /^text\/css/);
  });

  test('serves the harness page and the sizing library', async () => {
    assert.equal((await get('/__replica/index.html')).status, 200);
    const lib = await get('/__lib/signSizing.mjs');
    assert.equal(lib.status, 200);
    assert.match(lib.headers['content-type'], /javascript/);
  });

  test('root redirects to the harness page', async () => {
    const r = await get('/');
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/__replica/index.html');
  });

  test('files that exist on disk but are not allowlisted are 404 (no secret leaks)', async () => {
    const a = await get('/announce/mele-server/secret.local.ps1');
    assert.equal(a.status, 404);
    assert.ok(!a.body.includes('SECRET'));
    const b = await get('/.env');
    assert.equal(b.status, 404);
    assert.ok(!b.body.includes('SECRET'));
  });

  test('raw (un-normalised) traversal attempts never reach the disk', async () => {
    for (const path of [
      '/announce/%2e%2e/%2e%2e/outside/stolen.js',
      '/announce/..%2f..%2foutside/stolen.js',
      '/__replica/..%2flib%2fsignSizing.mjs',
    ]) {
      const r = await get(path);
      assert.equal(r.status, 400, path);
      assert.ok(!r.body.includes('stolen'));
    }
  });

  test('a symlink inside an allowed folder cannot escape it', async (t) => {
    const probe = await get('/shared/link.js');
    if (probe.status === 200 && probe.body.includes('stolen')) {
      assert.fail('symlink escaped the served root');
    }
    assert.notEqual(probe.status, 200);
    if (probe.status === 404 && !probe.body) t.diagnostic('symlink blocked or absent');
  });

  test('POST is refused; HEAD returns headers without a body', async () => {
    const post = await get('/announce/onboard.html', { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.allow, 'GET, HEAD');
    const head = await get('/announce/onboard.html', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
  });

  test('the service worker is never served', async () => {
    assert.equal((await get('/service-worker.js')).status, 404);
  });

  test('a directory request is not listed', async () => {
    const r = await get('/announce/src/');
    assert.equal(r.status, 404);
    const r2 = await get('/announce/');
    assert.equal(r2.status, 404);
  });
});
