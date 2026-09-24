// What the drain should do with one queued clip job, given the clip already
// stored under that key (docs/ANNOUNCE-VOICE-PLAN.md, "Never overwrite Ben").
import { ELEVENLABS_PREFIX } from './voiceConfig.mjs';

export function isElevenLabsVoice(voice) {
  return typeof voice === 'string' && voice.startsWith(ELEVENLABS_PREFIX) && voice.length > ELEVENLABS_PREFIX.length;
}

export function elevenLabsVoiceId(voice) {
  return isElevenLabsVoice(voice) ? voice.slice(ELEVENLABS_PREFIX.length) : null;
}

// 'render'               render and store a new clip
// 'skip-unchanged'       the stored clip already matches (same hash)
// 'skip-protected'       the stored clip is Ben and this job would replace it
//                        with a non-ElevenLabs voice, same wording. Never allowed.
// 'skip-protected-stale' as above, but the wording changed: the Ben clip is now
//                        out of date and still must not fall back to another
//                        voice, so the caller flags it for attention instead.
export function decideClipAction({ jobVoice, jobText, newHash, existing }) {
  if (!existing) return 'render';
  if (existing.hash === newHash) return 'skip-unchanged';
  if (isElevenLabsVoice(existing.voice) && !isElevenLabsVoice(jobVoice)) {
    return jobText !== undefined && existing.text !== undefined && jobText !== existing.text
      ? 'skip-protected-stale'
      : 'skip-protected';
  }
  return 'render';
}

// The stop behind an approach/departure clip key, or null for service/fixed clips.
const STOP_KEY = /^(approach|departure)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export function stopIdFromKey(key) {
  const m = STOP_KEY.exec(key ?? '');
  return m ? m[2] : null;
}
