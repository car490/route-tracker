# Announcement audio: server-triggered generation + sync — plan

**Status: design settled 2026-09-08. Phases 0, 1, 2, and 3 are all DONE and live on dev AND
production, as of the `v2.2.0` release (2026-09-16) — this plan's core goals (G1/G2/G3, see
"Goals" below) are fully shipped.** The code path was correctly deployed, but `announcement_clips`
sat completely empty on both environments until a same-day backfill for pre-existing stops/routes
— see "Eighth real bug" in "Where things stand" below before assuming any given deployment
actually has audio for real data. Two real bugs were found and fixed via genuine real-device
verification along the way (PRs #46/#47: a service worker registration failure, a stale manifest
icon path), plus a third found while preparing Phase 4 (`mele-server/audioPlayer.mjs` resolving
the Controller's audio directory one level too shallow, silently skipping every announcement on
the one physical Controller since it was commissioned — fixed same day). **Phase 4 is not a
cleanup task any more** — it turned out to rest on a wrong premise (see its checklist entry): the
committed `driver/audio/announcements/` clips and the local generator script that produces them
are the Bus Controller's permanent, only audio source (no WAN path to fetch live), not a
transition artifact to retire. What's left there is a process gap, not code. **Phase 5 (docs)
done, 2026-09-16.** See "Where things stand" immediately below for exactly what a fresh session
needs to know.**
Written 2026-09-08 following a design discussion flagged in `docs/DECISIONS.md`'s
"Shared journey-tracking core" open item — that item itself turned out not to be the right home
for this plan's resolution (it's about a different question), so Phase 5 added a new decided row
instead. This plan's outcome is now folded back into `docs/DECISIONS.md` and `CLAUDE.md`'s
"PSVAIR announcement audio" section, same as every other architecture decision in this repo.

## Where things stand (updated 2026-09-16, end of session — production shipped)

**Eighth real bug found and fixed, 2026-09-16, found via a real on-vehicle test of Driver PWA +
Announce Solo (Donington Cowley Academy route) reporting zero audio the entire drive:** the
"DONE and live on dev AND production" status above was true of the *code path*, but
`announcement_clips` had **zero rows, ever, on both dev and production** — every stop's
approach/departure clip, every route's service clip, and the two fixed `terminus`/`diversion`
clips were missing for every pre-existing stop and route. Root cause: the enqueue triggers
(`trg_announcement_clip_enqueue_on_stop_change`/`_on_route_change`,
`migration_announcement_clips.sql`) only fire on `INSERT` or `UPDATE OF` specific columns, and
were added 2026-09-15 — **every stop and route in both databases predates that** (e.g. route
`S116S` was created 2026-06-14). This session's Phase 1/2/3 verification only ever queued a
couple of manual test jobs and cleaned them up afterward, so the "live on both environments"
claim was never actually checked against real, pre-existing production data — a real gap in how
this plan was verified, not just a gap in the pipeline itself. Separately, no trigger has ever
enqueued the fixed `terminus`/`diversion` keys — those need a one-off manual insert regardless of
backfill.

**Fixed same day** by firing the existing triggers for all pre-existing data — `update stops set
name = name;` / `update routes set service_code = service_code, destination = destination;`
(column-list triggers fire on any `UPDATE OF` that column, whether or not the value actually
changes) — reusing the already-tested trigger logic rather than duplicating key-generation code
in a one-off script, plus a manual insert of the two fixed keys. Drained via repeated manual
`generate-announcement-clip` invocations (the 5-minute cron alone would have taken ~2 hours for
this volume). **Result, verified**: dev — 427/427 clips rendered, 0 failures; production —
362/362 clips rendered, 0 failures; spot-checked public Storage URLs on both return real `.mp3`
audio (`200`, `audio/mpeg`, ~30KB). Every route/stop going forward is covered automatically by
the existing triggers — this was purely a one-time historical-data gap, not a design flaw needing
further code changes. **Standing gap to remember**: a fresh DB reset from `schema.sql` +
`seed.sql` recreates stops/routes via plain `INSERT`, which *does* fire the triggers — so a fresh
reset is actually fine; only a *restore from a pre-2026-09-15 backup/dump* (which bypasses
triggers, e.g. `pg_restore` of table data) would reintroduce this exact gap and need the same
backfill repeated.

**Everything below this paragraph was written before the production release and is kept as the
detailed trace of how each phase got there (per this doc's own convention of moving a resolved
item rather than deleting the trail) — read this paragraph first for the actual current state.**
Phases 0-3 all shipped to production in the `v2.2.0` release (`develop` → `master`, tag `v2.2.0`,
2026-09-16): the `announcement_coverage_gap` migration (Phase 3) was applied to production ahead
of the merge, `develop` was merged into `master`, `scripts/release.mjs minor` bumped the version,
and CI's `deploy-driver-pwa-production` job deployed it live. **Verified end-to-end on production
with the same rigor as dev** — real device confirmed no service worker error, no manifest icon
error, and a genuinely triggered clip (via a temporary `S116T` test route on the real Phil Haines
Coaches production account, cleaned up immediately after) appeared in Cache Storage after a fresh
install. Two more real-code changes followed once production parity was proven: the browser-side
bundled-clip fallback was removed from `shared/announcementAudio.js`/`service-worker.js` (per
Phase 2's checklist below), and Phase 4 turned out to rest on a wrong premise, corrected in its
own checklist entry — plus a seventh real bug found and fixed along the way (see Phase 2's
checklist below), a wrong path in `mele-server/audioPlayer.mjs` that had silently broken all
Controller audio playback since it was first commissioned. See each phase's checklist below for
the authoritative per-item status; the
narrative from here down stops just short of the production release and shouldn't be read as
"still open" where a phase heading above says DONE.

**Done and merged to `develop`** (PRs #36–#42, all merged):
- Phase 0 (security fix) — **live on dev AND production.**
- Phase 1 (server-side clip pipeline: tables, triggers, Storage bucket, Edge Function, cron) —
  **live on dev AND production, verified genuinely working end-to-end on both** (see below).
  **Phase 1 is fully done.**

**Merged to `develop`** (PR #42, 2026-09-15), live on dev, not yet on production: Phase 2
(`shared/announcementAudio.js` now tries the
Storage-backed clip before the bundled fallback; `busops/service-worker.js` precaches from the
live `announcement_clips` table) — code written, full Jest+Vitest suites pass (155+125 tests),
**and manually verified for real in a live Chromium browser against dev Supabase** (Playwright,
driven directly against `pcv-dashboard/busops/server.js` — not just unit tests):
1. `fetchAnnouncementClipStorageUrls()` (the service worker's new precache source) called for
   real in-browser: correctly returned `[]` against dev's empty `announcement_clips` table, then
   correctly built `https://cgcbfgceputvdvhzrgio.supabase.co/storage/v1/object/public/announcement-audio/<storage_path>`
   once a real test row was inserted.
2. **Genuine Storage-backed audio playback confirmed**: pointed `createAnnouncementPlayer`'s
   bundled-fallback base at a deliberately nonexistent path (so a pass could only mean the
   Storage-backed attempt itself succeeded) and played
   `approach/6753f879-f1ae-4fe2-9bdf-dc44157e9822.mp3` — one of the real Azure-rendered leftover
   test clips already sitting in dev's bucket from Phase 1's own verification — the `<audio>`
   element fired `ended`, i.e. it actually downloaded and played a real clip through the new code
   path, no fallback needed. Test row cleaned up afterward (dev `announcement_clips` back to 0
   rows).

**Fifth real bug found and fixed, 2026-09-16 — found only by an actual real-device install,
exactly the gap flagged below:** the previous Playwright verification never actually let a real
browser run the service worker's `install` event end-to-end — it hung on this sandbox's
restricted network access to the unrelated `TILE_CACHE` (OpenStreetMap tile) prefetch list, so
that session tested `fetchAnnouncementClipStorageUrls()` directly instead and never caught this.
The first genuine real-device/private-browser load of `driver-dev.pcvtechnologies.co.uk` failed
outright: `ServiceWorker script evaluation failed`. Root cause: `driver/src/config.js` reads
`window.location.hostname` at module top level, and Phase 2 converted `service-worker.js` to
`{ type: 'module' }` specifically so it could `import` `config.js` directly — but a real
`ServiceWorkerGlobalScope` has `self`, never `window`, so the import threw a `ReferenceError`
during module evaluation before the worker could register at all. Every test passed anyway
because jsdom's `self` is just an alias for `window` (called out in
`tests/serviceWorkerAnnouncementClips.test.js`'s own header comment), which silently hid the
exact failure a real browser hits. **Fixed** by switching `config.js`'s three `window.location`
reads to `self.location` (resolves correctly in both a normal window context and a worker
context) — full Jest+Vitest suites re-run clean (155+131) after the fix. Not yet pushed/deployed
to dev for re-verification as of this writing — see the Phase 2 checklist below.

**Sixth real bug found and fixed, same real-device pass, 2026-09-16:** `driver/manifest.json`'s
icon `src` paths (`./icons/icon-192.png`/`icon-512.png`) still pointed at a `driver/icons/`
folder that stopped existing at the 2026-08-21 restructure, which moved the actual files to
`pcv-dashboard/busops/shared/icons/` and updated both HTML entry points' favicon links
accordingly but missed `manifest.json`. 404'd silently (a manifest icon download error, no test
coverage catches it) until this session's real-device pass surfaced it. Fixed in PR #47 to match
the `../shared/icons/` path both HTML files already use.

**Real-device install/activate pass — DONE, verified end-to-end with genuine live data,
2026-09-16.** With both bugs above fixed and deployed
(PRs #46/#47 merged to `develop`, live on `driver-dev.pcvtechnologies.co.uk`): confirmed the
service worker now registers successfully (no more `ServiceWorker script evaluation failed`).
Cache Storage showed 364 entries — but `announcement_clips` was still at 0 rows at that point (the
Phase 1 test rows had been cleaned up), so that count only proved the static-assets/tiles/bundled-
fallback precache path worked, not the new Storage-backed one. Closed that gap for real: updated
the dedicated test route `S116T` ("Boston to Donington (TEST)")'s `destination` on dev, which fired
the genuine `trg_announcement_clip_enqueue_on_route_change` trigger, queued a real job, and the
`announcement-clip-drain` cron (left to fire on its own 5-minute schedule, not manually forced —
the more honest test of Phase 1's "no manual step" goal) drained it into a real
`announcement_clips` row + a genuine Azure-rendered `service/s116t__donington.mp3` in Storage
(confirmed `200`, `audio/mpeg`, 29,376 bytes). Then **unregistered the service worker and did a
fresh install** (a DB row alone doesn't retrigger `install` — only a byte-changed
`service-worker.js` does, so this step was necessary to actually re-run the precache logic) and
confirmed `service/s116t__donington.mp3` showed up in Cache Storage. **This is the first genuine
proof the live-table precache path pulls real rows, not just that it degrades gracefully on an
empty one.** Cleaned up afterward: `S116T`'s `destination` reset to `null` (its no-`destination`
resting state — the enqueue trigger correctly no-ops on a null destination, confirmed by the
cleanup update itself not re-queuing a job) and the `announcement_clips` test row deleted.
`service/s116t__donington.mp3` remains in the Storage bucket — same as every previous test clip
in this doc's history, direct SQL `DELETE` on `storage.objects` is blocked by
`storage.protect_delete()`, not worth chasing for one 29KB file.

**Deployed to dev only** (`driver-dev.pcvtechnologies.co.uk`, via CI's `deploy-driver-pwa-dev` job
on the PR #42/#44/#46/#47 merges to `develop`) — not yet on production, which only deploys from
`master`. See the Phase 2 section of the checklist below for exactly what's done vs. still open.

**Phase 3 (G1, "never synthesize") — coded, unit-tested, and merged to `develop`** (PR #44,
2026-09-16), **live on `driver-dev.pcvtechnologies.co.uk`** via CI (verified: the merge commit's
CI run shows the `deploy-driver-pwa-dev` job succeeded); the production deploy job was a no-op on
this run since it only fires on `master` pushes:
- `shared/announcementAudio.js`'s `createAnnouncementPlayer` no longer falls back to
  `speechSynthesis` at all — a stop with no confirmed clip now plays no audio and calls an
  `onGap` callback instead. `shared/speech.js`'s `speakUtterance` (its one remaining caller) was
  deleted outright as genuinely dead code, not just unused — `listVoices`/`pickVoice` stayed for
  `previewVoice`'s settings-only voice picker until 2026-09-24, when the picker (cog, dropdown, Test
  button) was removed from the driver PWA and `shared/speech.js` deleted with it: every clip is in the
  one centrally set voice, so a per-device choice had nothing to control.
- New table `announcement_coverage_gap` (`supabase/migration_announcement_coverage_gap.sql`) is
  the "loud" ops-facing alert this checklist item asked for — a queryable row instead of a
  `console.warn`. `vehicle_id`/`device_id` are both nullable, exactly one populated depending on
  surface (a Solo autopilot device has no `vehicle_id` at all — see the migration's own comment).
  Applied to dev (`cgcbfgceputvdvhzrgio`) and RLS-tested there (`supabase/tests/
  announcement_coverage_gap_rls.sql`, all cases pass, `get_advisors` clean) — **not yet applied to
  production.**
- New `driver/src/journeyAnnouncementPreflight.js`: `computeRequiredClipKeys` (every
  approach/departure/service/fixed key a route needs, reusing `clipKeysFor` so it can't drift) +
  `checkAnnouncementCoverage` (live `announcement_clips` lookup, records a `journey_start` gap and
  returns the missing count). Wired into all three of `main.js`'s journey-start paths (duty card,
  resume, manual selection) via a new `runAnnouncementPreflight` — fire-and-forget, never blocks
  `runTracker`, shows the existing `showInfoBanner` non-blocking notice when clips are missing.
  "Hash-confirmed locally" was implemented as a live row-exists check against `announcement_clips`
  rather than a new client-side hash-tracking store — see this session's reasoning: the service
  worker's `fetch` handler is already network-first, so a live check at (normally online)
  journey-start time delivers the real guarantee without new machinery.
- Both `driver/src/announcements.js` and `announce/src/announceSpeech.js` wire `onGap` to
  `shared/announcementCoverage.js`'s `recordAnnouncementCoverageGap` with `stage: 'live_stop'`.
  journeyId/vehicleId/driverId (Driver) or journeyId/vehicleId/deviceId (Solo) are threaded
  through the existing `ids`/`context` bag already used for clip-key lookup — no new stateful
  setter added.
- Jest+Vitest: 155+131 passing (both suites green), including new
  `journeyAnnouncementPreflight.test.js` and new Phase 3 describe blocks in `announcements.test.js`
  / `announceSpeech.test.js` asserting `speechSynthesis` is never called and a coverage-gap POST
  fires instead.
- **Not done**: no dashboard UI reads `announcement_coverage_gap` yet (deliberately out of scope —
  `pcv-dashboard/src/features/audio-config/` is currently just validation logic, no component,
  building a list view is its own vertical slice); applying the `announcement_coverage_gap`
  migration to production (code is merged and live on dev, the DB migration is the only piece
  still dev-only); a real-device pass.

**Verified for real on dev**, not just deployed: manually fired the exact `net.http_post()` call
the cron uses, got a live `200` with `{"rendered":2,"skipped":0,"failed":0}`, confirmed the
resulting `announcement_clips` rows, confirmed the actual `.mp3` files exist in the
`announcement-audio` Storage bucket (real Azure-rendered audio, 26–30KB, `audio/mpeg`), and
confirmed the public read URL serves them with correct headers. Test data cleaned up afterward
(two small harmless orphaned test clip files remain in the bucket — direct SQL `DELETE` on
`storage.objects` is blocked by Supabase's own `storage.protect_delete()`; not worth fighting the
CLI's project-link state to remove two 26KB files).

**Three real bugs found and fixed along the way** (all via actually running things against dev,
not just code review):
1. `article_for('100')` mis-articled ('an' instead of 'a') — fixed.
2. `net.http_post`'s `body` parameter needs `jsonb`, not `::text` — was silently failing the
   drain cron on every single run, and had an identical latent bug in the pre-existing
   `fn_naptan_import_on_county_change` trigger (would have hard-failed the dashboard's
   company-edit action if it ever fired). Both fixed.
3. `generate-announcement-clip`'s caller-auth check compared the incoming Bearer token against
   `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` (copied from `naptan-import`'s own pattern) — but
   on this Supabase project that auto-injected env var has drifted to the newer
   `sb_secret_...`-format key, while the platform's `verify_jwt` gateway check only accepts a
   legacy-JWT-format bearer token. No single credential satisfied both. Fixed with a dedicated
   `CALLER_AUTH_TOKEN` Edge Function secret, set to the same legacy JWT already stored in the
   `naptan_import_token` vault secret. **`naptan-weekly-refresh` was very likely also silently
   failing every week** from the same malformed vault-secret issue (its stored value was
   originally only 25 characters — the user has since fixed it via `vault.update_secret`) — worth
   confirming its next Sunday run actually succeeds, but not otherwise acted on here.

**Production rollout — DONE, completed 2026-09-15:**
- [x] `migration_announcement_clips.sql` applied to production (tables, triggers, `article_for()`).
- [x] `migration_announcement_audio_bucket.sql` applied to production (`announcement-audio` bucket
      + public-read policy).
- [x] `generate-announcement-clip` Edge Function deployed to production (`verify_jwt: true`,
      matching dev).
- [x] `AZURE_SPEECH_KEY`/`AZURE_SPEECH_REGION` secrets set on production — **shared with dev's
      resource**, see the Security section's 2026-09-15 update above.
- [x] Production's `naptan_import_token` vault secret fixed (was a placeholder, `YOUR_P...`,
      26 chars) — replaced with production's own valid legacy-format service_role JWT via
      `vault.update_secret`.
- [x] `CALLER_AUTH_TOKEN` Edge Function secret set on production, matching the fixed vault secret.
- [x] `migration_announcement_clip_drain_cron.sql` applied to production.
- [x] **Fourth bug found and fixed, production-only** (see below): `service_role` had zero grants
      on either new table on production — a genuine Postgres `permission denied`, not an RLS deny.
- [x] End-to-end verification on production, same method as dev: queued a real test job, let the
      actual 5-minute cron (not just a manual call) drain it, confirmed a live `200` from the
      function, confirmed the `announcement_clips` row, confirmed the real Azure-rendered `.mp3`
      (29,952 bytes, `audio/mpeg`) in the bucket, confirmed the public read URL serves it with
      correct headers (`200`, `Content-Type: audio/mpeg`, `Access-Control-Allow-Origin: *`).
      `announcement_clips` test row deleted afterward; the one small test `.mp3` file
      (`test/prod-verify-2026-09-15.mp3`) remains in the bucket — same as dev, direct SQL
      `DELETE` on `storage.objects` is blocked by `storage.protect_delete()`, not worth chasing
      further for one 29KB file.
- [ ] Coverage/contract test + "verify parity vs currently-committed clips" (see Phase 1
  checklist below) — not done, arguably lower priority now that real rendering is proven to work
  on both environments.
- [ ] Three small harmless orphaned test clip files remain across both buckets — two in dev
  (`approach/6753f879-f1ae-4fe2-9bdf-dc44157e9822.mp3`,
  `departure/6753f879-f1ae-4fe2-9bdf-dc44157e9822.mp3`), one in production
  (`test/prod-verify-2026-09-15.mp3`) — optional cleanup via the Storage dashboard, blocked from
  SQL `DELETE` by `storage.protect_delete()`.

**Fourth real bug found and fixed, production-only** (only surfaced because Phase 1 was actually
exercised against production, not just deployed): `generate-announcement-clip`'s service-role
Supabase client got a genuine Postgres `permission denied for table announcement_clip_jobs` on
its very first real call — not an RLS-policy denial, a table-level GRANT failure, meaning
RLS/service-role-bypass was never even reached. Root cause: **production's `public` schema has no
`pg_default_acl` entry for `service_role` at all** (confirmed via querying `pg_default_acl`
directly) — dev's schema does have one, so the identical migration "just worked" on dev via that
implicit default and masked the gap. This isn't a regression this migration caused; it's a
pre-existing environment divergence between dev and production that had never been exercised
before (production's established convention has always been explicit per-table `service_role`
grants, e.g. `naptan_stops`, precisely because it lacks the default dev has). Fixed by adding
explicit `grant all on ... to service_role;` to both `announcement_clips` and
`announcement_clip_jobs`, applied to both dev (for consistency/future-proofing, though dev didn't
strictly need it) and production, and folded into `migration_announcement_clips.sql`/
`schema.sql` for a correct fresh reset. **Also documented as a standing rule in `CLAUDE.md`'s
"Supabase: table creation rules"**: any table an Edge Function touches needs an explicit
`service_role` grant, on every environment, rather than assuming a project's default privileges
cover it — worth keeping in mind for any *other* existing Edge Function/table pairing on
production that hasn't been exercised yet and could be silently relying on the same missing
default.

**Then Phase 2 onward** (not started at all): get Driver/Solo actually reading from this pipeline
instead of the bundled clips, then Phase 3 (the actual point of this whole plan — eliminate the
`speechSynthesis` fallback), then Phases 4-5. See the checklist below for each phase's detail.

## Implementation status (superseded by "Where things stand" above — kept as a historical record)

Checked against `develop` before starting this work, 2026-09-15:

- ✅ **Rollout step 3 — Solo gets clip playback.** Shipped independently via PR #25
  (`fix/announce-audio-architecture`, merged 2026-09-08). `shared/announcementAudio.js` now
  holds `clipKeysFor()`/`createAnnouncementPlayer()`, imported by both
  `driver/src/announcements.js` and `announce/src/announceSpeech.js`. Partial G2 (shared audio
  code path) is already true.
- ❌ Everything else in this doc was still open at that point: no `announcement_clips`/
  `announcement_clip_jobs` tables, no `announcement-audio` Storage bucket, no
  `generate-announcement-clip` Edge Function, no cron drain — generation was still the manual
  `npm run generate:audio` script writing into the repo. **G1 was not met**: both
  `announcements.js` and `announceSpeech.js` still fall back to live `speechSynthesis` on a
  missing/failed clip — still true today, since that's Phase 3, not started.
- ⚠️ **Live security gap, since fixed**: `link_announce_device` had no caller-authorization
  check at all. Closed by Phase 0, live on dev and production.

## Implementation checklist

Ordered as independent vertical slices — each phase should ship as its own PR, tested
(TDD: tests first per component, matching this repo's Jest/Vitest/RLS-test split) before the
next phase starts. Every new/changed Supabase object follows `CLAUDE.md`'s GRANT+RLS rules;
every migration goes to dev (`cgcbfgceputvdvhzrgio`) first, then production
(`nwhayupsvcelyiwltdqo`) after verification, per the repo's standard workflow.

### Phase 0 — security fast-follow (do first, independent of everything else) — DONE (dev + production)
- [x] Add caller authorization to `link_announce_device`. The PWA has no login/JWT at all
      (`current_company_id()` isn't available to it), so the fix is a device-held
      `pairing_secret` (uuid, generated per row) the caller must present — checked before the
      Solo-guard and company checks so an unauthorized caller can't use error messages to probe
      device state. See `supabase/migration_link_announce_device_caller_auth.sql`.
- [x] `supabase/tests/announce_devices_rls.sql`: added case 3b proving a missing/wrong
      `pairing_secret` is rejected even when device and vehicle share a company; existing cases
      updated to pass the secret. TDD verified against dev (`cgcbfgceputvdvhzrgio`): confirmed
      red (`column "pairing_secret" does not exist`) before the migration, green after.
- [x] Migration file: `supabase/migration_link_announce_device_caller_auth.sql`. Applied to dev.
- [x] Applied to production (`nwhayupsvcelyiwltdqo`) — confirmed via
      `information_schema.columns` that `pairing_secret` exists there too.
- Note: `unlink_announce_device` has the same shape (anon-callable, no caller-auth check) but
  wasn't flagged in the original plan doc and is lower severity (worst case: knocks a device back
  to Solo autopilot, which self-heals) — left alone here; worth the same treatment later if this
  plan doc is used as an argument for extending pairing_secret to it too.
- Correction: the "no dashboard/PWA UI for this at all yet" claim above is stale —
  `announceDeviceLinkApi.js`'s `linkAnnounceDevice`/`fetchAnnounceDevicesForVehicle` already exist
  in `driver/src/`, just unwired (no caller). `fetchAnnounceDevicesForVehicle`'s raw REST select
  would also return zero rows under current RLS (no anon policy selects by `vehicle_id`) —
  flagging as a latent bug in that same unused file, not fixed here.

### Phase 1 — server-side generation pipeline — DONE (dev AND production, verified end-to-end)
- [x] Migration: `announcement_clips` table (GRANT select to anon/authenticated, RLS
      `public_read` policy, no client write policy). See `supabase/migration_announcement_clips.sql`.
- [x] Migration: `announcement_clip_jobs` table, plus triggers on `stops` (approach/departure)
      and `routes` (ROUTE_START) that enqueue a job on relevant changes. TDD verified against dev
      (`cgcbfgceputvdvhzrgio`): red before the migration, green after — including a real bug found
      and fixed along the way (`article_for('100')` mis-articled; fixed to judge only the first
      *spoken word*, same as the client's own logic) and a security gap found and closed (this
      project's default privileges grant anon/authenticated blanket access to every new
      table/function automatically — `announcement_clip_jobs` and both trigger functions now get
      an explicit `REVOKE`, not just "no GRANT", as defense-in-depth; confirmed via `get_advisors`
      and `information_schema.role_table_grants`/`role_routine_grants`).
- [x] Supabase Storage bucket `announcement-audio` (public read, service-role write only). See
      `supabase/migration_announcement_audio_bucket.sql` — follows the exact pattern already
      established by `company-logos`/`operator-assets`/`system-assets` (explicit public-read
      policy even though `public: true` already permits it), minus any write policy at all (not
      even a company-scoped `authenticated` one like those buckets have — this bucket has none).
- [x] Edge Function `supabase/functions/generate-announcement-clip/`. Deviates from this doc's
      original "import `clipKeysFor` into the Edge Function" idea: key/text/voice generation
      already happens entirely in the enqueue triggers (SQL), so the function just renders
      whatever a job row already specifies — no slug logic to duplicate/import here at all.
      Deployed to dev, `verify_jwt: true` (matching `naptan-import`/`dvsa-vol-lookup`).
  - [x] Hash algorithm cross-checked against `scripts/generate-announcement-audio.mjs`'s
        `hashText()`: ran both Node's `crypto` and Node's `webcrypto.subtle` (the same API Deno
        uses) against identical inputs, got byte-identical output.
  - [x] **Successfully invoked end-to-end on dev, with real output verified.** Manually fired the
        same `net.http_post()` call the cron uses: got a genuine `200` with
        `{"rendered":2,"skipped":0,"failed":0}`, confirmed the `announcement_clips` rows, the
        actual `.mp3` files in the bucket (26-30KB, `audio/mpeg`), and the public read URL serving
        them with correct headers. Getting here needed two more fixes beyond the pipeline itself
        — see "Where things stand" at the top of this doc (`net.http_post`'s `body` param
        needing `jsonb` not `::text`, and the `CALLER_AUTH_TOKEN` auth fix). Test data cleaned up
        from `announcement_clips`/`stops`/`announcement_clip_jobs`; two small test `.mp3` files
        remain in the bucket (harmless, `storage.protect_delete()` blocks direct SQL cleanup).
- [ ] Unit tests: key generation parity — moot now (key generation lives in the enqueue
      triggers, already covered by `supabase/tests/announcement_clips_rls.sql`), striking this
      sub-item rather than leaving it stale.
- [x] Scheduled cron drain (Supabase cron), `*/5 * * * *`, batch size 20 per cycle — mirrors
      `migration_naptan_trigger.sql`'s pg_net/pg_cron/vault-secret/app_config pattern, reusing the
      same `naptan_import_token` vault secret. Confirmed actually dispatching successfully on dev
      (`cron.job_run_details`) after both the `body` cast fix and the vault secret being
      corrected to a valid legacy JWT.
- [x] RLS tests for both new tables — `supabase/tests/announcement_clips_rls.sql` (anon/
      authenticated can read clips but never write; jobs completely inaccessible to both).
- [ ] Coverage/contract test: every `(stateKey, ids)` combination `clipKeysFor()` can produce has
      a corresponding `announcement_clips` row after a drain pass (needs the Edge Function first).
- [ ] Verify parity: regenerate everything, diff output against the currently-committed
      `driver/audio/announcements/` clips before treating the pipeline as trustworthy.
- [x] **Apply all of the above to production** (`nwhayupsvcelyiwltdqo`) — **done, see
      "Where things stand" at the top of this doc** for the full rollout record, including a
      fourth production-only bug found and fixed (missing `service_role` grants).

### Phase 2 — Driver + Solo read from the new source — DONE, dev AND production
- [x] Switch `shared/announcementAudio.js`'s clip lookup from bundled files to the
      Storage/table-backed source, with the bundled files kept as a temporary fallback during
      transition. `playClip()` initially tried `${SUPABASE_URL}/storage/v1/object/public/announcement-audio/<key>.mp3`
      first, falling through to the bundled `audioBase` path only on failure — same order for both
      Driver/Lite (`driver/src/announcements.js`) and Solo (`announce/src/announceSpeech.js`).
- [x] `busops/service-worker.js`: precache clips by querying `announcement_clips` live at
      install/update time (paginated, same `limit`/`offset` pattern as
      `scripts/generate-schedule.mjs`'s own fix for silent truncation past 1000 rows), replacing
      the static `manifest.json`-driven precache as the *primary* source. Required converting the
      service worker to `{ type: 'module' }` (both `driver/index.html` and `announce/onboard.html`)
      so it could `import` `driver/src/config.js` directly instead of duplicating the dev/prod
      Supabase URL a second time — module service workers are supported on every Chromium engine
      (this fleet's actual runtime) since 2021.
- [x] Vitest/Jest tests for both `driver/src` and `announce/src` covering the new lookup path.
      Both `announce/src/announceSpeech.test.js` and `driver/src/announcements.test.js` need
      `// @vitest-environment jsdom` (the Vitest equivalent of `tests/supabaseApi.test.js`'s
      existing `@jest-environment jsdom`), since `shared/announcementAudio.js` importing
      `config.js` means `self.location` is read at module-import time — Vitest's suite-wide
      default is `environment: 'node'`. Also added `tests/serviceWorkerAnnouncementClips.test.js`
      (Jest, jsdom) covering `fetchAnnouncementClipStorageUrls()`'s pagination/error handling.
- [x] Merged to `develop` (PR #42, 2026-09-15), then real-device-verified on dev (below), then
      shipped to production in the `v2.2.0` release (2026-09-16, see "Where things stand").
- [x] **Real-device install/activate pass with genuine live data — dev 2026-09-16, production
      2026-09-16.** Found and fixed two real bugs along the way (PRs #46/#47 — service worker
      registration failure from `config.js`'s `window`-in-a-worker-scope bug, and a stale
      `manifest.json` icon path from the 2026-08-21 restructure). Proved the Storage-backed
      precache path actually works with real data on **both** dev and production: fired the real
      enqueue trigger via a dedicated `S116T` test route on each environment (on production this
      briefly created a visible "(TEST)" route in the real Phil Haines Coaches account — cleaned
      up immediately after verification, see below), let the cron drain it into a genuine
      `announcement_clips` row + Storage `.mp3` with no manual render step, unregistered the
      service worker to force a fresh `install`, and confirmed the new clip appeared in Cache
      Storage. Test route/clip deleted from both dev and production afterward.
- [x] **Corrected 2026-09-16 — the bundled-fallback removal below is narrower than originally
      planned.** While preparing to remove `driver/audio/announcements/`, found a real architecture
      gap this checklist item had never accounted for: that directory isn't just a *browser*
      transition fallback — it's also the Bus Controller's only audio source
      (`mele-server/audioPlayer.mjs` reads it from local disk; the Controller deliberately has no
      WAN path, so it can never fetch from Storage live). Deleting the directory would have gone
      silent on the one physical Controller currently in a live vehicle. Resolution: removed only
      the *browser-side* fallback code path (`shared/announcementAudio.js`'s `playClip()` is now
      Storage-only, `createAnnouncementPlayer()` no longer takes an `audioBase` argument,
      `service-worker.js` no longer precaches the bundled files) — `driver/audio/announcements/`
      and `scripts/generate-announcement-audio.mjs` both **stay, permanently**, as the Controller's
      real and only audio pipeline. See Phase 4 below, which this same correction reshapes.
- [x] **Seventh real bug found and fixed, while investigating the above**: `mele-server/audioPlayer.mjs`'s
      `DEFAULT_AUDIO_DIR` resolved one directory level too shallow (`busops/announce/audio/`,
      which doesn't exist, instead of `busops/driver/audio/`) — every announcement on the real
      Controller had been silently skipped since it was first commissioned, with zero test
      coverage catching it (every existing test injects its own `audioDir` override). Fixed, and a
      new test now asserts the real default resolves to an existing directory.

### Phase 3 — G1: never synthesize (the actual point of this plan) — DONE, dev AND production
- [x] Journey-start check: `driver/src/journeyAnnouncementPreflight.js`'s `checkAnnouncementCoverage`,
      called (fire-and-forget) from all three of `main.js`'s journey-start paths via
      `runAnnouncementPreflight`, right before `runTracker`. Shows the existing `showInfoBanner`
      non-blocking notice ("Audio not yet ready for N stops on this route") when anything's
      missing — `runTracker` itself is untouched, so journey start is never blocked. "Hash-confirmed
      locally" implemented as a live `announcement_clips` row-exists check, not a new client-side
      hash store — see "Where things stand" above for the reasoning.
- [x] Loud ops-facing alert: new table `announcement_coverage_gap`
      (`supabase/migration_announcement_coverage_gap.sql`), written by
      `shared/announcementCoverage.js`'s `recordAnnouncementCoverageGap` — a real queryable row,
      not a `console.warn`. Applied + RLS-tested on dev, then applied to production 2026-09-16
      ahead of the `v2.2.0` release; no dashboard UI reads it yet (deliberately out of scope this
      phase — see "Where things stand" above).
- [x] Per-stop removal of the `speechSynthesis` fallback: `shared/announcementAudio.js`'s
      `createAnnouncementPlayer` calls `onGap` instead of ever synthesizing, on both
      `driver/src/announcements.js` (Driver/Lite) and `announce/src/announceSpeech.js` (Solo).
      `shared/speech.js`'s `speakUtterance` (its one caller) deleted as dead code.
- [x] Vitest tests: `journeyAnnouncementPreflight.test.js` (new) covers the journey-start
      check/warning; new Phase 3 describe blocks in `announcements.test.js`/`announceSpeech.test.js`
      assert `speechSynthesis` is never called and a coverage-gap POST fires for both the
      `journey_start` and `live_stop` stages. Full suites green (155 Jest + 131 Vitest).
- [x] Shipped to production in the `v2.2.0` release (2026-09-16), alongside Phase 2.

### Phase 4 — repurpose the local generator script — NOT STARTED (checklist corrected 2026-09-16, was based on a wrong premise)
- [x] **Superseded, 2026-09-16**: this phase originally read "narrow
      `scripts/generate-announcement-audio.mjs` to a local dev/preview tool only... stop it writing
      to the shared Storage bucket or `announcement_clips` table" — both halves were wrong. It
      never wrote to Supabase at all (checked its full git history, `9164507` through `fab0959` —
      it only ever wrote local files), so there was nothing to "stop." And per Phase 2's
      2026-09-16 correction above, its committed output (`driver/audio/announcements/`) is the Bus
      Controller's **permanent, only** audio source, not a transition artifact waiting to be
      retired — the Controller has no live-fetch path to Storage by design (no WAN access), so
      something has to keep producing committed `.mp3` files for it to `git pull`, indefinitely.
- [ ] **What Phase 4 actually is now**: this script stays a real, permanent part of the production
      pipeline for as long as Controller-based BusOps Announce hardware exists — not local-only,
      not dev-preview-only. The genuinely open item is process, not code: nothing currently
      reminds a developer to re-run `npm run generate:audio` and commit the result after a stop
      rename or route change that affects Controller-served vehicles (the browser tiers self-heal
      automatically via the live pipeline; the Controller does not). Worth a CI check or a
      dashboard reminder once more than one Controller is deployed — not urgent while only one
      exists (`docs/HARDWARE.md`).
- **Checked 2026-09-16: the "stop it writing to Storage/`announcement_clips`" half of this is
  moot** — traced the script's full git history (`9164507` through `fab0959`) and it has never
  written to Supabase at all; it only reads local `schedule.json` and writes local
  `driver/audio/announcements/*.mp3` + `manifest.json`. It's also not invoked anywhere in
  `.github/workflows/ci.yml`. So there's no Supabase-write code to remove.
- **What's actually blocking this phase**: this script's committed output
  (`driver/audio/announcements/`) is still shipped in every deploy as Phase 2's bundled fallback
  for a missing Storage-backed clip (see Phase 2's last unchecked item above). Until that fallback
  is removed — which itself waits on a real-device parity pass — this script's output is still
  genuinely part of what reaches production, so it can't be truthfully called "a local dev/preview
  tool only" yet. Narrowing its header comment/role is cosmetic until Phase 2's fallback removal
  actually ships.

### Phase 5 — docs — DONE, 2026-09-16
- [x] Updated `CLAUDE.md`'s "PSVAIR announcement audio" section (Architecture) and its Commands
      entry (retitled "PSVAIR announcement audio (legacy local generator)") to describe the
      current server-side pipeline, the never-synthesize behavior, and the dev/production
      deployment split.
- [x] Added a new decided row to `docs/DECISIONS.md` (Onboard passenger sign — architecture table)
      summarizing this plan's outcome, rather than repurposing the unrelated "Shared
      journey-tracking core" row that this doc's header originally pointed at (that row is about a
      different question — whether the tracking loop becomes its own package — and was left
      alone).
- [x] Filed the Solo → Lite detect-and-confirm ops-dashboard UI as its own tracked item in
      `docs/TODO.md` ("Announce Solo → Lite detect-and-confirm ops-dashboard UI"), including the
      latent `fetchAnnounceDevicesForVehicle` RLS gap found while re-reading `link_announce_device`
      for this plan.

## Problem

Two separate issues, confirmed in discussion:

1. **A synthesized (`speechSynthesis`) voice announcement is not acceptable in any scenario.**
   Not a quality nice-to-have — a hard requirement. Confirmed reason: it doesn't sound
   professional and is obviously synthetic to passengers.
2. Today, that requirement is violated by design in two places:
   - **Driver PWA** (`driver/src/announcements.js`): falls back to live `speechSynthesis`
     whenever a pre-rendered clip 404s, isn't yet cached offline, fails to decode/play, or the
     current state doesn't carry enough id to look a clip up at all. This can happen silently —
     `playClip()` just resolves `false` behind a `console.warn`, with no signal to driver, ops,
     or Supabase that a passenger just heard the wrong voice.
   - **Announce Solo** (`announce/src/announceSpeech.js`): synthesized voice isn't a fallback
     here, it's the *entire* audio path, 100% of the time. This tier has no pre-rendered clip
     pipeline pointed at it at all.

Root cause of (2) on Driver: clip generation is a **manual, uncoupled step**
(`npm run generate:audio`, run by a developer against `busops/driver/src/schedule.json`, output
committed to the repo). Nothing in CI enforces that clip coverage stays in lockstep with
schedule/stop data — confirmed by grepping `.github/workflows/ci.yml`, which never invokes it.
A stop can go live in the dashboard/DB instantly while its clip lags until someone remembers to
regenerate and commit.

## Goals

- **G1.** Eliminate `speechSynthesis` as a live-passenger-facing announcement path, on every
  surface, in every reachable scenario — not just "make it rarer."
- **G2.** One generation + distribution pipeline for both Driver and Announce Solo, closing the
  behavioural-split risk raised earlier in this discussion (both surfaces already share
  `shared/announceStates.js`'s text; they should share the audio the same way).
- **G3.** Clip coverage becomes a property the system maintains automatically as schedule/stop
  data changes, not a manual step a human can forget.

## Non-goals

- Not touching the onboard-sign *visual* rendering path (`onboard.js`) — already confirmed
  unified across both delivery mechanisms (push and Solo autopilot) and out of scope here.
- Not re-litigating the Controller's no-GPS/no-Supabase-polling constraint (`docs/DECISIONS.md`,
  Model 2) — the Controller still never runs any part of this pipeline; it only plays whatever
  audio the Driver PWA relays to it (`broadcastAnnounce`), unchanged.
- Not picking an Azure alternative — Azure Neural TTS stays the renderer; only *where* and *when*
  it's invoked changes.

## Proposed architecture

### 1. Storage: Supabase Storage bucket `announcement-audio`
Replaces `busops/driver/audio/announcements/` as the source of truth for rendered clips. Public
read (`anon`), matching the current trust level — these are already public static assets
committed to the repo today (stop/service names only, no PII), so this isn't a new exposure.
Writes restricted to the Edge Function's service-role context only — no client (anon or
authenticated) can write to this bucket directly, which also closes off Azure-cost abuse via a
spam-triggered regenerate.

### 2. New table: `public.announcement_clips`
Mirrors today's `manifest.json` shape, server-side:

```sql
create table public.announcement_clips (
  key text primary key,           -- e.g. 'service/6326__antons-gowt...'
  storage_path text not null,
  hash text not null,             -- same voice|text hash as today's generator
  text text not null,
  voice text not null,
  rendered_at timestamptz not null default now()
);

grant select on public.announcement_clips to anon;
grant all    on public.announcement_clips to authenticated;

alter table public.announcement_clips enable row level security;

create policy "public_read" on public.announcement_clips
  for select to anon, authenticated
  using (true);
```
(Follows this repo's standard GRANT+RLS pattern from `CLAUDE.md`'s "Supabase: table creation
rules." Only the Edge Function, via `service_role`, ever writes to it — no `insert`/`update`
policy needed for anon/authenticated.)

### 3. Job queue: `public.announcement_clip_jobs`
A trigger calling Azure synchronously inline would block the write transaction and turn a bulk
migration (e.g. a future NaPTAN import touching hundreds of stops) into hundreds of serial
Azure calls inside one DB write. Instead:

- A trigger on the tables that feed announcement text (`stops.announcement_name`/whatever backs
  `display_name()`, `timetable_departures`/service+destination fields — i.e. whatever
  `schedule_view` and `shared/announceStates.js`'s `resolveAnnouncementText` ultimately depend
  on) inserts a row into `announcement_clip_jobs` (`key`, `text`, `voice`, `requested_at`) —
  cheap, synchronous, no external call.
- A scheduled Edge Function (Supabase cron) drains the queue on a short interval, computing the
  hash and skipping anything whose `announcement_clips.hash` already matches (same idempotency
  as today's `generate-announcement-audio.mjs`), calling Azure and writing Storage + the manifest
  table only for genuine changes.
- This also naturally coalesces a burst of changes (e.g. a bulk migration) into one drain pass
  instead of a storm of webhook calls.
- **Decided 2026-09-08: cap the drain batch size per cycle** (e.g. N jobs per run, remainder
  picked up next cycle). A bulk data change — a future large NaPTAN import touching hundreds of
  stops is the concrete example — should trickle out across several cron cycles rather than
  firing one uncapped burst at Azure in a single run, which risks hitting rate limits or a sudden
  cost spike.

### 4. Edge Function: `generate-announcement-clip`
Deno/TypeScript, alongside the existing `naptan-import`/`dvsa-vol-lookup` functions in
`supabase/functions/`. Azure key/region live as Edge Function secrets — never client-exposed,
consistent with the existing hard rule that `busops/driver/src/config.js` may only ever hold
anon/publishable keys.

**Key-naming risk, and how to actually close it (not just relocate it):** the current codebase
already flags that `announcements.js`'s `slug()` and `generate-announcement-audio.mjs`'s `slug()`
"must stay identical... no shared import between a browser module and a Node script... keep them
in sync by hand." Moving generation into a Deno Edge Function doesn't remove that risk unless we
use it to actually fix it: Deno can `import` a plain relative `.js`/`.ts` file directly, so the
Edge Function should import `shared/announceStates.js` and the slug logic **from the same file**
Driver and Solo already import, rather than re-implementing it a third time. This turns "keep
three copies in sync by hand" into "one shared module, three importers" — a strict improvement,
and directly in the spirit of the G2 goal above.

### 5. Client-side sync (Driver + Solo, same code path)
Both already read Supabase; add:
- Read `announcement_clips`, diff hashes against the local cache's stored `{key: hash}` map
  (IndexedDB or Cache Storage on Driver; equivalent local store on Solo).
- Optionally subscribe via Supabase Realtime for push-notified updates instead of polling —
  this repo already has the pattern in `shared/deviceStateSync.js`'s `subscribeToChanges`.
- Download only what's missing/changed; store keyed the same way clips are looked up today.

**Decided 2026-09-08 — full precache, sourced live, not a build-time snapshot.** Driver's
`busops/service-worker.js` currently precaches every clip listed in a static `manifest.json`
baked into the deploy. Instead of replacing that with a CI-generated snapshot of
`announcement_clips` (which would just reintroduce "something must regenerate this file," now
tied to deploy cadence instead of a human), the service worker's own `install`/`update` event
queries `announcement_clips` live and precaches everything it returns — no build-time step at
all. Rationale: full precache directly closes one of the four original failure scenarios
("offline before first cache" — see Problem above); a bounded/on-demand cache would reopen it
for a brand-new device that goes offline before ever completing an online pass. It's also not a
new cost — Driver already ships every clip bundled with every deploy today, so this only changes
*where* the bytes come from, not how many there are. Same mechanism applies to Solo's own local
cache once it has one (see Rollout below).

## The part that actually delivers G1: never play a missing clip

Automating generation shrinks the "clip doesn't exist yet" window from *hours/days* (a human
forgetting to run the script) to *seconds* (async render + upload + client download) — but
doesn't remove it. If a journey could start against a stop whose clip is still in flight, the
system is right back to the scenario just ruled out.

Closing that fully requires the device to treat "clip not confirmed present" as a real state it
checks, not just a `playClip()` failure it papers over:

- Before a journey starts (or before showing a stop that isn't cached yet), check that every
  clip the resolved route/schedule needs is present and hash-confirmed locally.

**Decided 2026-09-08 — hybrid, not either pure block or pure degrade:**

- **Never block journey start.** A pure "block" design was rejected: it contradicts the
  offline-resilience principle this codebase already shipped deliberately
  (`docs/DECISIONS.md` "Offline resilience," 2026-08-25) — a manually-started journey is never
  blocked by backend unavailability, and treating a missing clip differently from any other
  backend hiccup would be inconsistent with that precedent. A driver can always start their
  route.
- **Surface it at two points, not zero.** At journey start, if any stop on the resolved route
  lacks a confirmed clip, show the driver a visible, non-blocking warning ("audio not yet ready
  for N stops on this route"). Separately, fire a loud ops-facing alert (not a silent
  `console.warn`) so the gap gets fixed on a pipeline timescale rather than discovered via a
  passenger complaint.
- **Per stop, when actually reached: visual-only, never synthesized.** Show the on-screen text
  (already required regardless, same as today) but play no audio for that specific stop rather
  than falling back to `speechSynthesis`. This is the mechanism that actually delivers G1 — the
  system is allowed to have a rare, narrow, self-correcting gap in *audio coverage*, but never
  allowed to substitute a synthesized voice to paper over it.

Rationale: keeps the "never synthesized" guarantee absolute (the actual requirement) without
reversing the existing "never block a route over a backend issue" precedent, and replaces a
silent gap with visibility at both dispatch time and in ops monitoring.

## Related: Solo → Lite conversion when a Driver device arrives later

Came up during this review, not part of the audio pipeline itself, but the same "should this
be automatic or explicit" question applies — folded in here rather than as a separate doc.

**Question:** if a vehicle already has a Solo-commissioned Announce device installed (no
driver, running its own GPS/autopilot per `announceSoloAutopilot.js`), and a Driver device is
later installed in that same vehicle, should the Announce device implicitly convert to Lite
(stop running its own tracking, become a pure renderer of the Driver's pushed state)?

**Current mechanism, confirmed in `supabase/migration_announce_devices_solo_guard.sql`:**
- The only path from Solo (`gps_source = 'internal'`) to Lite (`gps_source = 'driver-device'`)
  is `link_announce_device(p_device_id, p_vehicle_id, p_force)`.
- If the device is Solo-commissioned (`candidate_departure_ids` populated), the function
  **refuses by default** — raises unless `p_force := true` is passed explicitly.
- There is **no dashboard/PWA UI for this at all yet** — linking today is a manual
  `select link_announce_device(...)` SQL call (`docs/TESTING.md` §17).

**Why the guard exists:** a live incident on 2026-09-04 — a Solo tablet got linked (flipped to
Lite) with no driver device ever actually pushing to it, so it sat blank indefinitely waiting
for a feed that would never arrive. The fix has two halves: this DB-side refusal, plus a
client-side watchdog (`shouldSelfHeal` in `announceLiteMode.js`) that reverts a stuck Lite
device back to autopilot if no push arrives within a timeout — covering the case even when the
guard *is* deliberately overridden with `p_force`.

**Recommendation: detect-and-confirm, not fully automatic, not manual-SQL-only.**
Neither extreme is right — full automation repeats the exact failure class the guard was built
to stop (a flip nobody actively decided on, with a real if-bridged screen-blank gap); leaving it
SQL-only is an acknowledged gap (the migration's own comment implies it), not a considered
design. Concretely: when a Driver journey starts for a `vehicle_id` that already has an
`announce_devices` row with `candidate_departure_ids` populated and `gps_source <> 'driver-device'`,
surface a prompt in the ops dashboard ("this vehicle has a Solo-commissioned Announce device —
link it to this driver?") and call `link_announce_device(..., p_force := true)` only on explicit
confirmation. Natural home: the `tracking` or `vehicles` slice in `pcv-dashboard/src/features/`.

**Security note, found while reading this function — worth checking independently of the above:**
`link_announce_device` is `security definer` and its grant is `to anon` (matching the PWA's "no
login, ever" convention). It checks that the device and vehicle share the same `company_id` as
*each other*, but nothing in it checks the *caller* is authorized for that company — no
`auth.uid()`/`current_company_id()` gate. Given the anon key is public by design (shipped in
`busops/driver/src/config.js`, safe only because RLS is supposed to be what actually gates
access), anyone holding it can currently link any device to any vehicle across any company, as
long as that device and vehicle already share a `company_id`. Flagging this because it's a
cross-tenant boundary on a `SECURITY DEFINER` function, not because it's part of this plan's
scope — worth a second look regardless of whether the auto-detect UI above gets built.

**Decided 2026-09-08 — split into two, different urgency:**
- The `link_announce_device` caller-authorization gap gets fixed as its **own fast-follow**,
  independent of this plan's timeline — it's a live cross-tenant exposure, not something that
  should wait on an audio pipeline's rollout schedule.
- The detect-and-confirm ops-dashboard UI is real but separate product work — tracked as a
  fast-follow, **out of scope for this plan's initial phases**.

## Rollout, phased

1. **Build the pipeline, no client changes.** Storage bucket, `announcement_clips` +
   `announcement_clip_jobs` tables (dev Supabase project first), Edge Function, cron drain.
   Verify parity: regenerate everything, diff output against the currently-committed
   `driver/audio/announcements/` clips.
2. **Driver reads from the new source.** Switch `announcements.js`'s clip lookup from bundled
   files to Storage/table-backed cache. Keep the bundled files as a temporary fallback during the
   transition; remove once parity is proven on dev, then production.
3. **Solo gets clip playback for the first time** — currently pure `speechSynthesis`, so this is
   net-new capability, not a migration. `announceSpeech.js`'s live-TTS call becomes gated by the
   same hybrid decision as Driver's (see "The part that actually delivers G1" above): visual-only
   per stop when a clip isn't confirmed, never a live-TTS fallback.
4. **Repurpose `scripts/generate-announcement-audio.mjs`, don't retire it.** Decided 2026-09-08:
   keep it as a local dev/preview tool only — auditioning a wording change before it ships — and
   explicitly stop it writing to the shared Storage bucket or `announcement_clips` table. It's no
   longer part of the production pipeline once the Edge Function/queue/drain above ships.
5. **Update docs**: `CLAUDE.md`'s "PSVAIR announcement audio" section and `docs/DECISIONS.md`'s
   "still open" row on the shared tracking core, per this repo's own hygiene rule of updating the
   decision doc and its source together.

## Testing (test-first per component, matching this repo's Jest/Vitest split)

- **Edge Function unit tests**: hash-skip idempotency (unchanged text/voice → no re-render, no
  Azure call); key/slug generation, asserted against the *same* shared module Driver/Solo import
  (a real parity guarantee now, not a hand-maintained one).
- **Coverage/contract test**: for every `(stateKey, ids)` combination `clipKeysFor()` can
  produce (from `shared/announceStates.js`'s `ANNOUNCE_STATES`), assert a corresponding
  `announcement_clips` row exists post-drain — catches "text rule changed, clip pipeline didn't"
  before it ships.
- **Client integration tests** (Vitest, both `driver/src` and `announce/src`): journey-start
  proceeds with a visible non-blocking warning when a route has unconfirmed clips; a reached stop
  with no confirmed clip shows visual-only and never calls `speechSynthesis`; the ops alert fires
  in both cases.
- **RLS tests** (`supabase/tests/`) for `announcement_clips`/`announcement_clip_jobs`, per
  existing convention — confirm anon can read clips but never write, and jobs are never
  anon/authenticated-writable at all (only the trigger and service-role Edge Function touch that
  table).

## Security

- Azure key/region: Edge Function secret only — never reachable from
  `busops/driver/src/config.js` or any other client-shipped file. **Decided 2026-09-15,
  reversing this doc's original "provisioned per-project separately" plan:** dev
  (`cgcbfgceputvdvhzrgio`) and production (`nwhayupsvcelyiwltdqo`) deliberately share one Azure
  Speech resource/key, to stay within Azure's free tier. This function only *reads* the resource
  (TTS synthesis, no writes/state), so the two environments sharing a quota carries no
  cross-environment data risk — just a shared rate/cost ceiling, accepted as the tradeoff for
  free-tier usage.
- Storage bucket: public **read**, service-role-only **write** — no anon/authenticated insert,
  update, or delete policy on the bucket or on `announcement_clips`.
- `announcement_clip_jobs` has no client-facing RPC to insert into it directly — only the DB
  trigger and the draining Edge Function touch it, closing off a cost-abuse vector (someone
  spamming regenerate requests to run up the Azure bill).
- Content itself (stop names, service codes, destinations) carries no PII — same exposure level
  as the current publicly-committed `.mp3` files, so moving them to a public-read bucket isn't a
  new disclosure, but flagging it here explicitly since you've called security paramount.

## Open questions — all decided 2026-09-08

All five questions originally raised here have been settled; kept as a record of what was open
and how it was resolved, per this repo's own convention (`docs/DECISIONS.md`) of moving a
resolved item rather than deleting the trail.

1. ~~Option A (block) vs Option B (degrade + alert)~~ — **Hybrid.** See "The part that actually
   delivers G1" above — never block journey start, warn at dispatch time plus a loud ops alert,
   per-stop visual-only fallback, never synthesized.
2. ~~Full build-time `manifest.json` vs bounded cache~~ — **Full precache, sourced live** by the
   service worker at install/update time, not a build-time snapshot. See "Client-side sync"
   above.
3. ~~Retire `scripts/generate-announcement-audio.mjs`?~~ — **Keep, narrowed to a local
   dev/preview tool only**, no longer part of the production pipeline. See Rollout step 4.
4. ~~Bulk-change rate concern~~ — **Yes, cap the scheduled drain's batch size per cycle.** See
   "Job queue" above.
5. ~~Solo → Lite detect-and-confirm UI, and the `link_announce_device` auth gap~~ — **Split.**
   The auth gap is a fast-follow fixed on its own, independent of this plan's timeline; the
   detect-and-confirm UI is real but separate product work, out of scope for this plan's initial
   phases. See "Related" above.

**Status update: this plan has no remaining open questions.** Ready to move from design to
implementation planning (task breakdown, migration file, Edge Function scaffold) whenever you
want to proceed.
