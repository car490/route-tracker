export const TYPE_DEFAULTS = {
  'Minibus':           { height_metres: 2.85, width_metres: 2.20, length_metres:  8.00 },
  'Midi Coach':        { height_metres: 3.20, width_metres: 2.40, length_metres: 10.00 },
  'Full Size Coach':   { height_metres: 3.70, width_metres: 2.55, length_metres: 13.75 },
  'Single Decker Bus': { height_metres: 3.15, width_metres: 2.55, length_metres: 12.00 },
  'Double Decker':     { height_metres: 4.35, width_metres: 2.55, length_metres: 11.00 },
}

export const DIRECTIONS = ['Outbound', 'Inbound', 'Circular']
export const DAYS       = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const DEP_EMPTY  = { departure_time: '', days_of_week: [1,2,3,4,5], timing_profile: 'standard', vehicle_journey_code: '' }

export const S = {
  sectionLabel: {
    fontFamily: 'Oswald', fontWeight: 700, fontSize: 10,
    textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)',
  },
}
