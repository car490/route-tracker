// What the drain should do with one queued clip job, given the clip already
// stored under that key (docs/ANNOUNCE-VOICE-PLAN.md, "Never overwrite Ben").
import { ELEVENLABS_PREFIX } from './voiceConfig.mjs';

export function isElevenLabsVoice(voice) {
  return typeof voice === 'string' && voice.startsWith(ELEVENLABS_PREFIX) && voice.length > ELEVENLABS_PREFIX.length;
}

export function elevenLabsVoiceId(voice) {
  return isElevenLabsVoice(voice) ? voice.slice(ELEVENLABS_PREFIX.length) : null;
}

// 'render'         render and store a new clip
// 'skip-unchanged' the stored clip already matches (same hash)
// 'skip-protected' the stored clip is Ben and this job would replace it with
//                  a non-ElevenLabs voice. Never allowed, even if the text
//                  changed: the fix is to render Ben again, not fall back.
export function decideClipAction({ jobVoice, newHash, existing }) {
  if (!existing) return 'render';
  if (existing.hash === newHash) return 'skip-unchanged';
  if (isElevenLabsVoice(existing.voice) && !isElevenLabsVoice(jobVoice)) return 'skip-protected';
  return 'render';
}
