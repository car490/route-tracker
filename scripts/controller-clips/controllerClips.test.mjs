// node --test scripts/controller-clips/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSafeClipKey, selectControllerClips, planExport, buildManifest } from './controllerClips.mjs';

const STOP_A = '00000000-0000-0000-0002-000000000023';
const STOP_B = '5b14bddc-b900-4ffd-926d-e421377b68ed';
const clip = (key, hash = 'h1', text = 't', voice = 'elevenlabs:eUlIljct4YrEQRcEqrii') =>
  ({ key, storage_path: `${key}.mp3`, hash, text, voice });

test('only recognised clip keys are safe to turn into file paths', () => {
  for (const k of [`approach/${STOP_A}`, `departure/${STOP_B}`, 'service/s116s__boston-college', 'terminus', 'diversion']) {
    assert.equal(isSafeClipKey(k), true, k);
  }
  for (const k of ['../etc/passwd', `approach/${STOP_A}/../../x`, 'service/../../x', 'approach/not-a-uuid', '/abs', 'service/', '', null, 'other/thing', 'service/a b']) {
    assert.equal(isSafeClipKey(k), false, String(k));
  }
});

test('the Controller gets clips for stops a timetable uses, plus route-start and fixed phrases', () => {
  const clips = [
    clip(`approach/${STOP_A}`), clip(`departure/${STOP_A}`),
    clip(`approach/${STOP_B}`), clip(`departure/${STOP_B}`),
    clip('service/s116s__boston'), clip('terminus'), clip('diversion'),
    clip('../evil'),
  ];
  const { selected, rejected } = selectControllerClips(clips, new Set([STOP_A]));
  assert.deepEqual(selected.map((c) => c.key).sort(),
    [`approach/${STOP_A}`, `departure/${STOP_A}`, 'diversion', 'service/s116s__boston', 'terminus']);
  assert.deepEqual(rejected.map((c) => c.key), ['../evil']);
});

test('only changed or missing clips are downloaded; old ones are reported, not deleted', () => {
  const clips = [clip('terminus', 'h2'), clip('diversion', 'h1'), clip(`approach/${STOP_A}`, 'h1')];
  const oldManifest = {
    terminus: { path: 'terminus.mp3', hash: 'h1' },
    diversion: { path: 'diversion.mp3', hash: 'h1' },
    [`approach/${STOP_A}`]: { path: `approach/${STOP_A}.mp3`, hash: 'h1' },
    [`approach/${STOP_B}`]: { path: `approach/${STOP_B}.mp3`, hash: 'h9' },
  };
  const onDisk = new Set(['terminus.mp3', 'diversion.mp3']); // approach/A's file is missing
  const plan = planExport(clips, oldManifest, (rel) => onDisk.has(rel));
  assert.deepEqual(plan.download.map((c) => c.key).sort(), [`approach/${STOP_A}`, 'terminus']);
  assert.deepEqual(plan.unchanged.map((c) => c.key), ['diversion']);
  assert.deepEqual(plan.stale, [`approach/${STOP_B}`]);
});

test('the manifest records voice, text and hash per clip, sorted by key', () => {
  const m = buildManifest([clip('terminus', 'h2', 'This service terminates here.'), clip('diversion')]);
  assert.deepEqual(Object.keys(m), ['diversion', 'terminus']);
  assert.deepEqual(m.terminus, {
    path: 'terminus.mp3', hash: 'h2', text: 'This service terminates here.', voice: 'elevenlabs:eUlIljct4YrEQRcEqrii',
  });
});
