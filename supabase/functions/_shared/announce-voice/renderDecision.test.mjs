import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isElevenLabsVoice, elevenLabsVoiceId, decideClipAction } from './renderDecision.mjs';

const BEN = 'elevenlabs:eUlIljct4YrEQRcEqrii';
const RYAN = 'en-GB-RyanNeural';

test('recognises an ElevenLabs voice value and extracts its id', () => {
  assert.equal(isElevenLabsVoice(BEN), true);
  assert.equal(isElevenLabsVoice(RYAN), false);
  assert.equal(isElevenLabsVoice(null), false);
  assert.equal(elevenLabsVoiceId(BEN), 'eUlIljct4YrEQRcEqrii');
  assert.equal(elevenLabsVoiceId(RYAN), null);
});

test('renders when there is no clip yet', () => {
  assert.equal(decideClipAction({ jobVoice: BEN, newHash: 'h1', existing: null }), 'render');
});

test('skips when the existing clip already has this exact hash', () => {
  assert.equal(decideClipAction({ jobVoice: BEN, newHash: 'h1', existing: { voice: BEN, hash: 'h1' } }), 'skip-unchanged');
  assert.equal(decideClipAction({ jobVoice: RYAN, newHash: 'a1', existing: { voice: RYAN, hash: 'a1' } }), 'skip-unchanged');
});

test('never overwrites a Ben clip with a non-ElevenLabs voice, even if the text changed', () => {
  assert.equal(decideClipAction({ jobVoice: RYAN, newHash: 'a9', existing: { voice: BEN, hash: 'h1' } }), 'skip-protected');
});

test('replaces an Azure clip with Ben, and a stale Ben clip with a new Ben clip', () => {
  assert.equal(decideClipAction({ jobVoice: BEN, newHash: 'h2', existing: { voice: RYAN, hash: 'a1' } }), 'render');
  assert.equal(decideClipAction({ jobVoice: BEN, newHash: 'h2', existing: { voice: BEN, hash: 'h1' } }), 'render');
});

test('Azure still replaces Azure (today\'s behaviour is unchanged)', () => {
  assert.equal(decideClipAction({ jobVoice: RYAN, newHash: 'a2', existing: { voice: RYAN, hash: 'a1' } }), 'render');
});
