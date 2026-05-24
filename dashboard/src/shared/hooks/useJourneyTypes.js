import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

export function useJourneyTypes() {
  const [journeyTypes, setJourneyTypes] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    supabase
      .from('journey_types')
      .select('name')
      .order('sort_order')
      .then(({ data }) => {
        setJourneyTypes((data ?? []).map(r => r.name))
        setLoading(false)
      })
  }, [])
  return { journeyTypes, loading }
}
