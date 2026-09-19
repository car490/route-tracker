// Launcher for the replica harness. Read-only, binds 127.0.0.1 only.
//
//   node src/serveReplica.mjs --busops <path to pcv-dashboard/busops> [--port 8123]
//
// Then open http://127.0.0.1:8123/ in Chrome and press F11 for true size.

import { existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startReplicaServer } from './replicaServer.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const busopsDir = resolve(arg('busops') ?? process.env.BUSOPS_DIR ?? join(here, '../../../pcv-dashboard/busops'));
const port = Number(arg('port') ?? 8123);

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Invalid --port "${arg('port')}" (0-65535).`);
  process.exit(1);
}
if (!existsSync(join(busopsDir, 'announce', 'onboard.html'))) {
  console.error(`Cannot find announce/onboard.html under ${busopsDir}`);
  console.error('Pass the busops folder explicitly:  node src/serveReplica.mjs --busops <path to pcv-dashboard/busops>');
  process.exit(1);
}

const running = await startReplicaServer({
  busopsDir,
  replicaDir: join(here, '..', 'replica'),
  libDir: here,
  port,
});

console.log(`Announce replica harness (read-only, this computer only): http://${running.host}:${running.port}/`);
console.log(`Serving the sign from: ${busopsDir}`);
console.log('Keys: 1-9,0 pick a state | Left/Right step | S sizing | M measurements | K ruler | T anchor | R reload | H help');
console.log('Ctrl+C to stop.');

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { await running.close(); process.exit(0); });
}
