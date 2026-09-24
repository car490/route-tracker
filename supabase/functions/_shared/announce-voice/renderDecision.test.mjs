import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isElevenLabsVoice, elevenLabsVoiceId, decideClipAction, stopIdFromKey } from './renderDecision.mjs';

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

test('a refused job whose wording differs from the Ben clip is flagged stale, not silently dropped', () => {
  const existing = { voice: BEN, hash: 'h1', text: 'The next stop is Old Name.' };
  assert.equal(decideClipAction({ jobVoice: RYAN, jobText: 'The next stop is New Name.', newHash: 'a9', existing }), 'skip-protected-stale');
  assert.equal(decideClipAction({ jobVoice: RYAN, jobText: 'The next stop is Old Name.', newHash: 'a9', existing }), 'skip-protected');
});

test('stopIdFromKey finds the stop behind approach/departure keys only', () => {
  assert.equal(stopIdFromKey('approach/5b14bddc-b900-4ffd-926d-e421377b68ed'), '5b14bddc-b900-4ffd-926d-e421377b68ed');
  assert.equal(stopIdFromKey('departure/00000000-0000-0000-0002-000000000023'), '00000000-0000-0000-0002-000000000023');
  assert.equal(stopIdFromKey('service/s116s__boston'), null);
  assert.equal(stopIdFromKey('terminus'), null);
  assert.equal(stopIdFromKey('approach/not-a-uuid'), null);
});
