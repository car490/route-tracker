import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildElevenLabsRequest, elevenLabsClipHash } from './elevenLabsRequest.mjs';
import { BEN, LEVELLING } from './voiceConfig.mjs';

const FAKE_KEY = 'sk_test_0000000000000000000000000000000000000000000000';

test('builds the documented text-to-speech request with the pinned settings', () => {
  const req = buildElevenLabsRequest('This is Boston, College.', BEN, FAKE_KEY);
  const url = new URL(req.url);
  assert.equal(url.origin + url.pathname, `https://api.elevenlabs.io/v1/text-to-speech/${BEN.voiceId}`);
  assert.equal(url.searchParams.get('output_format'), 'mp3_44100_128');
  assert.equal(req.init.method, 'POST');
  assert.equal(req.init.headers['xi-api-key'], FAKE_KEY);
  assert.equal(req.init.headers['Content-Type'], 'application/json');
  const body = JSON.parse(req.init.body);
  assert.deepEqual(body, {
    text: 'This is Boston, College.',
    model_id: 'eleven_multilingual_v2',
    voice_settings: { stability: 0.5, similarity_boost: 1.0, style: 0, use_speaker_boost: true, speed: 0.9 },
  });
});

test('the loggable description of a request never contains the key', () => {
  const req = buildElevenLabsRequest('This is Kirton.', BEN, FAKE_KEY);
  assert.ok(!JSON.stringify(req.describe()).includes(FAKE_KEY));
  assert.ok(!String(req.url).includes(FAKE_KEY));
});

test('refuses to build a request without a key or text', () => {
  assert.throws(() => buildElevenLabsRequest('This is Kirton.', BEN, ''), /ELEVENLABS_API_KEY/);
  assert.throws(() => buildElevenLabsRequest('', BEN, FAKE_KEY), /text/);
});

test('clip hash is stable, and changes with the text, any voice setting, the model or the levelling', async () => {
  const base = await elevenLabsClipHash('This is Kirton.', BEN, LEVELLING);
  assert.match(base, /^[0-9a-f]{16}$/);
  assert.equal(await elevenLabsClipHash('This is Kirton.', BEN, LEVELLING), base);
  assert.notEqual(await elevenLabsClipHash('This is Boston.', BEN, LEVELLING), base);
  assert.notEqual(await elevenLabsClipHash('This is Kirton.', { ...BEN, voiceSettings: { ...BEN.voiceSettings, speed: 1.0 } }, LEVELLING), base);
  assert.notEqual(await elevenLabsClipHash('This is Kirton.', { ...BEN, modelId: 'eleven_v3' }, LEVELLING), base);
  assert.notEqual(await elevenLabsClipHash('This is Kirton.', BEN, { ...LEVELLING, version: 2 }), base);
});
