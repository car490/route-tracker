import { supabase } from './supabase'

let _company = null

async function getCompany() {
  if (_company) return _company
  const { data } = await supabase.from('companies').select('id, name').limit(1).single()
  _company = data ?? null
  return _company
}

export async function getCompanyId()   { return (await getCompany())?.id   ?? null }
export async function getCompanyName() { return (await getCompany())?.name ?? null }
