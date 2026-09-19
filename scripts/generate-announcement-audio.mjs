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
//   AZURE_SPEECH_VOICE  — defaults to en-GB-RyanNeural (a natural-sounding
//                         male English-GB voice — matches the browser
//                         speechSynthesis fallback's own preferred voice,
//                         see shared/speech.js's PREFERRED_VOICE_NAMES)
//
// Changing AZURE_SPEECH_VOICE (or this default), or AUDIO_FORMAT, re-renders
// every clip, not just new ones — hashText() folds both into each clip's hash,
// so a change makes every existing hash mismatch.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createHash } from 'crypto';
// Same a/an logic the live app uses for the visual headline and the
// synthesis fallback (shared/announceStates.js) — imported directly rather
// than re-implemented here, so a recorded clip's wording can never drift
// from what onboard.js displays for the same state.
import { articleFor } from '../pcv-dashboard/busops/shared/announceStates.js';

const AZURE_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_REGION = process.env.AZURE_SPEECH_REGION;
const VOICE = process.env.AZURE_SPEECH_VOICE || 'en-GB-RyanNeural';
// Highest quality at the neural voices' native 24 kHz (it was audio-16khz-64kbitrate-mono-mp3, Azure's
// lowest MP3 tier). Must equal AUDIO_FORMAT in supabase/functions/generate-announcement-clip/index.ts
// (tests/announcementAudioFormat.test.js fails if they differ). It is part of every clip's hash, so a
// format change re-renders every clip. NOTE: the clips committed under busops/driver/audio/announcements
// were rendered at the old format; running this script re-renders and replaces all of them, which is
// roughly 2.5x the bytes (about 8 MB becomes about 20 MB).
const AUDIO_FORMAT = 'audio-24khz-160kbitrate-mono-mp3';

if (!AZURE_KEY || !AZURE_REGION) {
  console.error('Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION before running this script.');
  console.error('(Azure Portal -> create/open a "Speech" resource -> Keys and Endpoint.)');
  process.exit(1);
}

const __dir = dirname(fileURLToPath(import.meta.url));
const scheduleJsonPath = join(__dir, '..', 'pcv-dashboard', 'busops', 'driver', 'src', 'schedule.json');
const audioDir = join(__dir, '..', 'pcv-dashboard', 'busops', 'driver', 'audio', 'announcements');
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

// Includes VOICE and AUDIO_FORMAT so switching AZURE_SPEECH_VOICE, or the audio
// quality, forces a full re-render instead of every clip being skipped as
// "unchanged" (the text alone hasn't changed, only how it is spoken).
function hashText(text) {
  return createHash('sha256').update(`${VOICE}|${AUDIO_FORMAT}|${text}`).digest('hex').slice(0, 16);
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
        'X-Microsoft-OutputFormat': AUDIO_FORMAT,
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
          text: `This is ${articleFor(serviceCode)} ${serviceCode} to ${destination}.`,
        });
      }
    }
  }

  // Redesigned 2026-09-02 alongside shared/announceStates.js's text (see
  // that file's header comment) — one clip per state, keyed by stop, no
  // more final/non-final variants and no more splicing two clips together
  // (APPROACHING and AT_STOP-final used to each combine two sentences;
  // neither does any more).
  for (const [stopId, name] of stopNames) {
    const clean = stripSpeechAnnotations(name);
    jobs.set(`approach/${stopId}`, {
      key: `approach/${stopId}`, relPath: `approach/${stopId}.mp3`,
      text: `This is ${clean}.`,
    });
    jobs.set(`departure/${stopId}`, {
      key: `departure/${stopId}`, relPath: `departure/${stopId}.mp3`,
      text: `The next stop is ${clean}.`,
    });
  }

  // Fully-fixed clips — no variable content, rendered once regardless of
  // route/stop data.
  jobs.set('terminus', {
    key: 'terminus', relPath: 'terminus.mp3',
    text: 'This service terminates here, all change please.',
  });
  jobs.set('diversion', {
    key: 'diversion', relPath: 'diversion.mp3',
    text: 'Attention, this bus is on diversion.',
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
