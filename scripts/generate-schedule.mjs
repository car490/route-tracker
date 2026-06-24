import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const SUPABASE_URL = 'https://nwhayupsvcelyiwltdqo.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im53aGF5dXBzdmNlbHlpd2x0ZHFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MTAwNDAsImV4cCI6MjA5MzQ4NjA0MH0.ddwZpPE5WHOTXd3gAFhxwAbh2C6IUoftz6jsOspyBAo'

const url =
  `${SUPABASE_URL}/rest/v1/schedule_view` +
  `?select=timetable_stop_id,stop_type,scheduled_time,display_name,lat,lon,service_code,timetable_name,direction,departure_id,departure_time,sequence` +
  `&order=service_code,departure_time,sequence`

const res = await fetch(url, {
  headers: {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  },
})

if (!res.ok) {
  console.error('Supabase error:', res.status, await res.text())
  process.exit(1)
}

const rows = await res.json()
console.log(`Fetched ${rows.length} rows from schedule_view`)

const schedule = {}
for (const { service_code, timetable_name, direction, departure_id, departure_time, display_name, lat, lon, scheduled_time, stop_type, timetable_stop_id } of rows) {
  if (!schedule[service_code]) schedule[service_code] = {}
  if (!schedule[service_code][departure_id]) {
    const deptStr = departure_time ? departure_time.substring(0, 5) : ''
    schedule[service_code][departure_id] = {
      service: service_code,
      label: `${timetable_name} ${direction} ${deptStr}`,
      departure_time: deptStr,
      stops: [],
    }
  }
  schedule[service_code][departure_id].stops.push({
    name: display_name,
    lat,
    lon,
    time: scheduled_time ? scheduled_time.substring(0, 5) : '',
    stop_type,
    timetable_stop_id,
  })
}

const __dir = dirname(fileURLToPath(import.meta.url))
const srcPath = join(__dir, '..', 'src', 'schedule.json')

const json = JSON.stringify(schedule, null, 2)
writeFileSync(srcPath, json)

const services = Object.keys(schedule)
const totalDeps = services.reduce((n, s) => n + Object.keys(schedule[s]).length, 0)
console.log(`Written src/schedule.json — ${services.length} services, ${totalDeps} departures`)
services.forEach(s => {
  const deps = Object.values(schedule[s])
  deps.forEach(d => console.log(`  ${s}  ${d.departure_time}  ${d.label}  (${d.stops.length} stops)`))
})
