// Generates pre-rendered Azure Neural TTS audio clips for PSVAIR
// announcements, so the driver PWA plays a natural recorded voice instead
// of relying on whatever Web Speech API voice happens to be installed on
// a given tablet (see src/announcements.js).
//
// Every announcement sentence has exactly one variable slot (a stop name,
// or a service+destination pair) — so clips are rendered per stop / per
// service, not per route-leg. Re-run after stop names or routes change:
//   node scripts/generate-announcement-audio.mjs
//
// Requires:
//   AZURE_SPEECH_KEY    — key from an Azure AI Speech resource
//   AZURE_SPEECH_REGION — e.g. "uksouth"
// Optional:
//   AZURE_SPEECH_VOICE  — defaults to en-GB-SoniaNeural (the same voice
//                         already named first in PREFERRED_VOICE_NAMES)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createHash } from 'crypto';

const AZURE_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_REGION = process.env.AZURE_SPEECH_REGION;
const VOICE = process.env.AZURE_SPEECH_VOICE || 'en-GB-SoniaNeural';

if (!AZURE_KEY || !AZURE_REGION) {
  console.error('Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION before running this script.');
  console.error('(Azure Portal -> create/open a "Speech" resource -> Keys and Endpoint.)');
  process.exit(1);
}

const __dir = dirname(fileURLToPath(import.meta.url));
const scheduleJsonPath = join(__dir, '..', 'src', 'schedule.json');
const audioDir = join(__dir, '..', 'audio', 'announcements');
const manifestPath = join(audioDir, 'manifest.json');

// Mirrors stripSpeechAnnotations() in src/announcements.js — NaPTAN
// display names carry "(opp)"/"(NW-bound)"-style indicators that read
// awkwardly aloud; strip for speech, same as the live-synthesis path did.
function stripSpeechAnnotations(text) {
  return text.replace(/\s*\([^)]*\)/g, '');
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Includes VOICE so switching AZURE_SPEECH_VOICE forces a full re-render
// instead of every clip being skipped as "unchanged" (the text alone
// hasn't changed, only which voice speaks it).
function hashText(text) {
  return createHash('sha256').update(`${VOICE}|${text}`).digest('hex').slice(0, 16);
}

function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function synthesize(text) {
  const ssml = `<speak version="1.0" xml:lang="en-GB">` +
    `<voice name="${VOICE}">${escapeXml(text)}</voice></speak>`;
  const res = await fetch(
    `https://${AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_KEY,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-64kbitrate-mono-mp3',
        'User-Agent': 'route-tracker-announcement-audio',
      },
      body: ssml,
    }
  );
  if (!res.ok) throw new Error(`Azure TTS error ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

// Builds the deduplicated set of clips needed to cover every announcement
// currently producible by src/announcements.js, keyed by physical stop
// (stop_id) rather than by route-leg or timetable row.
function buildJobs(schedule) {
  const jobs = new Map();
  const stopNames = new Map(); // stop_id -> display name

  for (const serviceCode of Object.keys(schedule)) {
    for (const departureId of Object.keys(schedule[serviceCode])) {
      const stops = schedule[serviceCode][departureId].stops;
      if (!stops.length) continue;

      for (const stop of stops) {
        if (stop.stop_id && !stopNames.has(stop.stop_id)) {
          stopNames.set(stop.stop_id, stop.name);
        }
      }

      const destination = stripSpeechAnnotations(stops[stops.length - 1].name);
      const key = `service/${slug(serviceCode)}__${slug(destination)}`;
      if (!jobs.has(key)) {
        jobs.set(key, {
          key,
          relPath: `${key}.mp3`,
          text: `This is the ${serviceCode} service to ${destination}.`,
        });
      }
    }
  }

  for (const [stopId, name] of stopNames) {
    const clean = stripSpeechAnnotations(name);
    jobs.set(`stop/${stopId}`, {
      key: `stop/${stopId}`, relPath: `stop/${stopId}.mp3`,
      text: `This stop is ${clean}.`,
    });
    jobs.set(`next/${stopId}`, {
      key: `next/${stopId}`, relPath: `next/${stopId}.mp3`,
      text: `The next stop is ${clean}.`,
    });
    jobs.set(`arrive/${stopId}`, {
      key: `arrive/${stopId}`, relPath: `arrive/${stopId}.mp3`,
      text: `This is ${clean}.`,
    });
  }

  // Fully-fixed clips — no variable content, rendered once regardless of
  // route/stop data.
  jobs.set('terminus-tail', {
    key: 'terminus-tail', relPath: 'terminus-tail.mp3',
    text: 'This bus terminates here, all change please.',
  });
  jobs.set('diversion', {
    key: 'diversion', relPath: 'diversion.mp3',
    text: 'This bus is on diversion',
  });

  return [...jobs.values()];
}

async function main() {
  const schedule = JSON.parse(readFileSync(scheduleJsonPath, 'utf8'));
  const jobs = buildJobs(schedule);
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  const nextManifest = {};

  let rendered = 0, skipped = 0;
  for (const job of jobs) {
    const hash = hashText(job.text);
    nextManifest[job.key] = { path: job.relPath, hash, text: job.text };

    const outPath = join(audioDir, job.relPath);
    if (manifest[job.key]?.hash === hash && existsSync(outPath)) {
      skipped++;
      continue;
    }

    mkdirSync(dirname(outPath), { recursive: true });
    console.log(`Rendering ${job.relPath}  ("${job.text}")`);
    const mp3 = await synthesize(job.text);
    writeFileSync(outPath, mp3);
    rendered++;
  }

  // Renamed/removed stops leave orphaned clips — flagged, not auto-deleted,
  // since an already-cached service worker on a device may still want them
  // until it picks up the new manifest.
  const stale = Object.keys(manifest).filter(k => !(k in nextManifest));

  writeFileSync(manifestPath, JSON.stringify(nextManifest, null, 2));
  console.log(`\nDone. Rendered ${rendered}, skipped ${skipped} unchanged.`);
  if (stale.length) console.log(`Stale (safe to delete manually): ${stale.join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
