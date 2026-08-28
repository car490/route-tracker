// BusOps Announce Lite — Supabase-based feed for this device's own
// announce_devices row, as an alternative to Standard's /sign-feed
// WebSocket (onboard.js's connectSignFeed()). This is onboard.js's
// first-ever Supabase dependency — an intentional, scoped exception (see
// that file's header comment), gated entirely behind ?announce-device-token=
// being present, so a Standard device never loads or executes any of this.
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
// modes (previously only paired mode subscribed at all — standalone read its
// config once and never again, see announceStandaloneAutopilot.js's
// applyConfigUpdate). A gps_source flip (linked/unlinked mid-session) tears
// down the running mode and starts the other, via announceLiteMode.js's
// resolveModeSwitch — the "hot-switch" this file previously disclaimed.

import { SUPABASE_URL, SUPABASE_KEY } from '../../driver/src/config.js';
import { startStandaloneAutopilot } from './announceStandaloneAutopilot.js';
import { resolveModeSwitch } from './announceLiteMode.js';
import { hydrate, subscribeToChanges, startHeartbeat } from '../../shared/deviceStateSync.js';

const HEARTBEAT_INTERVAL_MS = 30000;

// Only a genuinely new schedule should re-trigger onSchedule() (it resets
// #onboard-idle/#onboard-sign visibility and re-acquires the wake lock —
// see onboard.js). update_announce_device_state's coalesce means every row
// update carries both latest_schedule and latest_state even when only one
// changed, so a naive "call onSchedule whenever the column is non-null"
// would re-fire it on every single state tick.
function scheduleChanged(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

// deviceToken is the JWT minted by api/sign-announce-token.js (device_id/
// company_id/vehicle_id claims, no exp — see that file). onSchedule/onState
// are onboard.js's own exported render functions; onIdleNextDeparture is
// onboard.js's idle-screen extension (standalone mode only) — all
// dependency-injected so this module doesn't need to import onboard.js
// (which would create a circular import, since onboard.js imports
// connectAnnounceLiteFeed). onDegraded/onRestored are optional — let a
// caller surface connection health (currently: console visibility only, see
// the module header) without this file needing to know about onboard.js's
// DOM at all.
export function connectAnnounceLiteFeed(deviceToken, { onSchedule, onState, onJourneyEnd, onIdleNextDeparture, onDegraded, onRestored }) {
  const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${deviceToken}` } },
  });
  // Realtime's own channel auth is separate from the REST headers above —
  // without this, postgres_changes subscribes as the bare anon key and the
  // device_self RLS policy (auth.jwt() ->> 'device_id') has no claim to match.
  client.realtime.setAuth(deviceToken);

  let lastSchedule = null;
  let mode = null; // 'internal' | 'driver-device'
  let standaloneHandle = null; // { stop, refreshCandidates, applyConfigUpdate } — standalone mode only
  let subscription = null;
  let heartbeat = null;
  let deviceId = null;

  // Paired mode (gps_source: 'driver-device') — render whatever the linked
  // Driver device has pushed into this row.
  function applyPushedRow(row) {
    if (!row) return;
    if (row.latest_schedule && scheduleChanged(row.latest_schedule, lastSchedule)) {
      lastSchedule = row.latest_schedule;
      onSchedule(row.latest_schedule);
    } else if (!row.latest_schedule && lastSchedule !== null) {
      // Journey ended (end_announce_device_journey cleared both columns) —
      // the Realtime-transport equivalent of Standard's {type:'complete'}
      // WebSocket message (see onboard.js's onJourneyEnd).
      lastSchedule = null;
      onJourneyEnd?.();
    }
    if (row.latest_state) onState(row.latest_state);
  }

  function startStandalone(row) {
    mode = 'internal';
    standaloneHandle = startStandaloneAutopilot(client, row, {
      onSchedule, onState, onIdleNextDeparture,
      onGpsSourceChanged: (nextRow) => switchMode(nextRow),
    });
  }

  function startPaired(row) {
    mode = 'driver-device';
    standaloneHandle = null;
    // Paired mode has no schedule pushed yet on a fresh link (or a device
    // that's simply between journeys) — unlike standalone mode, nothing else
    // unhides #onboard-idle for this case, so the device would otherwise sit
    // fully blank (both #onboard-idle and #onboard-sign hidden, see
    // onboard.html) until the first push arrives. onIdleNextDeparture(null)
    // unhides the idle board without showing a next-departure caption (that
    // caption is standalone-only) — reused rather than adding a new function.
    if (!row.latest_schedule) onIdleNextDeparture?.(null);
    lastSchedule = null;
    applyPushedRow(row);
  }

  // Tears down whichever mode is currently running and starts the other —
  // reached only when resolveModeSwitch confirms gps_source itself changed,
  // never on an ordinary state/schedule push.
  function switchMode(row) {
    standaloneHandle?.stop();
    if (row.gps_source === 'internal') startStandalone(row);
    else startPaired(row);
  }

  function handleRowChange(row) {
    const nextMode = resolveModeSwitch(mode, row);
    if (nextMode) { switchMode(row); return; }
    if (mode === 'internal') standaloneHandle?.applyConfigUpdate(row);
    else applyPushedRow(row);
  }

  async function start() {
    // device_self RLS policy scopes this to exactly this device's own row —
    // no filter needed, there is only ever one possible match.
    let row;
    try {
      row = await hydrate(client, 'announce_devices');
    } catch (error) {
      console.warn('announceLiteFeed: could not read own announce_devices row — retrying', error);
      setTimeout(start, 3000);
      return;
    }

    deviceId = row.id;
    if (row.gps_source === 'internal') startStandalone(row);
    else startPaired(row);

    // Previously subscribed only in paired mode, and previously only
    // console.error'd a dead channel with no recovery (CHANNEL_ERROR/
    // TIMED_OUT) — subscribeToChanges reconnects with backoff in both
    // modes now, and onDegraded/onRestored let a caller react instead of
    // the failure only ever showing up in a browser console nobody
    // trackside is looking at.
    subscription = subscribeToChanges(client, 'announce_devices', { column: 'id', value: deviceId }, {
      onChanged: (row, { changed }) => { if (changed) handleRowChange(row); },
      onDegraded: (status, err) => {
        console.error('announceLiteFeed: Realtime subscription degraded', status, err);
        onDegraded?.(status, err);
      },
      onRestored: () => onRestored?.(),
    });

    // Self-reported liveness — standalone mode never called any of the
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
      standaloneHandle?.stop();
      heartbeat?.stop();
    },
  };
}
