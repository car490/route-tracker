// tests/announcementAudioFormat.test.js
//
// PSVAIR announcement clips: audio quality. Written BEFORE the change (TDD).
//
// The clips were rendered at Azure's lowest MP3 tier, audio-16khz-64kbitrate-mono-mp3 (8 kHz of
// bandwidth), which makes a neural voice sound thin and synthetic on a tablet speaker. The neural
// voices work at 24 kHz, so the clips are now rendered at audio-24khz-160kbitrate-mono-mp3, the
// highest quality at the voice's native rate. Azure bills per character, not per format, so this
// costs nothing at the API; it makes each clip about 2.5x larger (a few MB across the fleet's clips).
//
// Two independent implementations render clips and must agree (neither imports the other): the
// generate-announcement-clip Edge Function (Deno) that the cron drains the queue through for the
// Driver PWA and Announce Solo, and scripts/generate-announcement-audio.mjs (Node) that produces the
// clips the Bus Controller plays from local disk. Both read as text here, since one is Deno TypeScript.
//
// Also pinned: the format is part of each clip's hash, so changing it (now or ever) re-renders every
// clip instead of every clip being skipped as "unchanged" because the words and voice did not
// change; and uploads carry a short cacheControl, so a re-rendered clip, or a stop renamed for
// PSV(AI)R clarity, reaches a tablet within minutes instead of after the storage default of an hour.

import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..', '..');
const edge = fs.readFileSync(path.join(root, 'supabase', 'functions', 'generate-announcement-clip', 'index.ts'), 'utf8');
const local = fs.readFileSync(path.join(root, 'scripts', 'generate-announcement-audio.mjs'), 'utf8');

const FORMAT = 'audio-24khz-160kbitrate-mono-mp3';

describe('the audio format', () => {
  it.each([
    ['the Edge Function', edge],
    ['the local generator', local],
  ])('%s renders at %s', (_name, src) => {
    expect(src).toContain(`const AUDIO_FORMAT = '${FORMAT}'`);
  });

  it.each([
    ['the Edge Function', edge],
    ['the local generator', local],
  ])('%s sends that constant to Azure, not a literal that could drift', (_name, src) => {
    expect(src).toMatch(/'X-Microsoft-OutputFormat':\s*AUDIO_FORMAT/);
  });

  it.each([
    ['the Edge Function', edge],
    ['the local generator', local],
  ])('%s has no quoted 16 kHz format left (comments may name the old one)', (_name, src) => {
    expect(src).not.toMatch(/['"`]audio-16khz/);
  });

  it('is a mono MP3 at the voice\'s native 24 kHz or better, at 96 kbps or better', () => {
    const m = /^audio-(\d+)khz-(\d+)kbitrate-mono-mp3$/.exec(FORMAT);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(24);
    expect(Number(m[2])).toBeGreaterThanOrEqual(96);
  });
});

describe('the format is part of every clip\'s hash, so a format change re-renders everything', () => {
  it('the Edge Function hashes voice, format and text', () => {
    expect(edge).toMatch(/new TextEncoder\(\)\.encode\(`\$\{voice\}\|\$\{AUDIO_FORMAT\}\|\$\{text\}`\)/);
  });

  it('the local generator hashes voice, format and text', () => {
    expect(local).toMatch(/update\(`\$\{VOICE\}\|\$\{AUDIO_FORMAT\}\|\$\{text\}`\)/);
  });
});

describe('uploads do not sit in a cache for an hour', () => {
  it('the Edge Function uploads with cacheControl 300 (5 minutes)', () => {
    expect(edge).toMatch(/\.upload\(storagePath, mp3, \{[^}]*cacheControl: '300'/);
  });

  it('and still upserts, so a re-render replaces the old file in place', () => {
    expect(edge).toMatch(/\.upload\(storagePath, mp3, \{[^}]*upsert: true/);
  });
});
