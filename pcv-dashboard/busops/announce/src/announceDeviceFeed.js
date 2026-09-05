// BusOps Announce — Supabase-based feed for this device's own
// announce_devices row, shared by both the Lite (paired) and Solo
// (driverless) tiers, as an alternative to the base tier's /sign-feed
// WebSocket (onboard.js's connectSignFeed()). This is onboard.js's
// first-ever Supabase dependency — an intentional, scoped exception (see
// that file's header comment), gated entirely behind ?announce-device-token=
// being present, so a base-tier device never loads or executes any of this.
//
// Uses the vendored @supabase/supabase-js UMD bundle (../lib/supabase.min.js,
// loaded via a plain <script> tag in onboard.html — same treatment as
// driver/lib/leaflet.min.js) rather than a CDN import or the driver PWA's
// raw-fetch convention, because Realtime (postgres_changes) needs the SDK's
// WebSocket/Phoenix-channel client, which there's no reasonable case for
// hand-rolling. `supabase` below refers to that script's global, not an
// import — there is no bundler here (see CLAUDE.md, no build step for this app).
//
// Mode is no longer decided once at boot and frozen — a device's own row is
// watched continuously via deviceStateSync.js's subscribeToChanges, in BOTH
// modes (previously only Lite mode subscribed at all — Solo read its config
// once and never again). A gps_source flip (linked/unlinked mid-session)
// tears down the running mode and starts the other, via
// announceLiteMode.js's resolveModeSwitch — the "hot-switch" this file
// previously disclaimed.

import { SUPABASE_URL, SUPABASE_KEY } from '../../driver/src/config.js';
import { startSoloAutopilot } from './announceSoloAutopilot.js';
import { resolveModeSwitch, shouldSelfHeal } from './announceLiteMode.js';
import { hydrate, subscribeToChanges, startHeartbeat } from '../../shared/deviceStateSync.js';

const HEARTBEAT_INTERVAL_MS = 30000;
// Self-heal watchdog: a Solo-commissioned device (candidate_departure_ids
// populated) stuck in driver-device mode with no driver push for this long
// reverts itself to autopilot — see announceLiteMode.js's shouldSelfHeal and
// migration_announce_devices_solo_guard.sql for the other half of this fix
// (found live 2026-09-04, a Solo device left waiting for a driver poke that
// would never come).
const SELF_HEAL_TIMEOUT_MS = 10 * 60 * 1000;
const SELF_HEAL_CHECK_INTERVAL_MS = 60000;

// Only a genuinely new schedule should re-trigger onSchedule() (it resets
// #onboard-idle/#onboard-sign visibility and re-acquires the wake lock —
// see onboard.js). update_announce_device_state's coalesce means every row
// update carries both latest_schedule and latest_state even when only one
// changed, so a naive "call onSchedule whenever the column is non-null"
// would re-fire it on every single state tick.
function scheduleChanged(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

// A Lite device between journeys has latest_schedule cleared to null via
// end_announce_device_journey — a non-null value that's very old means the
// row was never properly cleared (crash, power loss, stuck driver device),
// not a genuinely in-progress journey. Without this, a fresh page load (e.g.
// after a reboot) unconditionally replays whatever's sitting in the row, so a
// device could flash a day-old journey to real passengers before anything
// corrects it — found live 2026-09-05 on an Announce Solo unit stuck showing
// a 2026-09-04 test journey. Mirrors announceSoloAutopilot.js's
// COMPLETION_TIMEOUT_MIN (2h) — same "how long before untouched journey
// state stops being trustworthy" question, answered the same way for both
// tiers.
const STALE_PUSH_THRESHOLD_MS = 2 * 60 * 60 * 1000;

function isPushStale(row) {
  return !!row.state_updated_at && Date.now() - new Date(row.state_updated_at).getTime() > STALE_PUSH_THRESHOLD_MS;
}

// companies is anon-readable (schema.sql's "anon_read" policy, `using
// (true)` — same one driver/src/supabaseApi.js's fetchCompanyName() already
// relies on), so no new RLS surface is needed for this. logo_path is a
// Supabase Storage path ('operator-assets/{company_id}/logo.*', per
// schema.sql's column comment), not a URL — resolved the same way the
// dashboard already does it (Layout.jsx/BrandingPage.jsx's getPublicUrl()),
// not duplicated as a second lookup pattern. null fields (no row, no logo
// set) just mean onboard.js's applyIdleBranding() has nothing extra to
// apply — never blocks the idle screen itself from showing.
async function fetchCompanyBranding(client, companyId) {
  if (!companyId) return { name: null, logoUrl: null, accentColor: null };
  const { data, error } = await client
    .from('companies')
    .select('name, logo_path, accent_color')
    .eq('id', companyId)
    .single();
  if (error || !data) return { name: null, logoUrl: null, accentColor: null };
  const logoUrl = data.logo_path
    ? client.storage.from('operator-assets').getPublicUrl(data.logo_path).data.publicUrl
    : null;
  return { name: data.name, logoUrl, accentColor: data.accent_color };
}

// deviceToken is the JWT minted by api/sign-announce-token.js (device_id/
// company_id/vehicle_id claims, no exp — see that file). onSchedule/onState
// are onboard.js's own exported render functions; onIdleNextDeparture is
// onboard.js's idle-screen extension (Solo mode only) — all
// dependency-injected so this module doesn't need to import onboard.js
// (which would create a circular import, since onboard.js imports
// connectAnnounceDeviceFeed). onDegraded/onRestored are optional — let a
// caller surface connection health (currently: console visibility only)
// without this file needing to know about onboard.js's DOM at all.
export function connectAnnounceDeviceFeed(deviceToken, { onSchedule, onState, onJourneyEnd, onIdleNextDeparture, onIdleBranding, onSleep, onDegraded, onRestored }) {
  const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${deviceToken}` } },
  });
  // Realtime's own channel auth is separate from the REST headers above —
  // without this, postgres_changes subscribes as the bare anon key and the
  // device_self RLS policy (auth.jwt() ->> 'device_id') has no claim to match.
  client.realtime.setAuth(deviceToken);

  let lastSchedule = null;
  let mode = null; // 'internal' | 'driver-device'
  let soloHandle = null; // { stop, refreshCandidates, applyConfigUpdate } — Solo mode only
  let subscription = null;
  let heartbeat = null;
  let deviceId = null;

  // Self-heal watchdog state — only meaningful while mode === 'driver-device'.
  let liteWatchdog = null;
  let liteEnteredAt = null;
  let liteLastStateUpdatedAt = null;
  let liteCandidateDepartureIds = [];

  function stopLiteWatchdog() {
    if (liteWatchdog) { clearInterval(liteWatchdog); liteWatchdog = null; }
  }

  function checkSelfHeal() {
    const referenceMs = liteLastStateUpdatedAt ? new Date(liteLastStateUpdatedAt).getTime() : liteEnteredAt;
    const msSinceLastPush = Date.now() - referenceMs;
    if (!shouldSelfHeal({ candidateDepartureIds: liteCandidateDepartureIds, msSinceLastPush, timeoutMs: SELF_HEAL_TIMEOUT_MS })) return;
    stopLiteWatchdog();
    console.warn('announceDeviceFeed: Solo-commissioned device stuck in driver-device mode with no push — self-healing back to internal autopilot');
    // Fire-and-forget: the resulting row change (gps_source back to
    // 'internal') arrives through the existing Realtime subscription and
    // hot-switches via handleRowChange/switchMode, same as any other
    // gps_source flip — no extra wiring needed here. supabase-js's query
    // builder is thenable but not a real Promise (.catch alone throws), so
    // wrap it — same fix already applied elsewhere in this file's siblings.
    Promise.resolve(client.rpc('unlink_announce_device', { p_device_id: deviceId })).catch((err) => {
      console.error('announceDeviceFeed: self-heal unlink_announce_device failed', err);
    });
  }

  // Lite (paired) mode — render whatever the linked Driver device has
  // pushed into this row.
  function applyPushedRow(row) {
    if (!row) return;
    liteLastStateUpdatedAt = row.state_updated_at ?? liteLastStateUpdatedAt;
    liteCandidateDepartureIds = row.candidate_departure_ids ?? liteCandidateDepartureIds;
    // A stale push (see isPushStale above) is treated as no schedule at all —
    // never rendered, regardless of how long it's been sitting in the row.
    const effectiveSchedule = row.latest_schedule && !isPushStale(row) ? row.latest_schedule : null;
    if (effectiveSchedule && scheduleChanged(effectiveSchedule, lastSchedule)) {
      lastSchedule = effectiveSchedule;
      onSchedule(effectiveSchedule);
    } else if (!effectiveSchedule && lastSchedule !== null) {
      // Journey ended (end_announce_device_journey cleared both columns) —
      // the Realtime-transport equivalent of the base tier's
      // {type:'complete'} WebSocket message (see onboard.js's onJourneyEnd).
      lastSchedule = null;
      onJourneyEnd?.();
    }
    if (effectiveSchedule && row.latest_state) onState(row.latest_state);
  }

  function startSolo(row) {
    mode = 'internal';
    // onJourneyEnd is threaded through so a completed Solo journey hides
    // its stale sign the same way the base/Lite tiers' journey-end signals
    // already do (see announceSoloAutopilot.js's completeActiveJourney).
    soloHandle = startSoloAutopilot(client, row, {
      onSchedule, onState, onIdleNextDeparture, onJourneyEnd, onSleep,
      onGpsSourceChanged: (nextRow) => switchMode(nextRow),
    });
  }

  function startLite(row) {
    mode = 'driver-device';
    soloHandle = null;
    liteEnteredAt = Date.now();
    liteLastStateUpdatedAt = row.state_updated_at ?? null;
    liteCandidateDepartureIds = row.candidate_departure_ids ?? [];
    stopLiteWatchdog();
    liteWatchdog = setInterval(checkSelfHeal, SELF_HEAL_CHECK_INTERVAL_MS);
    // Lite mode has no schedule pushed yet on a fresh link (or a device
    // that's simply between journeys) — unlike Solo mode, nothing else
    // unhides #onboard-idle for this case, so the device would otherwise
    // sit fully blank (both #onboard-idle and #onboard-sign hidden, see
    // onboard.html) until the first push arrives. onIdleNextDeparture(null)
    // unhides the idle board without showing a next-departure caption (that
    // caption is Solo-only) — reused rather than adding a new function.
    if (!row.latest_schedule || isPushStale(row)) onIdleNextDeparture?.(null);
    lastSchedule = null;
    applyPushedRow(row);
  }

  // Tears down whichever mode is currently running and starts the other —
  // reached only when resolveModeSwitch confirms gps_source itself changed,
  // never on an ordinary state/schedule push.
  function switchMode(row) {
    soloHandle?.stop();
    stopLiteWatchdog();
    if (row.gps_source === 'internal') startSolo(row);
    else startLite(row);
  }

  function handleRowChange(row) {
    const nextMode = resolveModeSwitch(mode, row);
    if (nextMode) { switchMode(row); return; }
    if (mode === 'internal') soloHandle?.applyConfigUpdate(row);
    else applyPushedRow(row);
  }

  async function start() {
    // device_self RLS policy scopes this to exactly this device's own row —
    // no filter needed, there is only ever one possible match.
    let data;
    try {
      data = await hydrate(client, 'announce_devices');
    } catch (error) {
      console.warn('announceDeviceFeed: could not read own announce_devices row — retrying', error);
      setTimeout(start, 3000);
      return;
    }

    deviceId = data.id;

    // Fire-and-forget — the idle screen's own logo/name fallback (see
    // onboard.js's initIdleScreen()) already covers the case where this is
    // slow or the company has no logo set; not worth blocking device
    // startup on. Applies to both Lite and Solo (fetched here, before the
    // mode branch below), since both tiers share the same idle screen.
    fetchCompanyBranding(client, data.company_id).then((branding) => onIdleBranding?.(branding));

    if (data.gps_source === 'internal') startSolo(data);
    else startLite(data);

    // Previously subscribed only in Lite mode, and previously only
    // console.error'd a dead channel with no recovery (CHANNEL_ERROR/
    // TIMED_OUT) — subscribeToChanges reconnects with backoff in both
    // modes now, and onDegraded/onRestored let a caller react instead of
    // the failure only ever showing up in a browser console nobody
    // trackside is looking at. This is also what fixes the Solo boot-time
    // hang first-beta-test feedback (2026-09-03) found: previously Solo
    // never subscribed to its own row changes at all, so a device
    // reconfigured (or a device that only just got its first
    // candidate_departure_ids set) needed a manual reload to notice.
    subscription = subscribeToChanges(client, 'announce_devices', { column: 'id', value: deviceId }, {
      onChanged: (row, { changed }) => { if (changed) handleRowChange(row); },
      onDegraded: (status, err) => {
        console.error('announceDeviceFeed: Realtime subscription degraded', status, err);
        onDegraded?.(status, err);
      },
      onRestored: () => onRestored?.(),
    });

    // Self-reported liveness — Solo mode never called any of the
    // Driver-invoked RPCs that used to be the only thing touching
    // last_seen_at, so it previously had no way to report it was alive at
    // all. Every device writes this itself now, independent of mode or of
    // anything else pushing through it (see
    // migration_announce_devices_config_version.sql).
    heartbeat = startHeartbeat(
      () => client.rpc('report_device_heartbeat').catch(() => {}),
      HEARTBEAT_INTERVAL_MS
    );
  }

  start();

  return {
    stop: () => {
      subscription?.stop();
      soloHandle?.stop();
      heartbeat?.stop();
      stopLiteWatchdog();
    },
  };
}
