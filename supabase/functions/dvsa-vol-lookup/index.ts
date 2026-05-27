import Papa from "npm:papaparse"

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const CKAN_API =
  'https://data.gov.uk/api/3/action/package_show?id=2a67d1ee-8f1b-43a3-8bc6-e8772d162a3c'

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; RouteTracker/1.0)' }

// Maps our schema traffic_area values to a keyword found in the CKAN resource name
const AREA_KEYWORDS: Record<string, string> = {
  'Northern':                       'north east',
  'North Western':                  'north west',
  'West Midlands':                  'west midlands',
  'Eastern':                        'east of england',
  'Welsh':                          'wales',
  'Western':                        'west of england',
  'South Eastern and Metropolitan': 'south east',
  'East Midlands':                  'east midlands',
  'Scottish':                       'scotland',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const { licence_number, traffic_area } = await req.json()
  if (!licence_number?.trim()) return json({ error: 'licence_number is required' }, 400)
  if (!traffic_area)           return json({ error: 'traffic_area is required' }, 400)

  const keyword = AREA_KEYWORDS[traffic_area as string]
  if (!keyword) return json({ error: `Unknown traffic area: ${traffic_area}` }, 400)

  // Get current resource list from CKAN
  const apiRes = await fetch(CKAN_API, { headers: HEADERS })
  if (!apiRes.ok) return json({ error: `CKAN API error: HTTP ${apiRes.status}` }, 502)

  const resources: Array<{ url: string; name: string; format: string }> =
    (await apiRes.json())?.result?.resources ?? []

  // Find the single CSV resource for this traffic area
  const resource = resources.find(
    r => (r.format?.toUpperCase() === 'CSV' || r.url?.toLowerCase().endsWith('.csv'))
      && r.name?.toLowerCase().includes(keyword)
  )

  if (!resource) return json({ error: `No dataset found for traffic area: ${traffic_area}` }, 404)

  // Fetch and search just that one file
  const csvRes = await fetch(resource.url, { headers: HEADERS })
  if (!csvRes.ok) return json({ error: `Failed to fetch dataset: HTTP ${csvRes.status}` }, 502)

  const { data } = Papa.parse<Record<string, string>>(await csvRes.text(), {
    header: true,
    skipEmptyLines: true,
  })

  const target = licence_number.trim().toUpperCase()
  const match  = data.find(row => row['LicenceNumber']?.toUpperCase() === target)

  if (!match) return json({ error: 'Licence number not found in DVSA dataset' }, 404)

  return json({
    trading_name:           match['TradingName']           ?? '',
    licence_number:         match['LicenceNumber']         ?? '',
    licence_status:         match['LicenceStatus']         ?? '',
    correspondence_address: match['CorrespondenceAddress'] ?? '',
  })
})
