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

import { SUPABASE_URL, SUPABASE_KEY } from '../../driver/src/config.js';
import { startStandaloneAutopilot } from './announceStandaloneAutopilot.js';

const RECONNECT_DELAY_MS = 3000;

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
// connectAnnounceLiteFeed).
//
// Mode is decided once, from the row read at startup, and not hot-switched
// mid-session — a device changing gps_source (e.g. linked while running)
// takes effect on its next reload, same as a Standard device's own
// commissioning is fixed per boot.
export function connectAnnounceLiteFeed(deviceToken, { onSchedule, onState, onIdleNextDeparture }) {
  const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${deviceToken}` } },
  });
  // Realtime's own channel auth is separate from the REST headers above —
  // without this, postgres_changes subscribes as the bare anon key and the
  // device_self RLS policy (auth.jwt() ->> 'device_id') has no claim to match.
  client.realtime.setAuth(deviceToken);

  let lastSchedule = null;

  // Paired mode (gps_source: 'driver-device') — render whatever the linked
  // Driver device has pushed into this row.
  function applyPushedRow(row) {
    if (!row) return;
    if (row.latest_schedule && scheduleChanged(row.latest_schedule, lastSchedule)) {
      lastSchedule = row.latest_schedule;
      onSchedule(row.latest_schedule);
    }
    if (row.latest_state) onState(row.latest_state);
  }

  async function start() {
    // device_self RLS policy scopes this to exactly this device's own row —
    // no .eq('id', ...) needed, there is only ever one possible match.
    const { data, error } = await client.from('announce_devices').select('*').single();
    if (error || !data) {
      console.warn('announceLiteFeed: could not read own announce_devices row — retrying', error);
      setTimeout(start, RECONNECT_DELAY_MS);
      return;
    }

    if (data.gps_source === 'internal') {
      // Standalone (driverless) — a no-op idle screen if this device has no
      // candidate_departure_ids configured yet (see
      // startStandaloneAutopilot's own guard), same as before this feature
      // existed.
      startStandaloneAutopilot(client, data, { onSchedule, onState, onIdleNextDeparture });
      return;
    }

    applyPushedRow(data);

    client
      .channel(`announce-device-${data.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'announce_devices', filter: `id=eq.${data.id}` },
        (payload) => applyPushedRow(payload.new)
      )
      .subscribe();
  }

  start();
}
