// Generates the stop-by-stop AV announcement sequence for S116S/S125S (both
// directions) as one JSON file, for the interactive review Artifact.
//
// Deliberately does NOT hand-transcribe any wording — it drives the real
// `resolveAnnouncementText()` from shared/announceStates.js with the same
// vars shapes announceSoloAutopilot.js/main.js use, so the review page can
// never drift from what the app actually says/shows. Stop data comes from
// driver/src/schedule.json, the same file demo-announce-solo.mjs reads.
//
// Usage: node scripts/generate-announce-review.mjs
// Writes: scripts/announce-review-data.json

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { resolveAnnouncementText, ANNOUNCE_STATES, articleFor } from '../pcv-dashboard/busops/shared/announceStates.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const schedulePath = join(ROOT, 'pcv-dashboard/busops/driver/src/schedule.json');
const schedule = JSON.parse(readFileSync(schedulePath, 'utf8'));

// Matches announceStates.js's own private stripIndicator() — duplicated
// locally per this codebase's existing convention (demo-announce-solo.mjs,
// main.js, announceSoloAutopilot.js each keep their own copy rather than
// exporting it, since it's a one-line regex, not worth a shared import).
const stripIndicator = (name) => name.replace(/\s*\([^)]*\)\s*$/, '');

const SERVICES = ['S116S', 'S125S'];

function buildDeparture(serviceCode, departureId, dep) {
  const stops = dep.stops.map((s) => ({ ...s, name: stripIndicator(s.name) }));
  const destination = stops[stops.length - 1].name;
  const lastIndex = stops.length - 1;
  const steps = [];

  steps.push({
    event: 'ROUTE_START',
    stopName: null,
    text: resolveAnnouncementText(ANNOUNCE_STATES.ROUTE_START, { serviceCode, destination }),
    visual: 'normal',
    firesOnce: true,
  });

  for (let i = 0; i <= lastIndex; i++) {
    const stop = stops[i];
    const isFinal = i === lastIndex;

    if (i > 0) {
      steps.push({
        event: 'APPROACHING',
        stopName: stop.name,
        text: resolveAnnouncementText(ANNOUNCE_STATES.APPROACHING, { stopName: stop.name, isFinal }),
        visual: 'normal',
      });
    }

    if (isFinal) {
      steps.push({
        event: 'AT_STOP',
        stopName: stop.name,
        text: resolveAnnouncementText(ANNOUNCE_STATES.AT_STOP, { stopName: stop.name, isFinal: true }),
        visual: 'terminus',
      });
    } else {
      const next = stops[i + 1];
      steps.push({
        event: 'STOP_DEPARTURE',
        stopName: stop.name,
        text: resolveAnnouncementText(ANNOUNCE_STATES.STOP_DEPARTURE, { nextStopName: next.name }),
        visual: 'normal',
        note: i === 0 ? 'origin stop — fires right after ROUTE_START, no APPROACHING before it' : undefined,
      });
    }
  }

  return {
    serviceCode,
    departureId,
    label: dep.label,
    departureTime: dep.departure_time,
    destination,
    article: articleFor(serviceCode),
    stopCount: stops.length,
    stepCount: steps.length,
    steps,
  };
}

const departures = [];
for (const service of SERVICES) {
  const serviceDepartures = schedule[service];
  if (!serviceDepartures) {
    console.error(`No "${service}" entry in schedule.json — run scripts/generate-schedule.mjs first?`);
    process.exit(1);
  }
  for (const [departureId, dep] of Object.entries(serviceDepartures)) {
    departures.push(buildDeparture(service, departureId, dep));
  }
}

// Diversion isn't part of the normal per-stop sequence (it's a one-shot
// auto-detect trigger, not a scheduled step) — included once, separately,
// so the review page can still show its rule/wording for reference.
const diversion = {
  event: 'DIVERSION',
  text: resolveAnnouncementText(ANNOUNCE_STATES.DIVERSION, {}),
  visual: 'diversion',
};

const outPath = join(ROOT, 'scripts/announce-review-data.json');
writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), departures, diversion }, null, 2));
console.log(`Wrote ${departures.length} departures (${departures.reduce((n, d) => n + d.stepCount, 0)} steps total) to ${outPath}`);
