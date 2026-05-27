import Papa from "npm:papaparse"

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const VOL_URL =
  'https://assets.publishing.service.gov.uk/media/65f1e3e68a2f410012b1e3e8/vol-public-service-vehicle-operator-licences.csv'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const { licence_number } = await req.json()
  if (!licence_number?.trim()) return json({ error: 'licence_number is required' }, 400)

  let res: Response
  try {
    res = await fetch(VOL_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RouteTracker/1.0)' },
    })
  } catch (e) {
    return json({ error: `Network error fetching DVSA dataset: ${e}` }, 502)
  }
  if (!res.ok) return json({ error: `DVSA dataset fetch failed: HTTP ${res.status}` }, 502)

  const csv = await res.text()
  const { data } = Papa.parse<Record<string, string>>(csv, {
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
