// Pinned configuration for the ElevenLabs announcement voice
// (docs/ANNOUNCE-VOICE-PLAN.md). Every Ben clip is rendered with exactly
// these values; they are folded into each clip's hash, so changing any of
// them re-renders every Ben clip the next time its job runs.
//
// Plain JS with no imports, so both the Deno Edge Function and Node's test
// runner can load it.

// app_config.announcement_voice values that select ElevenLabs look like
// "elevenlabs:<voice id>". Anything else is an Azure voice name.
export const ELEVENLABS_PREFIX = 'elevenlabs:';

export const BEN = Object.freeze({
  voiceId: 'eUlIljct4YrEQRcEqrii', // "Ben - Warm British Male" (not a secret)
  modelId: 'eleven_multilingual_v2',
  // mp3_44100_128 is the best MP3 the Starter plan allows (192 kbps needs Creator; PCM/WAV need Pro).
  outputFormat: 'mp3_44100_128',
  voiceSettings: Object.freeze({
    stability: 0.5,
    similarity_boost: 1.0,
    style: 0, // audition decides 0 vs 0.5 (plan, step 6)
    use_speaker_boost: true,
    speed: 0.9, // John, 2026-09-24
  }),
});

// Loudness levelling (plan, "Loudness"). -21 LUFS matches the existing Azure
// clips (measured -20.2 to -21.9), so the amplifier setting on each vehicle
// doesn't change when the voice does.
export const LEVELLING = Object.freeze({
  version: 1, // bump when the levelling algorithm changes, to force re-renders
  targetLufs: -21,
  toleranceLu: 1,
  truePeakCeilingDb: -1,
  encodeHeadroomDb: 0.5, // level to -1.5 dBTP so MP3 encoding can't push peaks over -1
  keepLeadSeconds: 0.05,
  keepTailSeconds: 0.15,
  silenceThresholdDb: -50,
  maxLeadSeconds: 0.12,
  maxTailSeconds: 0.25,
});

// Clips per drain run when rendering with ElevenLabs. Each clip costs about
// 0.3-0.4 s of Edge Function CPU (measured 2026-09-24), so a few per run keeps
// well inside the function's allowance.
export const ELEVENLABS_BATCH_SIZE = 3;

// Jobs that fail this many times stop being retried automatically, so a bad
// key or a clip that can't be levelled can't burn credits in a loop.
export const MAX_JOB_ATTEMPTS = 3;
