# Handoff: Announce voice swap (ElevenLabs "Ben")

## Working rules (read first)
- Design as a **vertical slice**: tests, generation tool, override list, manifest and clips for this feature live together, not spread across layers.
- **TDD**: write failing tests first, then implement.
- **Plan first**: present your own implementation plan (files to add or change, in the repo's real structure) and **wait for John's approval before changing anything**.
- **Security is paramount**: nothing that could be used to attack the system is exposed or shipped. Governance is light but effective.

## Goal
Replace the current pre-generated announcement clips (stop names plus fixed phrases) with clips generated in the ElevenLabs voice below. No app code changes: the new clips replace the old ones behind the existing playback interface (locate it in the repo).

## Voice configuration
| Item | Value |
|---|---|
| Voice name | Ben - Warm British Male |
| Voice ID | `eUlIljct4YrEQRcEqrii` (not a secret) |
| Voice type | Professional Voice Clone (from the sample's filename) |
| Model | Multilingual v2 (`eleven_multilingual_v2`) |
| Settings (from the sample's filename, **John to confirm in the app**) | stability 0.50, similarity boost 1.00, style 0.50, speaker boost on, a speed setting (value to confirm) |

Notes:
- Pin the final settings in a config file so every clip is generated identically.
- Style 0.50 adds expressiveness. For announcements, consistency matters more, so test style 0 against 0.50 on a few clips before the full run. John decides by ear.
- Verify parameter names (`voice_settings`: `stability`, `similarity_boost`, `style`, `use_speaker_boost`, `speed`) against the current ElevenLabs API docs before coding.

## Licence gate (before the final run)
- The free plan has **no commercial licence**. Final clips must be generated on a **paid plan** (Starter or above). Free-tier clips are for auditioning only.
- John is on the **Starter** paid tier. Record the tier, the date of generation and the listing check in the decisions log.
- Check Ben's Voice Library listing for any usage restrictions.
- **Credit budget:** Starter has a monthly credit allowance that is spent per character. The generation tool must have a **dry-run mode** that counts total characters for all pending clips and prints the estimated credit cost before any API call. It must refuse to run if the estimate exceeds the remaining allowance John enters. Tune settings on a few clips first, then generate the full set in one run, since every regeneration spends credits.

## Baseline measurements (one sample clip, approximate)
- 3.3 s, mono, 44.1 kHz, MP3 128 kbps.
- About -41 LUFS integrated, about -24 dBTP true peak, so very quiet.
- About 0.11 s leading silence and 0.25 s trailing silence.
- Conclusion: raw output must be loudness-normalised so the fixed output-volume setting behaves the same at every stop.

## Tests first (red)
1. Every stop in the stop data has a clip.
2. Every fixed phrase (for example the diversion announcement) has a clip.
3. Every clip is within the loudness tolerance around one target, with no clipping.
   - Suggested starting target: -16 LUFS integrated, true peak no higher than -1 dBTP, tolerance ±1 LU. **Confirm this fits the existing fixed-volume / Annex A setup.**
4. Leading and trailing silence are within a set limit.
5. The manifest matches the files on disk: voice ID, model, settings, generation date, text hash per clip.
6. Changing a stop name or its pronunciation override marks that clip stale.
7. No API key or secret appears anywhere in the repo, manifest or clips folder.

## Implementation outline
1. **Pronunciation overrides:** a per-stop override list (stop, spoken text). With Multilingual v2, prefer respelling or aliases over IPA phoneme tags. IPA tags may not be supported on this model, so verify.
2. **Generation tool:**
   - Local and manual, never run in CI.
   - Reads `ELEVENLABS_API_KEY` from the environment only, and never logs it.
   - Writes to a **staging folder only**, and skips clips that are already current.
3. **Post-processing:** normalise loudness to the target and trim leading and trailing silence, using ffmpeg or the repo's existing tooling.
4. **Review gate:** John listens to the staged clips, especially awkward names (Loughborough, Cholmondeley, Happisburgh, Leominster, Alnwick and John's own difficult stops). Only approved clips are promoted to the shipped clips folder.
5. **Swap:** the promoted clips replace the old ones. The old clips stay recoverable through git.

## Security
- The API key never appears in the repo, scripts, manifest or logs.
- The staging folder, scratch clips and the generation tool must **not** be served by the Cloudflare Workers deployment (it serves from the repo root). Add them to **`.assetsignore`** and **`.gitignore`**, and add a test that fails if they're missing.
- At runtime the app makes no network calls for audio. Clips are static, pre-generated files only.
- Only the final approved clips ship.

## Governance
- Add a short decisions-log entry covering the voice and ID, model and settings, plan tier, licence check, and the loudness target.
- Regeneration is deliberate and never automatic.

## Done when
- All tests are green.
- John has approved the audio.
- The old clips are replaced and the decisions-log entry is written.
