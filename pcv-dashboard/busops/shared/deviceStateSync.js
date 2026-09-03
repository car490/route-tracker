// BusOps — generic device state-reconciliation primitive.
//
// Every device that owns a Supabase identity/config row (today:
// announce_devices for BusOps Announce Lite; tomorrow: whatever table a PA
// amp controller, ticketing reader, or APC sensor ends up with — see
// docs/HARDWARE.md §10, none built yet) needs the same three things: read
// its own row at boot, notice when that row changes without waiting for a
// reboot, and report its own liveness. This module is that shared contract
// — it doesn't know or care what kind of device is watching it.
//
// Pure decision logic (hasRowChanged/computeBackoffDelayMs/isHeartbeatDue/
// shouldReconnect/deriveConnectionState) is unit-tested in
// tests/deviceStateSync.test.js, DOM/Supabase-free — same idiom as
// scheduleAutopilot.js. The wrappers below (hydrate/subscribeToChanges/
// startHeartbeat) are thin Supabase/timer glue, untested here, matching this
// repo's existing convention of leaving thin RPC/fetch/timer wrappers
// uncovered while the decision logic around them is tested (see
// announceDeviceLinkApi.js's header comment).

// Detects whether a device's own row actually changed since the last time
// it was read. Prefers a monotonic version column (bumped by a DB trigger —
// see supabase/migration_announce_devices_config_version.sql) because it's
// a single-integer comparison regardless of how wide the row is; falls back
// to a deep comparison for a row/table that doesn't have one (or hasn't
// been read yet at all — null prevRow is always "changed", i.e. the first
// hydrate always counts as new state).
export function hasRowChanged(prevRow, nextRow, { versionKey = 'config_version' } = {}) {
  if (!prevRow) return true;
  if (prevRow[versionKey] != null && nextRow[versionKey] != null) {
    return prevRow[versionKey] !== nextRow[versionKey];
  }
  return JSON.stringify(prevRow) !== JSON.stringify(nextRow);
}

// Exponential backoff, capped — same shape any reconnect loop needs
// regardless of transport (Realtime channel, WebSocket, plain fetch retry).
export function computeBackoffDelayMs(attempt, { baseMs = 1000, maxMs = 30000 } = {}) {
  return Math.min(baseMs * 2 ** attempt, maxMs);
}

// Whether a periodic self-liveness write is due. lastHeartbeatAt is null
// before the first write — always due immediately in that case.
export function isHeartbeatDue(lastHeartbeatAt, now, intervalMs) {
  if (!lastHeartbeatAt) return true;
  return now.getTime() - lastHeartbeatAt.getTime() >= intervalMs;
}

// Which Realtime subscribe statuses warrant a reconnect attempt. Mirrors
// Supabase's postgres_changes status callback — CHANNEL_ERROR/TIMED_OUT are
// failures, SUBSCRIBED is healthy, CLOSED is a deliberate unsubscribe (e.g.
// this module's own teardown) and should not trigger a reconnect loop.
export function shouldReconnect(status) {
  return status === 'CHANNEL_ERROR' || status === 'TIMED_OUT';
}

// Maps a Realtime status to a small state any caller can render an
// indicator from, without needing to know Supabase's specific status
// strings. Unrecognized statuses degrade rather than being treated as
// healthy — an unknown status is not a confirmed-good one.
export function deriveConnectionState(status) {
  if (status === 'SUBSCRIBED') return 'connected';
  if (status === 'CLOSED') return 'closed';
  return 'degraded';
}

// Reads a device's own row fresh — called at boot and after any reconnect,
// never trusted as a one-time read. `filter` is applied via .eq(column,
// value); omit it when RLS already scopes to exactly one row (e.g.
// announce_devices' device_self policy).
export async function hydrate(client, table, filter) {
  let query = client.from(table).select('*');
  if (filter) query = query.eq(filter.column, filter.value);
  const { data, error } = await query.single();
  if (error) throw error;
  return data;
}

// Subscribes to UPDATE events on a device's own row, with reconnect/backoff
// on failure and a changed-vs-unchanged signal on every event (via
// hasRowChanged) so a caller can skip re-rendering on a no-op push (e.g.
// update_announce_device_state's coalesce touching last_seen_at alone).
// onDegraded/onRestored let any caller surface connection health instead of
// only logging it — the gap this closes is announceDeviceFeed.js previously
// only console.error'ing a dead channel with no recovery attempt.
export function subscribeToChanges(client, table, filter, { onChanged, onDegraded, onRestored, versionKey } = {}) {
  let attempt = 0;
  let lastRow = null;
  let stopped = false;
  let retryTimer = null;
  let channel = null;

  function teardown() {
    if (channel) client.removeChannel(channel);
    if (retryTimer) clearTimeout(retryTimer);
  }

  function connect() {
    if (stopped) return;
    channel = client
      .channel(`device-sync-${table}-${filter?.value ?? 'self'}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table, filter: filter ? `${filter.column}=eq.${filter.value}` : undefined },
        (payload) => {
          const changed = hasRowChanged(lastRow, payload.new, { versionKey });
          lastRow = payload.new;
          onChanged?.(payload.new, { changed });
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          attempt = 0;
          onRestored?.();
          return;
        }
        if (shouldReconnect(status)) {
          onDegraded?.(status, err);
          if (channel) client.removeChannel(channel);
          const delay = computeBackoffDelayMs(attempt, {});
          attempt += 1;
          retryTimer = setTimeout(connect, delay);
        }
      });
  }

  connect();

  return {
    stop: () => { stopped = true; teardown(); },
  };
}

// Periodic self-liveness write. Every device writes this itself (standalone
// Lite included) rather than relying on something else's RPC calls to
// incidentally touch a last_seen_at column as a side effect.
export function startHeartbeat(writeFn, intervalMs) {
  const timer = setInterval(() => { writeFn(); }, intervalMs);
  return { stop: () => clearInterval(timer) };
}
