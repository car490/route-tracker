// Loudness levelling for announcement clips (docs/ANNOUNCE-VOICE-PLAN.md,
// "Loudness"): ITU-R BS.1770-4 gated integrated loudness, 4x-oversampled true
// peak, silence trim and gain. Works on mono Float32 samples in [-1, 1].
//
// No imports, so the Deno Edge Function and Node's test runner share it.
// Checked 2026-09-24 against ffmpeg's ebur128 on 10 real clips: loudness
// within 0.06 LU, true peak within 0.1 dB.

function biquad(x, b0, b1, b2, a0, a1, a2) {
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

// BS.1770 K-weighting (high shelf + high pass), using libebur128's
// sample-rate-independent design (the same one ffmpeg's ebur128 filter uses).
function kWeight(x, fs) {
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / fs);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = biquad(x,
    (Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0,
    1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0);
  f0 = 38.13547087602444; Q = 0.5003270373238773;
  K = Math.tan(Math.PI * f0 / fs);
  a0 = 1 + K / Q + K * K;
  return biquad(shelf, 1, -2, 1, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0);
}

// Gated integrated loudness in LUFS (400 ms blocks, 75% overlap, -70 LUFS
// absolute and -10 LU relative gates). -Infinity if nothing passes the gates.
export function integratedLoudness(samples, fs) {
  const y = kWeight(samples, fs);
  const block = Math.round(0.4 * fs), hop = Math.round(0.1 * fs);
  const z = [];
  for (let s = 0; s + block <= y.length; s += hop) {
    let sum = 0;
    for (let i = s; i < s + block; i++) sum += y[i] * y[i];
    z.push(sum / block);
  }
  const lk = (m) => -0.691 + 10 * Math.log10(m);
  const abs = z.filter((m) => m > 0 && lk(m) > -70);
  if (!abs.length) return -Infinity;
  const rel = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter((m) => lk(m) > rel);
  return lk(gated.reduce((a, b) => a + b, 0) / gated.length);
}

// Peak of the waveform between samples, via 4x windowed-sinc interpolation.
let firCache = null;
function polyphaseFir() {
  if (firCache) return firCache;
  const L = 4, taps = 48, half = taps / 2;
  firCache = [];
  for (let p = 0; p < L; p++) {
    const row = new Float64Array(taps);
    for (let k = 0; k < taps; k++) {
      const t = (k - half + 1) - p / L;
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * (k + 1 - p / L)) / (taps + 1)));
      row[k] = sinc * w;
    }
    firCache.push(row);
  }
  return firCache;
}

export function truePeakDb(samples) {
  const h = polyphaseFir(), taps = h[0].length, half = taps / 2;
  let peak = 0;
  for (let n = 0; n < samples.length; n++) {
    const s = Math.abs(samples[n]);
    if (s > peak) peak = s;
    for (let p = 1; p < h.length; p++) {
      let acc = 0;
      for (let k = 0; k < taps; k++) {
        const idx = n + k - half + 1;
        if (idx >= 0 && idx < samples.length) acc += samples[idx] * h[p][k];
      }
      const a = Math.abs(acc);
      if (a > peak) peak = a;
    }
  }
  return peak === 0 ? -Infinity : 20 * Math.log10(peak);
}

// Leading/trailing silence, in seconds, using 10 ms RMS windows.
export function silenceEdges(samples, fs, thresholdDb) {
  const win = Math.max(1, Math.round(0.01 * fs)), thr = Math.pow(10, thresholdDb / 20);
  const loud = (s) => {
    let m = 0;
    const end = Math.min(s + win, samples.length);
    for (let i = s; i < end; i++) m += samples[i] * samples[i];
    return Math.sqrt(m / win) > thr;
  };
  let start = 0;
  while (start < samples.length && !loud(start)) start += win;
  let end = samples.length;
  while (end > start && !loud(Math.max(0, end - win))) end -= win;
  start = Math.min(start, samples.length);
  end = Math.max(end, start);
  return { lead: start / fs, tail: (samples.length - end) / fs, start, end };
}

export function applyGainDb(samples, db) {
  const g = Math.pow(10, db / 20);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * g;
  return out;
}

// Trim, then gain to the target loudness without letting true peak exceed the
// ceiling. Returns { ok: true, samples, report } or { ok: false, reason, report }.
// A clip that can't reach the target without exceeding the ceiling is refused,
// not squashed: the caller records the failure rather than storing it.
export function levelClip(samples, fs, cfg) {
  const edges = silenceEdges(samples, fs, cfg.silenceThresholdDb);
  if (edges.end <= edges.start) {
    return { ok: false, reason: 'clip is silent (no speech found)', report: { loudnessLufs: -Infinity, truePeakDb: -Infinity } };
  }
  const a = Math.max(0, edges.start - Math.round(cfg.keepLeadSeconds * fs));
  const b = Math.min(samples.length, edges.end + Math.round(cfg.keepTailSeconds * fs));
  const trimmed = samples.slice(a, b);

  const measured = integratedLoudness(trimmed, fs);
  if (!Number.isFinite(measured)) {
    return { ok: false, reason: 'clip is silent (no speech found) or too short to measure', report: { loudnessLufs: measured, truePeakDb: -Infinity } };
  }
  let out = applyGainDb(trimmed, cfg.targetLufs - measured);
  // Aim below the ceiling by the encode headroom: MP3 encoding can raise
  // peaks slightly, and the caller re-checks the encoded file.
  const aimDb = cfg.truePeakCeilingDb - (cfg.encodeHeadroomDb ?? 0);
  let tp = truePeakDb(out);
  if (tp > aimDb) {
    out = applyGainDb(out, aimDb - tp);
    tp = truePeakDb(out);
  }
  const loudness = integratedLoudness(out, fs);
  const report = {
    loudnessLufs: loudness,
    truePeakDb: tp,
    leadSeconds: Math.min(edges.start, Math.round(cfg.keepLeadSeconds * fs)) / fs,
    tailSeconds: Math.min(samples.length - edges.end, Math.round(cfg.keepTailSeconds * fs)) / fs,
    durationSeconds: out.length / fs,
    gainDb: cfg.targetLufs - measured,
  };
  if (Math.abs(loudness - cfg.targetLufs) > cfg.toleranceLu) {
    return { ok: false, reason: `loudness ${loudness.toFixed(1)} LUFS is outside ${cfg.targetLufs} ±${cfg.toleranceLu} LU tolerance (true-peak ceiling reached)`, report };
  }
  return { ok: true, samples: out, report };
}

// One correction after encoding: MP3 encoding trims a little high-frequency
// energy, which K-weighting counts heavily, so an encoded clip lands about
// 0.2-0.5 LU below the level it was set to (measured 2026-09-24). Returns the
// gain (dB) to apply to the pre-encode samples before encoding once more, or
// 0 if the clip is already within 0.2 LU. Never lifts true peak past the aim
// (ceiling minus encode headroom).
export function correctionGainDb(encodedLufs, encodedTruePeakDb, cfg) {
  const diff = cfg.targetLufs - encodedLufs;
  if (Math.abs(diff) <= 0.2) return 0;
  if (diff < 0) return diff;
  const aimDb = cfg.truePeakCeilingDb - (cfg.encodeHeadroomDb ?? 0);
  return Math.max(0, Math.min(diff, aimDb - encodedTruePeakDb));
}
