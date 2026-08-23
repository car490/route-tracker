// PCV operational speeds (km/h): motorway/dual 60 mph, A/B-road 30 mph, minor/urban 20 mph
const PCV_SPEED_RULES = [
  { if: 'road_class == MOTORWAY || road_class == TRUNK',     limit_to: 97 },
  { if: 'road_class == PRIMARY  || road_class == SECONDARY',  limit_to: 48 },
  { if: 'true',                                               limit_to: 32 },
]

export function buildGHBody(coordinates, vehicle, profile = 'pcv') {
  const priority = [{ if: 'true', multiply_by: '1' }]
  if (vehicle?.height) priority.push({ if: `max_height < ${vehicle.height} && max_height > 0`, multiply_by: '0' })
  if (vehicle?.width)  priority.push({ if: `max_width  < ${vehicle.width}  && max_width  > 0`, multiply_by: '0' })
  if (vehicle?.length) priority.push({ if: `max_length < ${vehicle.length} && max_length > 0`, multiply_by: '0' })

  return {
    points: coordinates,
    profile,
    points_encoded: false,
    instructions: false,
  }
}

export function normaliseGHResponse(data) {
  const path = data?.paths?.[0]
  if (!path) return { features: [] }
  return {
    features: [{
      geometry: path.points,
      properties: {
        summary: {
          distance: path.distance,
          duration: Math.round(path.time / 1000),
        },
        warnings: [],
      },
    }],
  }
}
