#!/usr/bin/env node
/**
 * import-naptan.js — imports NAPTAN bus stop data into the naptan_stops table.
 *
 * Usage:
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_KEY=<service-role-key> \
 *   node supabase/scripts/import-naptan.js
 *
 * The service role key bypasses RLS for bulk upsert. Get it from:
 *   Supabase Dashboard → Settings → API → service_role (secret)
 *
 * Which stops: each county in companies.service_counties maps to its NaPTAN
 * ATCO area code (supabase/functions/_shared/naptanAreas.mjs, shared with the
 * naptan-import Edge Function; Lincolnshire = 270) and only those areas are
 * downloaded. No geocoding service or API key (OpenCage county bounding boxes
 * were removed 2026-09-29). Add counties to that field if routes expand into
 * neighbouring areas; an unknown county stops the run with how to add it.
 *
 * Bus stop types imported (rail, ferry, tram excluded):
 *   BCT  On-street Bus/Coach/Tram stop
 *   BCS  Bus/Coach Station entrance/exit
 *   BCQ  Bus/Coach Station bay
 *   BCP  Bus/Coach private stop
 *
 * Run when service_counties changes, or periodically to pick up NAPTAN updates.
 *
 * Each run's status (active/inactive/etc.) is taken from the source Status
 * field, and any previously-active stop in the covered areas (by ATCO prefix)
 * that's missing from the feed entirely (record deleted at the source, not just flagged
 * non-active) is swept to status='removed' — see markRemovedBatched().
 */

'use strict'

const https    = require('https')
const zlib     = require('zlib')
const readline = require('readline')
// Plain ES module with no imports; Node 22 require()s it directly.
const { areaCodesForCounties, naptanCsvUrl, stopFromNaptanRow, unknownCountiesMessage } =
  require('../functions/_shared/naptanAreas.mjs')

// ── Configuration ─────────────────────────────────────────────────────────────

const SUPABASE_URL  = process.env.SUPABASE_URL
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY

const BATCH_SIZE     = 500

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!SUPABASE_URL)  { console.error('ERROR: SUPABASE_URL env var is required.');         process.exit(1) }
  if (!SUPABASE_KEY)  { console.error('ERROR: SUPABASE_SERVICE_KEY env var is required.'); process.exit(1) }

  // 1. Read service counties from the companies table
  console.log('Reading service counties from database...')
  const counties = await fetchServiceCounties()
  if (!counties.length) {
    console.error('ERROR: companies.service_counties is empty — add at least one county.')
    process.exit(1)
  }
  console.log(`  Counties: ${counties.join(', ')}`)

  // 2. Counties -> NaPTAN ATCO area codes (no geocoding)
  const { codes: areaCodes, unknown } = areaCodesForCounties(counties)
  if (unknown.length) {
    console.error(`ERROR: ${unknownCountiesMessage(unknown)}`)
    process.exit(1)
  }
  console.log(`  NaPTAN areas: ${areaCodes.join(', ')}`)

  // 3. Download just those areas' NAPTAN data
  console.log('\nDownloading NAPTAN data from DfT...')
  const stops = await streamNaptanCsv(areaCodes)
  console.log(`\nFiltered to ${stops.length} bus stops (any status)`)

  if (!stops.length) {
    console.error(`No stops found for NaPTAN areas ${areaCodes.join(', ')} — check service_counties`)
    process.exit(1)
  }

  // 4. Snapshot which currently-active stops already exist in this area —
  //    used below to detect stops that have dropped out of the feed entirely
  //    (as opposed to still being present but flagged non-active, which the
  //    real Status value passed through above already covers).
  console.log('Checking for existing stops in this area...')
  const existingCodes = await fetchExistingActiveAtcoCodes(areaCodes)

  // 5. Upsert to Supabase
  console.log('Upserting to naptan_stops...')
  await upsertBatched(stops)

  // 6. Sweep: anything previously active here but absent from this run's
  //    feed has been removed from the source data — flag it so
  //    naptan_near_point() (which filters status = 'active') stops
  //    suggesting it.
  const seenCodes = new Set(stops.map(s => s.atco_code))
  const removed    = existingCodes.filter(code => !seenCodes.has(code))
  if (removed.length) {
    console.log(`Marking ${removed.length} stop(s) no longer in the feed as removed...`)
    await markRemovedBatched(removed)
  } else {
    console.log('No stops have dropped out of the feed.')
  }

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

// ── NAPTAN CSV download + parse ───────────────────────────────────────────────

function streamNaptanCsv(areaCodes) {
  return new Promise((resolve, reject) => {
    const url     = new URL(naptanCsvUrl(areaCodes))
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

        const stop = stopFromNaptanRow(row, areaCodes, new Date().toISOString())
        if (stop) stops.push(stop)
        else skipped++
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

// ── Existing-stops snapshot (for the removal sweep) ───────────────────────────

function fetchExistingActiveAtcoCodes(areaCodes) {
  const PAGE_SIZE = 1000

  function fetchPage(area, offset) {
    return new Promise((resolve, reject) => {
      const url = new URL(`${SUPABASE_URL}/rest/v1/naptan_stops`)
      url.search = [
        'select=atco_code',
        'status=eq.active',
        `atco_code=like.${area}*`,  // three-digit code, checked by naptanCsvUrl()
        'order=atco_code',
      ].join('&')

      const options = {
        hostname: url.hostname,
        path:     url.pathname + url.search,
        method:   'GET',
        headers:  {
          'apikey':        SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Range':         `${offset}-${offset + PAGE_SIZE - 1}`,
        },
      }

      const req = https.request(options, res => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          if (res.statusCode !== 200 && res.statusCode !== 206) {
            reject(new Error(`Failed to read naptan_stops (HTTP ${res.statusCode}): ${data}`))
            return
          }
          resolve(JSON.parse(data))
        })
      })
      req.on('error', reject)
      req.end()
    })
  }

  return (async () => {
    const codes = []
    for (const area of areaCodes) {
      let offset = 0
      for (;;) {
        const rows = await fetchPage(area, offset)
        codes.push(...rows.map(r => r.atco_code))
        if (rows.length < PAGE_SIZE) break
        offset += PAGE_SIZE
      }
    }
    return codes
  })()
}

async function markRemovedBatched(atcoCodes) {
  for (let i = 0; i < atcoCodes.length; i += BATCH_SIZE) {
    await markRemoved(atcoCodes.slice(i, i + BATCH_SIZE))
  }
}

function markRemoved(atcoCodes) {
  return new Promise((resolve, reject) => {
    const url  = new URL(`${SUPABASE_URL}/rest/v1/naptan_stops`)
    const list = atcoCodes.map(encodeURIComponent).join(',')
    url.search = `atco_code=in.(${list})`

    const body = JSON.stringify({ status: 'removed', updated_at: new Date().toISOString() })

    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'PATCH',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization':  `Bearer ${SUPABASE_KEY}`,
        'apikey':         SUPABASE_KEY,
        'Prefer':         'return=minimal',
      },
    }

    const req = https.request(options, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve()
        else reject(new Error(`Sweep update failed (HTTP ${res.statusCode}): ${data}`))
      })
    })
    req.on('error', reject)
    req.write(body)
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
