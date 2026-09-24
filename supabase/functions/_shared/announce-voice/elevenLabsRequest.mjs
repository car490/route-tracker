// ElevenLabs text-to-speech request and the Ben clip hash
// (docs/ANNOUNCE-VOICE-PLAN.md). Field names checked 2026-09-24 against
// https://elevenlabs.io/docs/api-reference/text-to-speech/convert.
//
// The API key is passed in by the caller (an Edge Function secret) and only
// ever placed in the request headers. describe() is the only thing that may
// be logged, and it never includes the key.

const API_BASE = 'https://api.elevenlabs.io/v1/text-to-speech/';

export function buildElevenLabsRequest(text, voice, apiKey) {
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set');
  if (!text || !text.trim()) throw new Error('text is required');
  const url = `${API_BASE}${encodeURIComponent(voice.voiceId)}?output_format=${encodeURIComponent(voice.outputFormat)}`;
  const body = {
    text,
    model_id: voice.modelId,
    voice_settings: { ...voice.voiceSettings },
  };
  return {
    url,
    init: {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify(body),
    },
    describe: () => ({ url, voiceId: voice.voiceId, modelId: voice.modelId, chars: text.length }),
  };
}

// First 16 hex chars of sha256 over everything that changes how a Ben clip
// sounds: text, voice, model, settings, output format and levelling. Uses Web
// Crypto, available in both Deno and Node.
export async function elevenLabsClipHash(text, voice, levelling) {
  const material = JSON.stringify({
    text,
    voiceId: voice.voiceId,
    modelId: voice.modelId,
    outputFormat: voice.outputFormat,
    settings: Object.keys(voice.voiceSettings).sort().map((k) => [k, voice.voiceSettings[k]]),
    levelling,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
