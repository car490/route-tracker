#!/usr/bin/env node
/**
 * import-naptan.js — imports NAPTAN bus stop data into the naptan_stops table.
 *
 * Usage:
 *   SUPABASE_URL=https://nwhayupsvcelyiwltdqo.supabase.co \
 *   SUPABASE_SERVICE_KEY=<your-service-role-key> \
 *   node supabase/scripts/import-naptan.js
 *
 * The service role key bypasses RLS for bulk upsert. Get it from:
 *   Supabase Dashboard → Settings → API → service_role (secret)
 *
 * NAPTAN data is downloaded from the DfT open API. The full GB CSV is filtered
 * to a geographic bounding box (BBOX) covering Lincolnshire. Widen the box in
 * the config section below if routes expand into neighbouring counties.
 *
 * Bus stop types imported (others — rail, ferry, tram — are excluded):
 *   BCT  On-street Bus/Coach/Tram stop  (the most common type)
 *   BCS  Bus/Coach Station entrance/exit
 *   BCQ  Bus/Coach Station bay
 *   BCP  Bus/Coach private stop
 *
 * Run weekly to pick up NAPTAN updates.
 */

'use strict'

const https    = require('https')
const zlib     = require('zlib')
const readline = require('readline')

// ── Configuration ─────────────────────────────────────────────────────────────

const SUPABASE_URL     = process.env.SUPABASE_URL     || 'https://nwhayupsvcelyiwltdqo.supabase.co'
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY

// Geographic bounding box — keeps all active bus stops within this lat/lon rectangle.
// ATCO area codes don't align predictably with county boundaries so we filter by
// coordinates instead. This box covers Lincolnshire + a small margin on all sides.
// Widen it if routes expand into neighbouring counties.
const BBOX = { latMin: 52.65, latMax: 53.75, lonMin: -1.0, lonMax: 0.5 }

const BUS_STOP_TYPES = new Set(['BCT', 'BCS', 'BCQ', 'BCP'])

// Full GB download — area filtering done client-side by BBOX above.
const NAPTAN_URL = 'https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv'

const BATCH_SIZE = 500

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!SUPABASE_KEY) {
    console.error('ERROR: SUPABASE_SERVICE_KEY env var is required.')
    console.error('Get it from: Supabase Dashboard → Settings → API → service_role')
    process.exit(1)
  }

  console.log(`Bounding box: lat ${BBOX.latMin}–${BBOX.latMax}, lon ${BBOX.lonMin}–${BBOX.lonMax}`)
  console.log('Downloading NAPTAN data from DfT...')
  console.log('(This may take a minute — full GB CSV is ~150 MB)\n')

  const stops = await streamNaptanCsv()
  console.log(`\nFiltered to ${stops.length} active bus stops`)

  if (stops.length === 0) {
    console.error('No stops found — check BBOX and the NAPTAN download URL')
    process.exit(1)
  }

  console.log('Upserting to naptan_stops...')
  await upsertBatched(stops)
  console.log('\nDone.')
}

// ── NAPTAN CSV download + parse ───────────────────────────────────────────────

function streamNaptanCsv() {
  return new Promise((resolve, reject) => {
    const url = new URL(NAPTAN_URL)
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

      // Decompress if gzip
      let stream = res
      const encoding = res.headers['content-encoding'] || ''
      if (encoding.includes('gzip')) {
        const gz = zlib.createGunzip()
        res.pipe(gz)
        stream = gz
      } else if (encoding.includes('deflate')) {
        const deflate = zlib.createInflate()
        res.pipe(deflate)
        stream = deflate
      }

      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
      const stops = []
      let headers = null
      let lineCount = 0
      let skipped = 0

      rl.on('line', line => {
        lineCount++
        if (lineCount === 1) {
          headers = parseCsvLine(line)
          return
        }

        if (lineCount % 50000 === 0) process.stdout.write(`  Parsed ${lineCount.toLocaleString()} rows...\r`)

        const cols = parseCsvLine(line)
        if (cols.length < headers.length) return

        const row = {}
        headers.forEach((h, i) => { row[h] = cols[i] ?? '' })

        const atco     = row['ATCOCode'] || row['AtcoCode'] || ''
        const status   = (row['Status'] || '').toLowerCase()
        const stopType = row['StopType'] || ''

        // Filter: active bus stop type first (cheap)
        if (status !== 'active') { skipped++; return }
        if (!BUS_STOP_TYPES.has(stopType)) { skipped++; return }

        // Filter: within geographic bounding box
        const lat = parseFloat(row['Latitude'])
        const lon = parseFloat(row['Longitude'])
        if (!lat || !lon) { skipped++; return }
        if (lat < BBOX.latMin || lat > BBOX.latMax || lon < BBOX.lonMin || lon > BBOX.lonMax) { skipped++; return }

        stops.push({
          atco_code:    atco,
          naptan_code:  row['NaptanCode'] || null,
          common_name:  row['CommonName'] || atco,
          locality_name: row['LocalityName'] || null,
          street:       row['Street'] || null,
          indicator:    row['Indicator'] || null,
          bearing:      row['Bearing'] || null,
          lat,
          lon,
          stop_type:    stopType,
          status:       'active',
          updated_at:   new Date().toISOString(),
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
    const batch = stops.slice(i, i + BATCH_SIZE)
    await upsertBatch(batch)
    inserted += batch.length
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
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey':        SUPABASE_KEY,
        'Prefer':        'resolution=merge-duplicates,return=minimal',
      },
    }

    const req = https.request(options, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve()
        } else {
          reject(new Error(`Supabase upsert failed (HTTP ${res.statusCode}): ${data}`))
        }
      })
    })

    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ── CSV parser (handles quoted fields with embedded commas/newlines) ───────────

function parseCsvLine(line) {
  const fields = []
  let cur = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ }
      else { inQuotes = !inQuotes }
    } else if (ch === ',' && !inQuotes) {
      fields.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  fields.push(cur.trim())
  return fields
}

// ── Run ───────────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error('\nFailed:', err.message)
  process.exit(1)
})
