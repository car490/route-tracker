/**
 * naptan-import Edge Function
 *
 * Called in two ways:
 *   1. By the companies trigger (via pg_net) when service_counties gains new entries.
 *      Body: { counties: ["Nottinghamshire"], mode: "add" }
 *      Imports only the new counties — does not disturb existing stops.
 *
 *   2. By a pg_cron weekly job for a full refresh of all counties.
 *      Body: { mode: "refresh" }
 *      Re-imports all counties from the companies table, keeping data current.
 *
 * Which stops: each county in companies.service_counties maps to its NaPTAN ATCO
 * area code (../_shared/naptanAreas.mjs; Lincolnshire = 270) and the DfT API is
 * asked for just those areas. No geocoding service or API key (OpenCage county
 * bounding boxes were removed 2026-09-29). An unknown county stops the run with
 * a message saying how to add it.
 *
 * Secured by the CALLER_AUTH_TOKEN Edge Function secret (../_shared/callerAuth.mjs),
 * shared with generate-announcement-clip: the caller's Bearer token must equal it.
 * Both callers send the vault secret naptan_import_token (a legacy service_role
 * JWT, which the verify_jwt gateway accepts); CALLER_AUTH_TOKEN holds the same
 * value. Until 2026-09-29 this compared against SUPABASE_SERVICE_ROLE_KEY, which
 * has moved to the sb_secret_ format on these projects, so every call got 401.
 *
 * One-time setup per environment, if not already done for generate-announcement-clip:
 *   select vault.create_secret('<legacy service_role JWT>', 'naptan_import_token');
 *   supabase secrets set CALLER_AUTH_TOKEN=<the same legacy service_role JWT>
 *
 * Database access uses this function's own SUPABASE_SERVICE_ROLE_KEY, never the
 * caller's token. service_role needs SELECT on companies.service_counties (refresh) and
 * write access to naptan_stops (migration_naptan_import_service_role.sql).
 *
 * Each run's status (active/inactive/etc.) is taken from the source Status
 * field, and any previously-active stop in the run's areas (by ATCO prefix)
 * that's missing from the feed entirely (record deleted at the source, not just
 * flagged non-active) is swept to status='removed' — see
 * fetchExistingActiveAtcoCodes(). Stops in other areas are left untouched.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isAuthorizedCaller } from '../_shared/callerAuth.mjs'
import { areaCodesForCounties, naptanCsvUrl, stopFromNaptanRow, unknownCountiesMessage } from '../_shared/naptanAreas.mjs'

const BATCH_SIZE  = 500

interface NaptanStop {
  atco_code: string; naptan_code: string | null; common_name: string
  locality_name: string | null; street: string | null; indicator: string | null
  bearing: string | null; lat: number; lon: number
  stop_type: string; status: string; updated_at: string
}

Deno.serve(async (req) => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  if (!(await isAuthorizedCaller(req.headers.get('Authorization'), (k) => Deno.env.get(k)))) {
    return new Response('Unauthorized', { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const mode: string     = body.mode ?? 'add'
  const counties: string[] = body.counties ?? []

  // ── Kick off import in background, respond immediately ───────────────────
  // The caller has already had its 202, so a failure is only visible in the
  // function's logs: log it rather than leave an unhandled rejection.
  const task = runImport(mode, counties).catch((err) => {
    console.error(`naptan-import [${mode}] failed: ${err instanceof Error ? err.message : err}`)
  })
  EdgeRuntime.waitUntil(task)

  return new Response(
    JSON.stringify({ status: 'accepted', mode, counties }),
    { status: 202, headers: { 'Content-Type': 'application/json' } }
  )
})

// ── Main import logic ─────────────────────────────────────────────────────────

async function runImport(mode: string, counties: string[]) {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Resolve target counties
  let targetCounties = counties
  if (mode === 'refresh' || !targetCounties.length) {
    const { data, error } = await supabase
      .from('companies')
      .select('service_counties')
      .limit(1)
      .single()
    if (error) throw new Error(`Failed to read companies: ${error.message}`)
    targetCounties = data?.service_counties ?? []
  }
  if (!targetCounties.length) throw new Error('No counties to import')

  // Counties -> NaPTAN ATCO area codes (no geocoding)
  const { codes: areaCodes, unknown } = areaCodesForCounties(targetCounties)
  if (unknown.length) throw new Error(unknownCountiesMessage(unknown))
  console.log(`naptan-import [${mode}]: ${targetCounties.join(', ')} -> areas ${areaCodes.join(', ')}`)

  // Stream just those areas' NaPTAN CSV
  const stops = await streamNaptanCsv(areaCodes)
  console.log(`Filtered to ${stops.length} stops`)
  if (!stops.length) throw new Error(`NaPTAN returned no bus stops for areas ${areaCodes.join(', ')}`)

  // Snapshot which currently-active stops already exist in this area — used
  // below to detect stops that have dropped out of the feed entirely (as
  // opposed to still being present but flagged non-active, which the real
  // Status value on each row already covers).
  const existingCodes = await fetchExistingActiveAtcoCodes(supabase, areaCodes)

  // Upsert in batches
  for (let i = 0; i < stops.length; i += BATCH_SIZE) {
    const { error } = await supabase
      .from('naptan_stops')
      .upsert(stops.slice(i, i + BATCH_SIZE), { onConflict: 'atco_code' })
    if (error) throw new Error(`Upsert failed at offset ${i}: ${error.message}`)
  }

  // Sweep: anything previously active here but absent from this run's feed
  // has been removed from the source data — flag it so naptan_near_point()
  // (which filters status = 'active') stops suggesting it.
  const seenCodes = new Set(stops.map(s => s.atco_code))
  const removed   = existingCodes.filter(code => !seenCodes.has(code))
  for (let i = 0; i < removed.length; i += BATCH_SIZE) {
    const { error } = await supabase
      .from('naptan_stops')
      .update({ status: 'removed', updated_at: new Date().toISOString() })
      .in('atco_code', removed.slice(i, i + BATCH_SIZE))
    if (error) throw new Error(`Sweep update failed at offset ${i}: ${error.message}`)
  }

  console.log(`naptan-import done: ${stops.length} stops upserted, ${removed.length} removed`)
}

// ── Existing-stops snapshot (for the removal sweep) ───────────────────────────

async function fetchExistingActiveAtcoCodes(
  supabase: ReturnType<typeof createClient>,
  areaCodes: string[],
): Promise<string[]> {
  const PAGE_SIZE = 1000
  const codes: string[] = []

  for (const area of areaCodes) {  // three-digit codes, checked by naptanCsvUrl()
    let from = 0
    for (;;) {
      const { data, error } = await supabase
        .from('naptan_stops')
        .select('atco_code')
        .eq('status', 'active')
        .like('atco_code', `${area}%`)
        .order('atco_code')
        .range(from, from + PAGE_SIZE - 1)
      if (error) throw new Error(`Failed to read existing naptan_stops: ${error.message}`)

      codes.push(...(data ?? []).map((r: { atco_code: string }) => r.atco_code))
      if (!data || data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }
  }

  return codes
}

// ── NAPTAN CSV streaming ───────────────────────────────────────────────────────

async function streamNaptanCsv(areaCodes: string[]): Promise<NaptanStop[]> {
  const res = await fetch(naptanCsvUrl(areaCodes), {
    headers: { 'Accept-Encoding': 'gzip, deflate', 'User-Agent': 'RouteTracker/1.0' },
  })
  if (!res.ok) throw new Error(`NAPTAN API returned ${res.status}`)

  const stops:   NaptanStop[] = []
  let   headers: string[] | null = null
  let   buffer  = ''
  const decoder = new TextDecoder()

  const handleLine = (line: string) => {
    if (!line.trim()) return
    if (!headers) { headers = parseCsv(line); return }

    const cols: Record<string, string> = {}
    parseCsv(line).forEach((v, i) => { cols[headers![i]] = v })

    const stop = stopFromNaptanRow(cols, areaCodes, new Date().toISOString())
    if (stop) stops.push(stop)
  }

  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    lines.forEach(handleLine)
  }
  // The last row has no trailing newline; without this it was dropped, and
  // the sweep would then mark that stop 'removed' on every run.
  handleLine(buffer + decoder.decode())

  return stops
}

// ── CSV parser (handles quoted fields) ────────────────────────────────────────

function parseCsv(line: string): string[] {
  const fields: string[] = []
  let cur = '', inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      fields.push(cur.trim()); cur = ''
    } else {
      cur += ch
    }
  }
  fields.push(cur.trim())
  return fields
}
