import { supabase } from './supabase'

let _companyId = null

export async function getCompanyId() {
  if (_companyId) return _companyId
  const { data } = await supabase.from('companies').select('id').limit(1).single()
  _companyId = data?.id ?? null
  return _companyId
}
