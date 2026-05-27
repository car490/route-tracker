import Papa from "npm:papaparse"

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const CKAN_API =
  'https://data.gov.uk/api/3/action/package_show?id=2a67d1ee-8f1b-43a3-8bc6-e8772d162a3c'

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; RouteTracker/1.0)' }

// Valid traffic areas — must match DVSA file names exactly (case-insensitive)
const VALID_AREAS = new Set([
  'North East of England',
  'North West of England',
  'East of England',
  'West Midlands',
  'West of England',
  'London and the South East of England',
  'Wales',
  'Scotland',
])

// Always return 200 so supabase-js parses the body — errors are signalled
// via { error: '...' } in the JSON, not via HTTP status codes.
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const { licence_number, traffic_area } = await req.json()
  if (!licence_number?.trim()) return json({ error: 'licence_number is required' })
  if (!traffic_area)           return json({ error: 'traffic_area is required' })

  if (!VALID_AREAS.has(traffic_area as string))
    return json({ error: `Unknown traffic area: ${traffic_area}` })

  // Get current resource list from CKAN
  const apiRes = await fetch(CKAN_API, { headers: HEADERS })
  if (!apiRes.ok) return json({ error: `CKAN API error: HTTP ${apiRes.status}` })

  const resources: Array<{ url: string; name: string; format: string }> =
    (await apiRes.json())?.result?.resources ?? []

  const keyword = (traffic_area as string).toLowerCase()

  // Find the single CSV resource for this traffic area
  const resource = resources.find(
    r => (r.format?.toUpperCase() === 'CSV' || r.url?.toLowerCase().endsWith('.csv'))
      && r.name?.toLowerCase().includes(keyword)
  )

  if (!resource) return json({ error: `No dataset found for traffic area: ${traffic_area}` })

  // Fetch and search just that one file
  const csvRes = await fetch(resource.url, { headers: HEADERS })
  if (!csvRes.ok) return json({ error: `Failed to fetch dataset: HTTP ${csvRes.status}` })

  const { data } = Papa.parse<Record<string, string>>(await csvRes.text(), {
    header: true,
    skipEmptyLines: true,
  })

  const target = licence_number.trim().toUpperCase()
  const match  = data.find(row => row['LicenceNumber']?.toUpperCase() === target)

  if (!match) return json({ error: 'Licence number not found in DVSA dataset' })

  return json({
    operator_name:                match['OperatorName']               ?? '',
    licence_number:               match['LicenceNumber']              ?? '',
    licence_status:               match['LicenceStatus']              ?? '',
    correspondence_address:       match['CorrespondenceAddress']      ?? '',
    geographic_region:            match['GeographicRegion']           ?? '',
    number_of_vehicles_authorised: match['NumberOfVehiclesAuthorised'] ?? '',
  })
})
