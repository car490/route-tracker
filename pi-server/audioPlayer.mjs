// Controller-side playback for PSVAIR announcement audio pushed from the
// Driver device (docs/CONTROLLER-REDESIGN.md §8). Deliberately dumb: no
// PSVAIR event-decision logic, no slug() scheme, no knowledge of stop IDs
// or service codes — the Driver has already resolved audioKeys to a ready,
// ordered list of clip filenames before broadcasting (see
// src/announcements.js's announce()/speak()). This module's only job is to
// play them, in order, from local disk.
//
// The busy/queue state machine mirrors src/announcements.js's playNow()/
// speak() (isBusy/queued there) — moved here rather than duplicated, per
// §8: once real playback happens on the Controller, it's the one that owns
// real-world timing (stopping a new announcement from cutting off one
// still playing), not the Driver. Mute is a Driver-side decision that
// gates whether an {type:'announce'} message is even sent — this module
// never re-checks it.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Same audio/ tree the Driver PWA ships (audio/announcements/*.mp3),
// cloned onto the Controller as part of its own repo checkout — treated as
// a build/deploy artifact, never fetched live (see pi-server/DEPLOY.md).
export const DEFAULT_AUDIO_DIR = path.join(__dirname, '..', 'audio', 'announcements');

// Real playback — spawns an external player process per clip, resolves
// once it exits (true) or fails to (false). mpg123 chosen for being a tiny,
// near-universally-packaged Debian/Ubuntu CLI mp3 player — see
// pi-server/DEPLOY.md for the `apt install` step. Swappable via
// createAudioPlayer's spawnPlayer option so tests don't need a real audio
// device or mpg123 installed.
function defaultSpawnPlayer(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('mpg123', ['-q', filePath], { stdio: 'ignore' });
    proc.on('error', () => resolve(false)); // player binary missing/not executable
    proc.on('close', (code) => resolve(code === 0));
  });
}

export function createAudioPlayer({ audioDir = DEFAULT_AUDIO_DIR, spawnPlayer = defaultSpawnPlayer, log = console } = {}) {
  let isBusy = false;
  // Holds at most the single most recent announcement that arrived while
  // something else was playing — same "never a growing backlog, a stale
  // one is simply superseded" precedent as announcements.js's own `queued`.
  let queued = null; // { text, audioKeys } | null

  function clipPath(key) {
    return path.join(audioDir, `${key}.mp3`);
  }

  // All-or-nothing: playing a partial or broken-off sentence out loud to
  // passengers is worse than silence. The browser's playSequence() falls
  // back to speechSynthesis on a miss instead (see announcements.js) — that
  // fallback doesn't port to Node (§8's explicit call), so here a missing
  // or failed clip means the whole announcement is silently skipped and
  // logged, never synthesized, never played half-finished.
  async function playSequence(keys) {
    const missing = keys.filter((key) => !existsSync(clipPath(key)));
    if (missing.length) {
      log.warn?.(`[audioPlayer] skipping announcement — missing clip(s): ${missing.join(', ')}`);
      return;
    }
    for (const key of keys) {
      const ok = await spawnPlayer(clipPath(key));
      if (!ok) {
        log.warn?.(`[audioPlayer] playback failed, aborting rest of announcement: ${key}.mp3`);
        return;
      }
    }
  }

  async function playNow(text, audioKeys) {
    isBusy = true;
    if (audioKeys && audioKeys.length) await playSequence(audioKeys);
    isBusy = false;

    if (queued) {
      const next = queued;
      queued = null;
      playNow(next.text, next.audioKeys); // fire-and-forget — same shape as announcements.js's own playNow()
    }
  }

  // Called once per {type:'announce'} message relayed from the Driver (see
  // server.mjs wiring this to attachAnnounceRelay's onAnnounce). Queues
  // rather than interrupts, same reasoning as announcements.js's speak():
  // cutting an announcement off mid-sentence is worse than a short delay.
  // Returns the in-flight playback promise when nothing was already
  // playing (undefined when queued instead, since that playback happens
  // later, chained internally) — production callers (server.mjs) ignore
  // this, same fire-and-forget shape as announcements.js's speak(); tests
  // use it to await deterministically instead of an arbitrary sleep.
  function enqueueAnnounce(text, audioKeys) {
    if (isBusy) {
      queued = { text, audioKeys };
      return undefined;
    }
    return playNow(text, audioKeys);
  }

  return { enqueueAnnounce };
}
