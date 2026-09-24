# Plan: ElevenLabs "Ben" voice for announcements

Implements `docs/announce-voice-swap-handoff.md`, adapted to how the codebase actually works
(checked 2026-09-24 against `develop`, dev and production).

## Decisions (John, 2026-09-24)
| Question | Decision |
|---|---|
| Design | **Ben is the automatic voice** (revised 2026-09-24, replacing "Azure safety net"): ElevenLabs runs inside the existing pipeline, so a changed stop gets a Ben clip within 5 minutes. Azure is an emergency setting only and never overwrites a Ben clip. |
| Review | **Play first, review after.** New Ben clips play straight away and show as unreviewed; John approves them or sets `spoken_name`, which regenerates the clip. (The brief said only approved clips ship; John accepted this trade-off to avoid silence at a renamed stop.) |
| Scope | **Only clips a route actually uses** are rendered with ElevenLabs. A daily character cap protects the monthly credits. Dev can stay on Azure except when testing. |
| Voice speed | **0.90** |
| Other settings | stability 0.50, similarity boost 1.00, style 0 vs 0.50 decided by ear in the audition, speaker boost on (confirm in the app) |
| Loudness | Speaker output no more than 90 dB, **set by hand on each vehicle's amplifier**. No software cap or calibration clip. The clips only need to be consistently levelled so one amplifier setting suits them all |

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

## Design (revised 2026-09-24)
1. **ElevenLabs in the pipeline.** `generate-announcement-clip` renders with ElevenLabs when `app_config.announcement_voice`
   names the Ben voice (per environment), then trims and loudness-normalises the MP3 in the function itself. Settings
   (model, stability, similarity, style, speed 0.90, speaker boost) are pinned in one config and folded into each clip's hash.
2. **Never overwrite Ben.** The function refuses to replace a clip rendered by the primary (Ben) voice with any other voice.
3. **Source indicator.** `announcement_clips` records voice (exists), plus model, settings hash, and `reviewed_at`/`reviewed_by`.
4. **`stops.spoken_name`** (step 1, done on dev): speech-only respelling; changing it regenerates the clip.
5. **Credit safeguards.** Only stops used by a timetable are rendered with ElevenLabs; a daily character cap in `app_config`
   leaves anything over it queued and raises an alert. The API key is an Edge Function secret.
6. **Review page** (local, localhost only): lists unreviewed Ben clips to play and approve. Approval is recorded with who/when.
7. **Controller export** (local): downloads the current Ben set from Storage into `busops/driver/audio/announcements/` + manifest.

## Loudness
The 90 dB limit is set by hand on each vehicle's amplifier (John, 2026-09-24), so there is no software cap and no calibration clip.
What the software must guarantee is consistency, so one amplifier setting suits every clip: each Ben clip is normalised to
one integrated-loudness target with a true-peak ceiling of -1 dBTP, tolerance ±1 LU. The target matches the measured level of the
existing Azure clips (measured first), so switching voices doesn't change how loud the bus is.

## Experiment results (step 2, 2026-09-24): levelling inside the Edge Function works
- **Target set to -21 LUFS**: every existing Azure clip on dev and production measured -20.2 to -21.9 LUFS integrated,
  true peak about -4 dBTP (ffmpeg `ebur128`). Ben clips at -21 ±1 LU, peaks at or under -1 dBTP, change nothing for the amplifier setting.
- **Pure-JS pipeline**: `mpg123-decoder` (WASM decode) → silence trim → BS.1770-4 gated loudness and 4x-oversampled true peak
  (own code, no imports) → gain → `@breezystack/lamejs` MP3 encode.
- **Accuracy vs ffmpeg** on 10 real clips: loudness within 0.06–0.17 LU, true peak within 0.1 dB. After turning each clip down 20 dB
  and levelling, ffmpeg measured -21.2 to -21.5 LUFS (all in tolerance). Silence went from 0.24 s / 0.87 s to about 0.08 s / 0.07–0.13 s.
- **Real Edge runtime (dev, temporary function, deleted afterwards)**: a 4 s clip at 44.1 kHz from -41 LUFS input took
  **0.3–0.4 s** of processing (decode 18 ms, loudness 12 ms, true peak ~100 ms, encode ~190 ms). The drain will process a few clips
  per run rather than 20, to stay well inside the function's CPU allowance.

## Security
- `ELEVENLABS_API_KEY` is an Edge Function secret only (never in the repo, config.js, logs or the manifest). A test scans the repo and clip folders for key-like strings.
- The Edge Function stays behind `verify_jwt` plus its constant-time `CALLER_AUTH_TOKEN` check; clients cannot trigger renders.
- Review approvals go through an RPC limited to super_user/ops_manager, recorded with who and when. No service-role key on the laptop.
- The review page binds to localhost only and holds no secrets; it reads the public clip bucket and signs in as John.
- Credit cap: a bulk data change can't spend more than the daily character allowance.
- At runtime devices never call ElevenLabs; they play pre-rendered clips from Storage as today.

## Tests first (red), mapped to the brief
| Brief test | Where |
|---|---|
| 1. Every used stop has a clip | coverage query test (`supabase/tests/`) |
| 2. Fixed phrases (terminus, diversion) and route-start clips exist | same |
| 3. Loudness within tolerance, no clipping | shared audio module tests on fixture MP3s; the Edge Function refuses to store a clip outside the limits |
| 4. Leading/trailing silence within limits | same |
| 5. Clip record matches the file (voice, model, settings hash, date, text hash) | Edge Function / module tests |
| 6. Changing a stop name or its spoken name marks the clip stale | `supabase/tests/stops_spoken_name.sql` (done) |
| 7. No API key anywhere | secret-scan test |
| Also | never-overwrite guard; daily cap; used-stops-only scope |

## Build order (revised)
1. `stops.spoken_name` column and trigger. **Done on dev.**
2. **Experiment: done, it works** (see Experiment results). Target -21 LUFS.
3. Shared audio module (trim/normalise), tests first; ElevenLabs render path in the Edge Function; never-overwrite guard; source columns.
4. Credit safeguards: used-stops-only scope and the daily cap.
5. Review page and Controller export.
6. Rollout: audition about 10 hard names at style 0 vs 0.50; John picks; licence and listing check recorded;
   dev run, then listen on the tablet; production switch; `docs/DECISIONS.md` entry.

## Not in scope
- Wiring `fixed_output_level` into playback (Annex A).
- The production stop whose name is a full postal address (not used by a route; clean up separately).
