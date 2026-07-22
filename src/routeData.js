// Static lookup: {service, variant} -> timetable_departure_id, for the
// manual service-selection fallback (src/manualSelection.js). Not stop
// data — stops stay single-sourced from schedule_view via
// fetchStopsForDeparture(), same as the duty-card path.
//
// Plain JS module rather than a .json file: this ships to the browser as
// a native ES module (index.html loads main.js with type="module", no
// bundler), and native `import x from './x.json'` requires import
// attributes that aren't reliably supported across the driver tablets
// this app targets.
//
// IDs verified against both dev (cgcbfgceputvdvhzrgio) and production
// (nwhayupsvcelyiwltdqo) Supabase — routes/timetables/timetable_departures
// for these two services are seeded with matching fixed UUIDs in both.

export const routeData = {
  S116S: {
    'Morning Outbound': '6414c87f-45e6-49b7-aa9d-79f989257aeb',
    'Afternoon Inbound': 'd421ed53-80ed-4a1a-a5ed-59d4e8050e9c',
  },
  S125S: {
    'Morning Outbound': '338aebc6-8b5e-4a86-acad-a56bcf7a123b',
    'Afternoon Inbound': '192195c8-3d88-42ba-9a7d-a4a7136a3cd2',
  },
};
