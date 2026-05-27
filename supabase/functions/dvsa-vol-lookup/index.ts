import Papa from "npm:papaparse"

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const CKAN_API =
  'https://data.gov.uk/api/3/action/package_show?id=2a67d1ee-8f1b-43a3-8bc6-e8772d162a3c'

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; RouteTracker/1.0)' }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

async function searchCsv(url: string, target: string): Promise<Record<string, string> | null> {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) return null
  const { data } = Papa.parse<Record<string, string>>(await res.text(), {
    header: true,
    skipEmptyLines: true,
  })
  return data.find(row => row['LicenceNumber']?.toUpperCase() === target) ?? null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const { licence_number } = await req.json()
  if (!licence_number?.trim()) return json({ error: 'licence_number is required' }, 400)

  // Step 1: get current resource URLs from CKAN API
  const apiRes = await fetch(CKAN_API, { headers: HEADERS })
  if (!apiRes.ok) return json({ error: `CKAN API error: HTTP ${apiRes.status}` }, 502)

  const apiData = await apiRes.json()
  const resources: Array<{ url: string; format: string; name: string }> =
    apiData?.result?.resources ?? []

  const csvUrls = resources
    .filter(r => r.format?.toUpperCase() === 'CSV' || r.url?.toLowerCase().endsWith('.csv'))
    .map(r => r.url)

  if (csvUrls.length === 0) return json({ error: 'No CSV resources found in dataset' }, 502)

  // Step 2: search all area files in parallel — return first match
  const target = licence_number.trim().toUpperCase()
  const searches = await Promise.allSettled(csvUrls.map(url => searchCsv(url, target)))

  const match = searches
    .filter((r): r is PromiseFulfilledResult<Record<string, string> | null> => r.status === 'fulfilled')
    .map(r => r.value)
    .find(Boolean)

  if (!match) return json({ error: 'Licence number not found in DVSA dataset' }, 404)

  return json({
    trading_name:           match['TradingName']           ?? '',
    licence_number:         match['LicenceNumber']         ?? '',
    licence_status:         match['LicenceStatus']         ?? '',
    correspondence_address: match['CorrespondenceAddress'] ?? '',
  })
})
