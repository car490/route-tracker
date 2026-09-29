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
 * Required Edge Function secrets (set in Supabase Dashboard → Edge Functions → Secrets):
 *   OPENCAGE_API_KEY   — https://opencagedata.com (free tier is sufficient)
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
 * field, and any previously-active stop within the run's bbox that's missing
 * from the feed entirely (record deleted at the source, not just flagged
 * non-active) is swept to status='removed' — see fetchExistingActiveAtcoCodes().
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isAuthorizedCaller } from '../_shared/callerAuth.mjs'

const NAPTAN_URL  = 'https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv'
const BUS_TYPES   = new Set(['BCT', 'BCS', 'BCQ', 'BCP'])
const BATCH_SIZE  = 500

interface BBox { latMin: number; latMax: number; lonMin: number; lonMax: number }
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
  const opencageKey = Deno.env.get('OPENCAGE_API_KEY')!

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

  console.log(`naptan-import [${mode}]: ${targetCounties.join(', ')}`)

  // Geocode each county to a bbox
  const bboxes = await Promise.all(targetCounties.map(c => geocodeCounty(c, opencageKey)))
  const bbox   = mergeBboxes(bboxes)
  console.log(`Merged bbox: lat ${bbox.latMin}–${bbox.latMax}, lon ${bbox.lonMin}–${bbox.lonMax}`)

  // Stream NAPTAN CSV and filter to bbox
  const stops = await streamNaptanCsv(bbox)
  console.log(`Filtered to ${stops.length} stops`)

  // Snapshot which currently-active stops already exist in this area — used
  // below to detect stops that have dropped out of the feed entirely (as
  // opposed to still being present but flagged non-active, which the real
  // Status value on each row already covers).
  const existingCodes = await fetchExistingActiveAtcoCodes(supabase, bbox)

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
  bbox: BBox,
): Promise<string[]> {
  const PAGE_SIZE = 1000
  const codes: string[] = []
  let from = 0

  for (;;) {
    const { data, error } = await supabase
      .from('naptan_stops')
      .select('atco_code')
      .eq('status', 'active')
      .gte('lat', bbox.latMin).lte('lat', bbox.latMax)
      .gte('lon', bbox.lonMin).lte('lon', bbox.lonMax)
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`Failed to read existing naptan_stops: ${error.message}`)

    codes.push(...(data ?? []).map((r: { atco_code: string }) => r.atco_code))
    if (!data || data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return codes
}

// ── OpenCage geocoding ─────────────────────────────────────────────────────────

async function geocodeCounty(county: string, apiKey: string): Promise<BBox> {
  const url  = `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(county + ', UK')}&key=${apiKey}&limit=1&no_annotations=1`
  const res  = await fetch(url, { headers: { 'User-Agent': 'RouteTracker/1.0' } })
  const json = await res.json()

  const bounds = json.results?.[0]?.bounds
  if (!bounds) {
    // OpenCage's own status says why (e.g. 401 invalid/missing key, 402 quota).
    // Never include the request URL here: it carries the API key.
    const why = json.status ? `OpenCage ${json.status.code}: ${json.status.message}` : `HTTP ${res.status}`
    throw new Error(`OpenCage returned no bounds for "${county}" (${why})`)
  }

  return {
    latMin: bounds.southwest.lat,
    latMax: bounds.northeast.lat,
    lonMin: bounds.southwest.lng,
    lonMax: bounds.northeast.lng,
  }
}

function mergeBboxes(bboxes: BBox[]): BBox {
  return {
    latMin: Math.min(...bboxes.map(b => b.latMin)),
    latMax: Math.max(...bboxes.map(b => b.latMax)),
    lonMin: Math.min(...bboxes.map(b => b.lonMin)),
    lonMax: Math.max(...bboxes.map(b => b.lonMax)),
  }
}

// ── NAPTAN CSV streaming ───────────────────────────────────────────────────────

async function streamNaptanCsv(bbox: BBox): Promise<NaptanStop[]> {
  const res = await fetch(NAPTAN_URL, {
    headers: { 'Accept-Encoding': 'gzip, deflate', 'User-Agent': 'RouteTracker/1.0' },
  })
  if (!res.ok) throw new Error(`NAPTAN API returned ${res.status}`)

  const stops:   NaptanStop[] = []
  let   headers: string[] | null = null
  let   buffer  = ''
  const decoder = new TextDecoder()

  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.trim()) continue

      if (!headers) { headers = parseCsv(line); continue }

      const cols: Record<string, string> = {}
      parseCsv(line).forEach((v, i) => { cols[headers![i]] = v })

      const status   = (cols['Status'] ?? '').toLowerCase()
      const stopType = cols['StopType'] ?? ''
      if (!BUS_TYPES.has(stopType)) continue

      const lat = parseFloat(cols['Latitude'])
      const lon = parseFloat(cols['Longitude'])
      if (!lat || !lon) continue
      if (lat < bbox.latMin || lat > bbox.latMax || lon < bbox.lonMin || lon > bbox.lonMax) continue

      stops.push({
        atco_code:    cols['ATCOCode'] || cols['AtcoCode'] || '',
        naptan_code:  cols['NaptanCode'] || null,
        common_name:  cols['CommonName'] || '',
        locality_name: cols['LocalityName'] || null,
        street:       cols['Street'] || null,
        indicator:    cols['Indicator'] || null,
        bearing:      cols['Bearing'] || null,
        lat, lon,
        stop_type:    stopType,
        status:       status || 'active',
        updated_at:   new Date().toISOString(),
      })
    }
  }

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
