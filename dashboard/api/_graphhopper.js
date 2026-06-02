export function buildGHBody(coordinates, vehicle) {
  const priority = [{ if: 'true', multiply_by: '1' }]
  if (vehicle?.height) priority.push({ if: `max_height < ${vehicle.height} && max_height > 0`, multiply_by: '0' })
  if (vehicle?.width)  priority.push({ if: `max_width  < ${vehicle.width}  && max_width  > 0`, multiply_by: '0' })
  if (vehicle?.length) priority.push({ if: `max_length < ${vehicle.length} && max_length > 0`, multiply_by: '0' })

  return {
    points: coordinates,
    profile: 'pcv',
    custom_model: { priority },
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
