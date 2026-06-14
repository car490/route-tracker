#!/usr/bin/env node
/**
 * import-naptan.js — imports NAPTAN bus stop data into the naptan_stops table.
 *
 * Usage:
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_KEY=<service-role-key> \
 *   OPENCAGE_API_KEY=<opencage-key> \
 *   node supabase/scripts/import-naptan.js
 *
 * The service role key bypasses RLS for bulk upsert. Get it from:
 *   Supabase Dashboard → Settings → API → service_role (secret)
 *
 * The OpenCage API key is used to geocode the county names stored in
 * companies.service_counties into a bounding box. Free tier (2,500 req/day)
 * is sufficient. Get a key at https://opencagedata.com
 *
 * The bounding box is derived at runtime from the company's service_counties
 * field — no hardcoded coordinates. Add counties to that field if routes
 * expand into neighbouring areas.
 *
 * For scheduled services (Local Bus, Schools) stops are snapped to the nearest
 * NAPTAN stop within the coverage area. Excursions and Private Hire use
 * OpenCage geocoding for freeform destinations and do not require NAPTAN.
 *
 * Bus stop types imported (rail, ferry, tram excluded):
 *   BCT  On-street Bus/Coach/Tram stop
 *   BCS  Bus/Coach Station entrance/exit
 *   BCQ  Bus/Coach Station bay
 *   BCP  Bus/Coach private stop
 *
 * Run when service_counties changes, or periodically to pick up NAPTAN updates.
 */

'use strict'

const https    = require('https')
const zlib     = require('zlib')
const readline = require('readline')

// ── Configuration ─────────────────────────────────────────────────────────────

const SUPABASE_URL  = process.env.SUPABASE_URL
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY
const OPENCAGE_KEY  = process.env.OPENCAGE_API_KEY

const BUS_STOP_TYPES = new Set(['BCT', 'BCS', 'BCQ', 'BCP'])
const NAPTAN_URL     = 'https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv'
const BATCH_SIZE     = 500

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!SUPABASE_URL)  { console.error('ERROR: SUPABASE_URL env var is required.');         process.exit(1) }
  if (!SUPABASE_KEY)  { console.error('ERROR: SUPABASE_SERVICE_KEY env var is required.'); process.exit(1) }
  if (!OPENCAGE_KEY)  { console.error('ERROR: OPENCAGE_API_KEY env var is required.');     process.exit(1) }

  // 1. Read service counties from the companies table
  console.log('Reading service counties from database...')
  const counties = await fetchServiceCounties()
  if (!counties.length) {
    console.error('ERROR: companies.service_counties is empty — add at least one county.')
    process.exit(1)
  }
  console.log(`  Counties: ${counties.join(', ')}`)

  // 2. Geocode each county to a bounding box via OpenCage
  console.log('Geocoding counties via OpenCage...')
  const bboxes = []
  for (const county of counties) {
    const bbox = await geocodeCounty(county)
    console.log(`  ${county}: lat ${bbox.latMin.toFixed(4)}–${bbox.latMax.toFixed(4)}, lon ${bbox.lonMin.toFixed(4)}–${bbox.lonMax.toFixed(4)}`)
    bboxes.push(bbox)
  }
  const bbox = mergeBboxes(bboxes)
  console.log(`  Merged bbox: lat ${bbox.latMin.toFixed(4)}–${bbox.latMax.toFixed(4)}, lon ${bbox.lonMin.toFixed(4)}–${bbox.lonMax.toFixed(4)}`)

  // 3. Download and filter NAPTAN data
  console.log('\nDownloading NAPTAN data from DfT...')
  console.log('(This may take a minute — full GB CSV is ~150 MB)\n')
  const stops = await streamNaptanCsv(bbox)
  console.log(`\nFiltered to ${stops.length} active bus stops`)

  if (!stops.length) {
    console.error('No stops found — check service_counties and OpenCage result')
    process.exit(1)
  }

  // 4. Upsert to Supabase
  console.log('Upserting to naptan_stops...')
  await upsertBatched(stops)
  console.log('\nDone.')
}

// ── Fetch service counties from DB ────────────────────────────────────────────

function fetchServiceCounties() {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1/companies`)
    url.search = 'select=service_counties&limit=1'

    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'GET',
      headers:  {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    }

    const req = https.request(options, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to read companies (HTTP ${res.statusCode}): ${data}`))
          return
        }
        const rows = JSON.parse(data)
        resolve(rows[0]?.service_counties ?? [])
      })
    })
    req.on('error', reject)
    req.end()
  })
}

// ── OpenCage geocoding ────────────────────────────────────────────────────────

function geocodeCounty(countyName) {
  return new Promise((resolve, reject) => {
    const query = encodeURIComponent(`${countyName}, UK`)
    const path  = `/geocode/v1/json?q=${query}&key=${OPENCAGE_KEY}&limit=1&no_annotations=1`

    const options = {
      hostname: 'api.opencagedata.com',
      path,
      method:   'GET',
      headers:  { 'User-Agent': 'RouteTracker/1.0' },
    }

    const req = https.request(options, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`OpenCage error (HTTP ${res.statusCode}) for "${countyName}": ${data}`))
          return
        }
        const json = JSON.parse(data)
        const result = json.results?.[0]
        if (!result?.bounds) {
          reject(new Error(`OpenCage returned no bounds for "${countyName}"`))
          return
        }
        resolve({
          latMin: result.bounds.southwest.lat,
          latMax: result.bounds.northeast.lat,
          lonMin: result.bounds.southwest.lng,
          lonMax: result.bounds.northeast.lng,
        })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

function mergeBboxes(bboxes) {
  return {
    latMin: Math.min(...bboxes.map(b => b.latMin)),
    latMax: Math.max(...bboxes.map(b => b.latMax)),
    lonMin: Math.min(...bboxes.map(b => b.lonMin)),
    lonMax: Math.max(...bboxes.map(b => b.lonMax)),
  }
}

// ── NAPTAN CSV download + parse ───────────────────────────────────────────────

function streamNaptanCsv(bbox) {
  return new Promise((resolve, reject) => {
    const url     = new URL(NAPTAN_URL)
    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'GET',
      headers:  { 'Accept-Encoding': 'gzip, deflate', 'User-Agent': 'RouteTracker/1.0' },
    }

    const req = https.request(options, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`NAPTAN API returned HTTP ${res.statusCode}`))
        return
      }

      let stream = res
      const encoding = res.headers['content-encoding'] || ''
      if (encoding.includes('gzip')) {
        const gz = zlib.createGunzip(); res.pipe(gz); stream = gz
      } else if (encoding.includes('deflate')) {
        const df = zlib.createInflate(); res.pipe(df); stream = df
      }

      const rl      = readline.createInterface({ input: stream, crlfDelay: Infinity })
      const stops   = []
      let headers   = null
      let lineCount = 0
      let skipped   = 0

      rl.on('line', line => {
        lineCount++
        if (lineCount === 1) { headers = parseCsvLine(line); return }
        if (lineCount % 50000 === 0) process.stdout.write(`  Parsed ${lineCount.toLocaleString()} rows...\r`)

        const cols = parseCsvLine(line)
        if (cols.length < headers.length) return

        const row      = {}
        headers.forEach((h, i) => { row[h] = cols[i] ?? '' })

        const status   = (row['Status'] || '').toLowerCase()
        const stopType = row['StopType'] || ''
        if (status !== 'active')             { skipped++; return }
        if (!BUS_STOP_TYPES.has(stopType))   { skipped++; return }

        const lat = parseFloat(row['Latitude'])
        const lon = parseFloat(row['Longitude'])
        if (!lat || !lon)                                                           { skipped++; return }
        if (lat < bbox.latMin || lat > bbox.latMax || lon < bbox.lonMin || lon > bbox.lonMax) { skipped++; return }

        stops.push({
          atco_code:     row['ATCOCode'] || row['AtcoCode'] || '',
          naptan_code:   row['NaptanCode'] || null,
          common_name:   row['CommonName'] || '',
          locality_name: row['LocalityName'] || null,
          street:        row['Street'] || null,
          indicator:     row['Indicator'] || null,
          bearing:       row['Bearing'] || null,
          lat,
          lon,
          stop_type:     stopType,
          status:        'active',
          updated_at:    new Date().toISOString(),
        })
      })

      rl.on('close', () => {
        console.log(`  Parsed ${lineCount.toLocaleString()} rows total, skipped ${skipped.toLocaleString()}`)
        resolve(stops)
      })
      rl.on('error', reject)
    })

    req.on('error', reject)
    req.end()
  })
}

// ── Supabase upsert ───────────────────────────────────────────────────────────

async function upsertBatched(stops) {
  let inserted = 0
  for (let i = 0; i < stops.length; i += BATCH_SIZE) {
    await upsertBatch(stops.slice(i, i + BATCH_SIZE))
    inserted += Math.min(BATCH_SIZE, stops.length - i)
    process.stdout.write(`  Upserted ${inserted}/${stops.length}\r`)
  }
  console.log(`  Upserted ${inserted} stops            `)
}

function upsertBatch(rows) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(rows)
    const url  = new URL(`${SUPABASE_URL}/rest/v1/naptan_stops`)

    const options = {
      hostname: url.hostname,
      path:     url.pathname + '?on_conflict=atco_code',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization':  `Bearer ${SUPABASE_KEY}`,
        'apikey':         SUPABASE_KEY,
        'Prefer':         'resolution=merge-duplicates,return=minimal',
      },
    }

    const req = https.request(options, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve()
        else reject(new Error(`Supabase upsert failed (HTTP ${res.statusCode}): ${data}`))
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ── CSV parser ────────────────────────────────────────────────────────────────

function parseCsvLine(line) {
  const fields = []
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

// ── Run ───────────────────────────────────────────────────────────────────────

main().catch(err => { console.error('\nFailed:', err.message); process.exit(1) })
