import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

export function useJourneyTypes() {
  const [journeyTypes, setJourneyTypes] = useState([])
  const [bodsTypes,    setBodsTypes]    = useState(new Set())
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    supabase
      .from('journey_types')
      .select('name, requires_bods')
      .order('sort_order')
      .then(({ data }) => {
        const rows = data ?? []
        setJourneyTypes(rows.map(r => r.name))
        setBodsTypes(new Set(rows.filter(r => r.requires_bods).map(r => r.name)))
        setLoading(false)
      })
  }, [])
  return { journeyTypes, bodsTypes, loading }
}
