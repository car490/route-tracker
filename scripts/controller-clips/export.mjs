// Export the current announcement clips (Ben, or whatever voice each clip
// has) from Supabase Storage into busops/driver/audio/announcements/ for the
// Bus Controller, which plays committed files from local disk and never
// fetches live. Replaces scripts/generate-announcement-audio.mjs for the
// Controller: nothing is synthesised here, so the Controller plays exactly
// what the driver app and Announce Solo play.
//
//   npm run export:controller-clips            (production, from pcv-dashboard/busops)
//   npm run export:controller-clips -- --dev   (dev)
//   add --dry-run to print the plan and write nothing
//
// Then review the diff, commit, and the Controller picks it up on its next
// git pull (mele-server/DEPLOY.md). Reads only public data: the publishable
// key, the public announcement_clips table and schedule_view, and the public
// announcement-audio bucket. Old files are listed, never deleted.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { selectControllerClips, planExport, buildManifest } from './controllerClips.mjs';

const USE_DEV = process.argv.includes('--dev');
const DRY_RUN = process.argv.includes('--dry-run');
const SUPABASE_URL = USE_DEV ? 'https://cgcbfgceputvdvhzrgio.supabase.co' : 'https://nwhayupsvcelyiwltdqo.supabase.co';
// Publishable (public) keys, same as pcv-dashboard/busops/driver/src/config.js.
const SUPABASE_KEY = USE_DEV ? 'sb_publishable_LZVX8fASyDG8UtMp3eeRJQ_SBxpCa54' : 'sb_publishable_gij_rPjr2EJrcv0W9sU-Ow_C3nNqGcn';

const here = dirname(fileURLToPath(import.meta.url));
const audioDir = resolve(here, '..', '..', 'pcv-dashboard', 'busops', 'driver', 'audio', 'announcements');
const manifestPath = join(audioDir, 'manifest.json');

async function getAll(path) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}&limit=1000&offset=${offset}`, { headers: { apikey: SUPABASE_KEY } });
    if (!res.ok) throw new Error(`${path.split('?')[0]} fetch failed: ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function insideAudioDir(rel) {
  const full = resolve(audioDir, rel);
  const r = relative(audioDir, full);
  if (r.startsWith('..') || r.includes(`..${sep}`) || resolve(full) === audioDir) throw new Error(`refusing path outside the audio folder: ${rel}`);
  return full;
}

async function main() {
  console.log(`Exporting announcement clips from ${USE_DEV ? 'DEV' : 'PRODUCTION'} (${SUPABASE_URL})`);
  const clips = await getAll('announcement_clips?select=key,storage_path,hash,text,voice&order=key');
  const used = new Set((await getAll('schedule_view?select=stop_id')).map((r) => String(r.stop_id).toLowerCase()));

  const { selected, rejected } = selectControllerClips(clips, used);
  for (const r of rejected) console.warn(`Skipped a clip with an unexpected key: ${JSON.stringify(r.key)}`);

  const oldManifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  const plan = planExport(selected, oldManifest, (rel) => existsSync(insideAudioDir(rel)));

  if (DRY_RUN) {
    const voices = [...new Set(selected.map((c) => c.voice))];
    console.log(`Dry run: ${selected.length} clips for the Controller (${plan.download.length} to download, ${plan.unchanged.length} unchanged); voices: ${voices.join(', ')}`);
    console.log(`Would download: ${plan.download.slice(0, 10).map((c) => c.key).join(', ')}${plan.download.length > 10 ? ', ...' : ''}`);
    if (plan.stale.length) console.log(`No longer needed: ${plan.stale.length} (e.g. ${plan.stale.slice(0, 5).join(', ')})`);
    return;
  }

  for (const c of plan.download) {
    const url = `${SUPABASE_URL}/storage/v1/object/public/announcement-audio/${c.storage_path.split('/').map(encodeURIComponent).join('/')}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed for ${c.key}: ${res.status}`);
    const out = insideAudioDir(`${c.key}.mp3`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    console.log(`Downloaded ${c.key}  (${c.voice})`);
  }

  writeFileSync(manifestPath, JSON.stringify(buildManifest(selected), null, 2) + '\n');
  const voices = [...new Set(selected.map((c) => c.voice))].join(', ');
  console.log(`\nDone. ${selected.length} clips (${plan.download.length} downloaded, ${plan.unchanged.length} unchanged). Voices: ${voices}`);
  if (plan.stale.length) console.log(`No longer needed (safe to delete, then commit): ${plan.stale.join(', ')}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
