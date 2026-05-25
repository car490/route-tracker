import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

export function useCurrentEmployee(userId) {
  const [employee, setEmployee] = useState(null)

  useEffect(() => {
    if (!userId) return
    supabase
      .from('employees')
      .select('role, company_id, companies(name, logo_path)')
      .eq('auth_user_id', userId)
      .single()
      .then(({ data }) => setEmployee(data))
  }, [userId])

  return employee
}
