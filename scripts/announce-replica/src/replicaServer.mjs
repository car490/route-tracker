// Replica harness server (slice 2). Read-only, localhost-only, dependency-free.
//
// Serves three things and nothing else:
//   /__replica/*      the harness page and its scripts       (replicaDir)
//   /__lib/signSizing.mjs  the sizing maths, one file only    (libDir)
//   /announce/... /shared/... /driver/src/config.js
//                     the sign itself and what it imports    (busopsDir, allowlist)
//
// The sign is served from an ALLOWLIST, not "everything under busops/", because
// busops/ also holds hardware/deploy material (mele-server/, cab-device/,
// *.local.* files). The service worker is deliberately not served: it would
// cache the sign and show stale CSS while the layout is being tuned.
//
// Usage:  node src/serveReplica.mjs --busops <path to pcv-dashboard/busops> [--port 8123]

import http from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { join, sep, extname } from 'node:path';

export const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// What the sign actually loads (verified against its import graph). Anything
// not matching one of these is a 404 regardless of whether it exists.
const BUSOPS_ALLOWLIST = [
  /^announce\/(onboard\.html|onboard\.css|branding-logo\.png)$/,
  /^announce\/src\/[A-Za-z0-9_-]+\.js$/,
  /^announce\/lib\/supabase\.min\.js$/,
  /^shared\/[A-Za-z0-9_-]+\.(js|css)$/,
  /^shared\/icons\/[A-Za-z0-9_.-]+\.(png|svg|ico)$/,
  /^driver\/src\/config\.js$/,
];
const REPLICA_FILE = /^[A-Za-z0-9_-]+\.(html|js|mjs|css|json)$/;
// The only library files the browser may fetch (pure maths + pure logic).
const LIB_FILES = new Set(['signSizing.mjs', 'replicaLogic.mjs', 'stopNames.mjs', 'candidates.mjs']);
const isTestFile = (rel) => /\.test\.m?js$/.test(rel);

const reject = (status, reason, extra = {}) => ({ kind: 'reject', status, reason, ...extra });

/**
 * Pure routing/rejection. Decides what a request may see BEFORE the disk is
 * touched. Returns:
 *   { kind: 'redirect', location } | { kind: 'reject', status, reason }
 *   { kind: 'file', root: 'replica' | 'lib' | 'busops', relPath }
 */
export function classifyRequest(method, rawUrl) {
  if (method !== 'GET' && method !== 'HEAD') return reject(405, 'method', { allow: 'GET, HEAD' });

  const rawPath = String(rawUrl).split(/[?#]/)[0];
  if (rawPath === '/') {
    // Keep a plain query (hud=1, scenario=3, ...) across the redirect; anything
    // outside a tight character set is dropped rather than echoed into a header.
    const query = (String(rawUrl).split('?')[1] ?? '').split('#')[0];
    const safe = query !== '' && /^[A-Za-z0-9=&._%-]+$/.test(query) && !/%0[dD]|%0[aA]/.test(query);
    return { kind: 'redirect', location: `/__replica/index.html${safe ? `?${query}` : ''}` };
  }
  if (!rawPath.startsWith('/') || rawPath.includes('\\')) return reject(400, 'malformed path');

  const rawSegments = rawPath.slice(1).split('/');
  const trailingSlash = rawSegments[rawSegments.length - 1] === '';
  if (trailingSlash) rawSegments.pop();
  if (rawSegments.some((s) => s === '')) return reject(400, 'empty path segment');

  const segments = [];
  for (const raw of rawSegments) {
    let seg;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return reject(400, 'bad percent-encoding');
    }
    // Checked AFTER decoding so %2e%2e, %2f, %5c and %00 are all caught.
    if (seg === '.' || seg === '..' || seg.includes('/') || seg.includes('\\') || seg.includes('\0')) {
      return reject(400, 'path traversal');
    }
    segments.push(seg);
  }
  if (trailingSlash) return reject(404, 'directory'); // no listings, ever

  const [top, ...rest] = segments;
  const relPath = rest.join('/');

  if (top === '__replica') {
    return REPLICA_FILE.test(relPath) && !isTestFile(relPath)
      ? { kind: 'file', root: 'replica', relPath }
      : reject(404, 'not found');
  }
  if (top === '__lib') {
    return LIB_FILES.has(relPath) ? { kind: 'file', root: 'lib', relPath } : reject(404, 'not found');
  }

  const busopsRel = segments.join('/');
  if (BUSOPS_ALLOWLIST.some((re) => re.test(busopsRel)) && !isTestFile(busopsRel)) {
    return { kind: 'file', root: 'busops', relPath: busopsRel };
  }
  return reject(404, 'not found');
}

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const HARNESS_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "frame-src 'self'",
  "connect-src 'self'",
].join('; ');

function send(res, status, headers, body) {
  res.writeHead(status, { ...BASE_HEADERS, ...headers });
  res.end(body);
}

/** Starts the server on 127.0.0.1 (never any other interface). */
export async function startReplicaServer({ busopsDir, replicaDir, libDir, port = 8123 } = {}) {
  const roots = { busops: busopsDir, replica: replicaDir, lib: libDir };
  for (const [name, dir] of Object.entries(roots)) {
    if (!dir) throw new Error(`${name} directory is required`);
  }
  const realRoots = {};
  for (const [name, dir] of Object.entries(roots)) realRoots[name] = await realpath(dir);

  const server = http.createServer(async (req, res) => {
    try {
      const c = classifyRequest(req.method, req.url);
      if (c.kind === 'redirect') return send(res, 302, { Location: c.location }, '');
      if (c.kind === 'reject') {
        return send(res, c.status, { 'Content-Type': 'text/plain; charset=utf-8', ...(c.allow ? { Allow: c.allow } : {}) },
          c.status === 400 ? 'Bad request' : c.status === 405 ? 'Method not allowed' : 'Not found');
      }

      // The realpath check stops a symlink inside an allowed folder from
      // pointing outside it.
      let real;
      try {
        real = await realpath(join(realRoots[c.root], c.relPath));
      } catch {
        return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
      }
      const inside = real.startsWith(realRoots[c.root] + sep);
      const info = inside ? await stat(real) : null;
      if (!inside || !info.isFile()) {
        return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
      }

      const headers = {
        'Content-Type': MIME[extname(real).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': info.size,
        ...(c.root === 'replica' && c.relPath === 'index.html' ? { 'Content-Security-Policy': HARNESS_CSP } : {}),
      };
      res.writeHead(200, { ...BASE_HEADERS, ...headers });
      if (req.method === 'HEAD') return res.end();
      createReadStream(real).pipe(res);
    } catch {
      if (!res.headersSent) send(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Server error');
      else res.destroy();
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: HOST, port }, resolve);
  });

  return {
    server,
    host: HOST,
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
