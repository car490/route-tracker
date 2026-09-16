// mele-server/audioPlayer.test.js
//
// spawnPlayer is injected so these never touch a real audio device/mpg123
// — see audioPlayer.mjs's createAudioPlayer(). existsSync is real, though,
// so clip "existence" is backed by real (empty, content doesn't matter —
// only presence is checked) files in a temp dir per test.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAudioPlayer, DEFAULT_AUDIO_DIR } from './audioPlayer.mjs';

// Every test below injects its own audioDir override, which is exactly how
// a real path bug in DEFAULT_AUDIO_DIR (found 2026-09-16 -- it resolved one
// directory level too shallow, silently skipping every announcement on the
// real Controller) went uncaught. This asserts the real default resolves to
// the actual committed clips directory, not an override.
describe('DEFAULT_AUDIO_DIR', () => {
  it('resolves to the real busops/driver/audio/announcements/ directory', () => {
    expect(existsSync(DEFAULT_AUDIO_DIR)).toBe(true);
    expect(DEFAULT_AUDIO_DIR.replace(/\\/g, '/')).toMatch(/busops\/driver\/audio\/announcements$/);
  });
});

describe('audioPlayer', () => {
  let audioDir;
  let log;

  beforeEach(() => {
    audioDir = mkdtempSync(path.join(tmpdir(), 'audioPlayer-test-'));
    log = { warn: vi.fn() };
  });

  afterEach(() => {
    rmSync(audioDir, { recursive: true, force: true });
  });

  function touchClip(key) {
    const filePath = path.join(audioDir, `${key}.mp3`);
    // key may contain a subdirectory (e.g. 'service/x1__town') — real clips
    // do (audio/announcements/service/, /stop/, /arrive/, /next/).
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, '');
  }

  it('plays each clip in order via spawnPlayer', async () => {
    touchClip('service/x1__town-centre');
    touchClip('stop/abc123');
    const calls = [];
    const spawnPlayer = vi.fn(async (filePath) => { calls.push(filePath); return true; });
    const player = createAudioPlayer({ audioDir, spawnPlayer, log });

    await player.enqueueAnnounce('This is a X1 to Town Centre.', ['service/x1__town-centre', 'stop/abc123']);

    expect(calls).toEqual([
      path.join(audioDir, 'service/x1__town-centre.mp3'),
      path.join(audioDir, 'stop/abc123.mp3'),
    ]);
  });

  it('skips the whole announcement (never calls spawnPlayer) when a clip is missing, and logs it', async () => {
    touchClip('service/x1__town-centre');
    // stop/abc123 deliberately not created — missing clip
    const spawnPlayer = vi.fn(async () => true);
    const player = createAudioPlayer({ audioDir, spawnPlayer, log });

    await player.enqueueAnnounce('This is a X1 to Town Centre.', ['service/x1__town-centre', 'stop/abc123']);

    expect(spawnPlayer).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('stop/abc123'));
  });

  it('aborts the rest of the sequence when a clip fails to play, without throwing', async () => {
    touchClip('service/x1__town-centre');
    touchClip('stop/abc123');
    const calls = [];
    const spawnPlayer = vi.fn(async (filePath) => {
      calls.push(filePath);
      return !filePath.includes('service'); // first clip "fails"
    });
    const player = createAudioPlayer({ audioDir, spawnPlayer, log });

    await player.enqueueAnnounce('This is a X1 to Town Centre.', ['service/x1__town-centre', 'stop/abc123']);

    expect(calls).toEqual([path.join(audioDir, 'service/x1__town-centre.mp3')]); // never reached the second clip
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('playback failed'));
  });

  it('is a no-op with no audioKeys (never calls spawnPlayer, never throws)', async () => {
    const spawnPlayer = vi.fn(async () => true);
    const player = createAudioPlayer({ audioDir, spawnPlayer, log });

    await expect(player.enqueueAnnounce('This is the final stop.', [])).resolves.toBeUndefined();
    await expect(player.enqueueAnnounce('This is the final stop.', null)).resolves.toBeUndefined();
    expect(spawnPlayer).not.toHaveBeenCalled();
  });

  it('queues a new announcement behind one already playing, keeping only the most recent', async () => {
    touchClip('a');
    touchClip('b');
    touchClip('c');
    const calls = [];
    let releaseFirst;
    const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
    const spawnPlayer = vi.fn(async (filePath) => {
      calls.push(filePath);
      if (filePath.endsWith('a.mp3')) await firstGate; // hold the first clip "playing" until the test releases it
      return true;
    });
    const player = createAudioPlayer({ audioDir, spawnPlayer, log });

    const firstDone = player.enqueueAnnounce('First.', ['a']);
    // Both arrive while 'a' is still "playing" — only the second (most recent) should survive.
    player.enqueueAnnounce('Superseded.', ['b']);
    player.enqueueAnnounce('Second.', ['c']);

    releaseFirst();
    await firstDone;
    // Give the internally-chained queued playback a tick to run.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(calls).toEqual([
      path.join(audioDir, 'a.mp3'),
      path.join(audioDir, 'c.mp3'), // not 'b' — superseded before its turn
    ]);
  });
});
