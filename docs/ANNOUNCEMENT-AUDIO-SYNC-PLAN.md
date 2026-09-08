# Announcement audio: server-triggered generation + sync — plan

**Status: design settled 2026-09-08, all open questions resolved. Not yet implemented — no
product code has been changed as part of this plan, doc changes only.**
Written 2026-09-08 following a design discussion flagged in `docs/DECISIONS.md`'s
"Shared journey-tracking core" open item. Once implementation starts, this doc's outcome should
be folded back into `docs/DECISIONS.md` and `CLAUDE.md`'s "PSVAIR announcement audio" section,
same as every other architecture decision in this repo.

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

- Azure key/region: Edge Function secret only, provisioned per-project (dev `cgcbfgceputvdvhzrgio`
  and production `nwhayupsvcelyiwltdqo` separately, matching this repo's existing dev/prod
  migration discipline) — never reachable from `busops/driver/src/config.js` or any other
  client-shipped file.
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
