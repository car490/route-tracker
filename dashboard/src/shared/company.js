import { supabase } from './supabase'

let _company = null

async function getCompany() {
  if (_company) return _company
  const { data } = await supabase.from('companies').select('id, name, lat, lon').limit(1).single()
  _company = data ?? null
  return _company
}

export async function getCompanyId()   { return (await getCompany())?.id   ?? null }
export async function getCompanyName() { return (await getCompany())?.name ?? null }

// Call after any write to companies (e.g. Company Settings save) so the next
// read picks up fresh data instead of the cached row from this session.
export function invalidateCompanyCache() { _company = null }

// HQ coordinates (companies.lat/lon), for centering the route planner map. Null if unset.
export async function getCompanyLocation() {
  const company = await getCompany()
  if (company?.lat == null || company?.lon == null) return null
  return { lat: company.lat, lon: company.lon }
}
