const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const { company_number } = await req.json()
  if (!company_number?.trim()) {
    return new Response(
      JSON.stringify({ error: 'company_number is required' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }

  const key = Deno.env.get('COMPANIES_HOUSE_API_KEY') ?? ''
  const res = await fetch(
    `https://api.companieshouse.gov.uk/company/${company_number.trim().toUpperCase()}`,
    { headers: { Authorization: `Basic ${btoa(key + ':')}` } }
  )

  if (!res.ok) {
    const msg = res.status === 404 ? 'Company not found' : 'Companies House unavailable'
    return new Response(
      JSON.stringify({ error: msg }),
      { status: res.status, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }

  const d = await res.json()
  const addr = d.registered_office_address ?? {}

  return new Response(
    JSON.stringify({
      company_name:  d.company_name ?? '',
      company_number: d.company_number ?? '',
      address_line_1: addr.address_line_1 ?? '',
      address_line_2: addr.address_line_2 ?? '',
      city:           addr.locality ?? '',
      postcode:       addr.postal_code ?? '',
    }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } }
  )
})
