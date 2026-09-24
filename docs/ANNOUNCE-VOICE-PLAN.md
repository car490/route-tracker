# Plan: ElevenLabs "Ben" voice for announcements

Implements `docs/announce-voice-swap-handoff.md`, adapted to how the codebase actually works
(checked 2026-09-24 against `develop`, dev and production).

## Decisions (John, 2026-09-24)
| Question | Decision |
|---|---|
| Design | **Azure stays as the automatic safety net.** Ben is an approved layer on top. |
| Scope | **Only clips a route actually uses** get Ben. Stops no timetable uses keep their Azure clip. |
| Voice speed | **0.90** |
| Other settings | stability 0.50, similarity boost 1.00, style 0 vs 0.50 decided by ear in the audition, speaker boost on (confirm in the app) |
| Loudness | Speaker output **no more than 90 dB** (see "Loudness and the 90 dB limit") |

## How it works today (the base we build on)
- **Automatic Azure pipeline** (driver app and Announce Solo): a stop/route/timetable change queues a job
  (`announcement_clip_jobs`), a cron sends it every 5 minutes to the `generate-announcement-clip` Edge Function,
  which renders it with Azure and writes `announcement-audio/<key>.mp3` plus an `announcement_clips` row.
  The voice comes from `app_config.announcement_voice`.
- **Playback** (`shared/announcementAudio.js`) reads only from Storage by key: `service/…`, `approach/<stopId>`,
  `departure/<stopId>`, `terminus`, `diversion`. The service worker precaches every clip.
- **Bus Controller** plays committed files in `busops/driver/audio/announcements/` (Azure script, last run 2026-09-07).
- `stops.announcement_name` drives **both** the sign text and the spoken name. There is no speech-only override.
- No software limits output volume. `vehicle_audio_config.fixed_output_level` exists, but its formula is a
  placeholder (ambient + 10 dB, Annex A pending) and nothing in playback reads it.

## Budget (production, 2026-09-24)
All clips: 404 (314 distinct sentences, 13,017 characters). **Clips the two routes use: 214 (132 distinct
sentences, 4,904 characters).** Starter: 30,000 credits a month; Multilingual v2 costs 1 credit per character;
output is MP3 only (PCM/WAV need Pro). Each distinct sentence is generated once and reused across
environments. Dev gets only what testing needs.

## Design
1. **Azure safety net, unchanged.** A renamed stop is correct within 5 minutes, in the Azure voice, until a Ben clip is approved.
2. **Edge Function guard.** Never overwrite an approved Ben clip whose text still matches the job.
3. **`stops.spoken_name`** (nullable, speech only; the sign is unaffected). Both voices use
   `coalesce(spoken_name, display_name)`. Changing it re-queues the clip, which makes the Ben clip stale.
   Respellings, not phoneme tags (Multilingual v2 doesn't support phoneme tags).
4. **Voice studio** (`scripts/announce-voice/`, local, manual, never in CI), a vertical slice holding its own tests,
   settings file, manifest and staging:
   - `plan` lists clips used by a timetable that aren't an approved, current Ben clip.
   - `--dry-run` counts characters and credits for uncached sentences, and refuses if the total exceeds the allowance entered.
   - `generate` calls ElevenLabs once per distinct sentence into the staging folder only, with a cache keyed by
     hash(text, voice, model, settings). Reads `ELEVENLABS_API_KEY` from the environment only and never logs it.
   - `process` uses ffmpeg (bundled `ffmpeg-static`) to trim leading and trailing silence and normalise loudness,
     then checks the result against the limits.
   - `review` serves a local page (localhost only) to play and approve clips. Approvals are written to the staging manifest.
   - `promote` uploads approved clips to the existing Storage paths and updates the `announcement_clips` rows. No app code changes.
   - `export-controller` writes the approved set and manifest into `busops/driver/audio/announcements/` for the Controller.
   - `calibration` writes the loudness calibration clip (see below).

## Loudness and the 90 dB limit
The 90 dB limit is a sound level in the bus. It depends on the clip files **and** the device volume/amplifier, so it is enforced in three places:
1. **Files:** every Ben clip is normalised to one integrated-loudness target with a true-peak ceiling of -1 dBTP,
   tolerance ±1 LU. The target is set to match the measured level of the existing Azure clips, so a safety-net
   clip is never louder than a Ben clip.
2. **Calibration clip:** the studio produces a reference clip at the loudest peak any announcement can reach. At
   commissioning, play it, measure it with a sound level meter, and set the device volume so it reads no more than 90 dB.
   Documented in `mele-server/DEPLOY.md` and the Solo commissioning notes.
3. **Software cap:** `validateAudioConfig` rejects a fixed output level above 90 dB, and `computeFixedOutputLevel`
   is capped at 90. Wiring the level into playback is Annex A work, outside this plan.
To confirm: how the 90 dB is measured (proposed: A-weighted maximum, dB(A) LAFmax, at the nearest seated passenger's head position).

## Security
- The ElevenLabs key is environment-only. A test scans the repo, manifest and clip folders for key-like strings.
- `promote` signs in with John's dashboard login. A new `promote_announcement_clip` RPC is limited to
  super_user/ops_manager, with a matching Storage policy on `announcement-audio`. There is no service-role key on the laptop.
- An `announcement_clip_promotions` audit table records who, when, key, hash and voice.
- The staging folder and cache live under `scripts/announce-voice/` (outside `busops/`, so Cloudflare never serves them)
  and are gitignored. A test fails if that stops being true.
- At runtime there are no calls to ElevenLabs. Clips are pre-generated files only.

## Tests first (red), mapped to the brief
| Brief test | Where |
|---|---|
| 1. Every used stop has a clip | `plan` coverage test against a fixture timetable, plus a live check in `plan` |
| 2. Fixed phrases (terminus, diversion) and route-start clips exist | same |
| 3. Loudness within tolerance, no clipping | `process` tests on fixture audio; `promote` refuses a clip outside the limits |
| 4. Leading/trailing silence within limits | same |
| 5. Manifest matches files (voice, model, settings, date, text hash) | manifest tests |
| 6. Changing a stop name or its spoken name marks the clip stale | DB test (`supabase/tests/`) and `plan` test |
| 7. No API key anywhere | secret-scan test |
| Also | Edge Function guard test; 90 dB cap test; gitignore/serving test |

## Build order
1. `stops.spoken_name` column and trigger. Dev first.
2. Edge Function guard.
3. Studio: `plan`, dry run, `generate`, `process`, loudness checks. Measure the Azure clips to fix the target.
4. Studio: `review`, `promote`, audit table, RPC and Storage policy.
5. `export-controller` and `calibration`; 90 dB cap in `validateAudioConfig`.
6. Rollout: audition about 10 hard names at style 0 vs 0.50; John picks; licence and listing check recorded;
   dev run, then listen on the tablet; production run; `docs/DECISIONS.md` entry.

## Not in scope
- Stopping Azure from rendering clips for stops no route uses (harmless on the free tier).
- Wiring `fixed_output_level` into playback (Annex A).
- The production stop whose name is a full postal address (not used by a route; clean up separately).
