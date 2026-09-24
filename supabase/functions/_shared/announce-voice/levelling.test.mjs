// node --test supabase/functions/_shared/announce-voice/
// Synthetic signals with known answers, so no audio fixtures or decoder needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { integratedLoudness, truePeakDb, silenceEdges, levelClip } from './levelling.mjs';
import { LEVELLING } from './voiceConfig.mjs';

function sine({ fs, seconds, amplitude, freq = 997, phase = 0 }) {
  const out = new Float32Array(Math.round(fs * seconds));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin(2 * Math.PI * freq * i / fs + phase);
  return out;
}
function concat(...parts) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const silence = (fs, seconds) => new Float32Array(Math.round(fs * seconds));

// ITU-R BS.1770-4 reference: a full-scale ~1 kHz sine on one channel reads -3.01 LUFS.
for (const fs of [48000, 44100, 24000]) {
  test(`integrated loudness matches the BS.1770 reference at ${fs} Hz`, () => {
    assert.ok(Math.abs(integratedLoudness(sine({ fs, seconds: 3, amplitude: 1 }), fs) - -3.01) < 0.1);
    assert.ok(Math.abs(integratedLoudness(sine({ fs, seconds: 3, amplitude: 0.1 }), fs) - -23.01) < 0.1);
  });
}

test('integrated loudness is -Infinity for silence or a clip shorter than one 400 ms block', () => {
  assert.equal(integratedLoudness(silence(44100, 2), 44100), -Infinity);
  assert.equal(integratedLoudness(sine({ fs: 44100, seconds: 0.2, amplitude: 0.5 }), 44100), -Infinity);
});

test('true peak finds a peak that falls between samples', () => {
  // fs/4 sine at 45 degrees: every sample is ±0.707 (-3 dBFS), the waveform peaks at 1.0 (0 dBTP).
  const x = sine({ fs: 48000, seconds: 0.5, amplitude: 1, freq: 12000, phase: Math.PI / 4 });
  assert.ok(Math.max(...x.map(Math.abs)) < 0.71);
  assert.ok(Math.abs(truePeakDb(x) - 0) < 0.3);
  assert.ok(Math.abs(truePeakDb(sine({ fs: 44100, seconds: 1, amplitude: 0.5 })) - -6.02) < 0.1);
});

test('silenceEdges measures leading and trailing silence', () => {
  const fs = 44100;
  const x = concat(silence(fs, 0.5), sine({ fs, seconds: 1, amplitude: 0.3 }), silence(fs, 1));
  const e = silenceEdges(x, fs, LEVELLING.silenceThresholdDb);
  assert.ok(Math.abs(e.lead - 0.5) < 0.02);
  assert.ok(Math.abs(e.tail - 1) < 0.02);
});

test('levelClip brings a very quiet clip (like the brief sample, about -41 LUFS) to the target and trims silence', () => {
  const fs = 44100;
  const quiet = concat(silence(fs, 0.3), sine({ fs, seconds: 2.5, amplitude: 0.0126 }), silence(fs, 0.9));
  const r = levelClip(quiet, fs, LEVELLING);
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.report.loudnessLufs - LEVELLING.targetLufs) < 0.2, `got ${r.report.loudnessLufs}`);
  assert.ok(r.report.truePeakDb <= LEVELLING.truePeakCeilingDb);
  const e = silenceEdges(r.samples, fs, LEVELLING.silenceThresholdDb);
  assert.ok(e.lead <= LEVELLING.maxLeadSeconds, `lead ${e.lead}`);
  assert.ok(e.tail <= LEVELLING.maxTailSeconds, `tail ${e.tail}`);
});

test('levelClip never pushes true peak above the ceiling, and refuses if that leaves it out of tolerance', () => {
  const fs = 44100;
  // Very peaky: short full-scale bursts in near-silence. Reaching -21 LUFS would need the peaks far above 0 dBTP.
  const burst = concat(sine({ fs, seconds: 0.02, amplitude: 0.9 }), silence(fs, 0.38));
  const peaky = concat(...Array.from({ length: 8 }, () => burst));
  const r = levelClip(peaky, fs, { ...LEVELLING, targetLufs: -5 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /tolerance/);
  assert.ok(r.report.truePeakDb <= LEVELLING.truePeakCeilingDb + 1e-9);
});

test('levelClip refuses silence rather than producing an empty clip', () => {
  const r = levelClip(silence(44100, 2), 44100, LEVELLING);
  assert.equal(r.ok, false);
  assert.match(r.reason, /silent|no speech/i);
});
