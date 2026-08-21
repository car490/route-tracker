import { useEffect, useState } from 'react'
import { supabase } from '../../shared/supabase'

export function TimetableStopCount({ timetableId }) {
  const [count, setCount] = useState('…')
  useEffect(() => {
    supabase
      .from('timetable_stops')
      .select('id', { count: 'exact', head: true })
      .eq('timetable_id', timetableId)
      .then(({ count: c }) => setCount(c ?? 0))
  }, [timetableId])
  return <span className="badge badge-gray">{count} stops</span>
}
