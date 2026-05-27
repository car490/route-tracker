import { parse as parseCsv } from "https://deno.land/std@0.224.0/csv/parse.ts"

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

  const res = await fetch(VOL_URL)
  if (!res.ok) return json({ error: 'Failed to fetch DVSA dataset' }, 502)

  const rows = parseCsv(await res.text())
  if (rows.length < 2) return json({ error: 'Unexpected empty dataset' }, 502)

  const headers = rows[0]
  const licenceIdx = headers.indexOf('LicenceNumber')
  if (licenceIdx === -1) return json({ error: 'Unexpected CSV format' }, 502)

  const target   = licence_number.trim().toUpperCase()
  const matchRow = rows.slice(1).find(row => row[licenceIdx]?.toUpperCase() === target)
  if (!matchRow) return json({ error: 'Licence number not found in DVSA dataset' }, 404)

  const col = (name: string) => matchRow[headers.indexOf(name)] ?? ''

  return json({
    trading_name:           col('TradingName'),
    licence_number:         col('LicenceNumber'),
    licence_status:         col('LicenceStatus'),
    correspondence_address: col('CorrespondenceAddress'),
  })
})
