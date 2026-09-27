// Pure logic for exporting announcement clips to the Bus Controller
// (docs/ANNOUNCE-VOICE-PLAN.md step 5). The Controller has no WAN path, so it
// plays committed files from busops/driver/audio/announcements/ (see
// mele-server/audioPlayer.mjs); this decides which clips go there.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// The only key shapes clipKeysFor() (shared/announcementAudio.js) produces.
// Keys come from the database, so anything else is refused before it becomes
// a file path (no "..", no absolute paths, no surprise folders).
const SAFE_KEY = new RegExp(`^(?:(?:approach|departure)/${UUID}|service/[a-z0-9_-]+|terminus|diversion)$`, 'i');
const STOP_KEY = new RegExp(`^(?:approach|departure)/(${UUID})$`, 'i');

export function isSafeClipKey(key) {
  return typeof key === 'string' && SAFE_KEY.test(key);
}

// Stop clips only for stops a timetable uses; route-start and fixed phrases always.
export function selectControllerClips(clips, usedStopIds) {
  const selected = [];
  const rejected = [];
  for (const c of clips) {
    if (!isSafeClipKey(c.key)) { rejected.push(c); continue; }
    const stop = STOP_KEY.exec(c.key);
    if (stop && !usedStopIds.has(stop[1].toLowerCase())) continue;
    selected.push(c);
  }
  return { selected, rejected };
}

// exists(relPath) -> boolean, relative to the audio folder.
export function planExport(clips, oldManifest, exists) {
  const download = [];
  const unchanged = [];
  for (const c of clips) {
    const rel = `${c.key}.mp3`;
    if (oldManifest?.[c.key]?.hash === c.hash && exists(rel)) unchanged.push(c);
    else download.push(c);
  }
  const current = new Set(clips.map((c) => c.key));
  const stale = Object.keys(oldManifest ?? {}).filter((k) => !current.has(k)).sort();
  return { download, unchanged, stale };
}

export function buildManifest(clips) {
  const out = {};
  for (const c of [...clips].sort((a, b) => a.key.localeCompare(b.key))) {
    out[c.key] = { path: `${c.key}.mp3`, hash: c.hash, text: c.text, voice: c.voice };
  }
  return out;
}
