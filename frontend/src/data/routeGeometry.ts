export interface MapPoint {
  x: number
  y: number
}

export interface EvacuationRoute {
  exit: string
  path: string
  points: MapPoint[]
  distanceMeters: number
}

export function routePointsToExit(origin: MapPoint, exit: string): MapPoint[] {
  const corridorEntryY = origin.y < 154 ? 154 : origin.y > 215 ? 215 : 184
  const exitIsA = /(?:stairwell|stair)\s*a|exit\s*a/i.test(exit)
  const exitX = exitIsA ? 74 : 616
  return [origin, { x: origin.x, y: corridorEntryY }, { x: exitX, y: corridorEntryY }, { x: exitX, y: 184 }, { x: exitX, y: 342 }]
}

export function pointAlongRoute(points: MapPoint[], progress: number, slowSegments: number[] = []): MapPoint {
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 }
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y) * (slowSegments.includes(index) ? 2.4 : 1))
  const total = lengths.reduce((sum, length) => sum + length, 0)
  let remaining = Math.max(0, Math.min(1, progress)) * total
  for (let index = 0; index < lengths.length; index += 1) {
    const segmentLength = lengths[index]
    if (remaining <= segmentLength || index === lengths.length - 1) {
      const ratio = segmentLength === 0 ? 1 : remaining / segmentLength
      return { x: points[index].x + (points[index + 1].x - points[index].x) * ratio, y: points[index].y + (points[index + 1].y - points[index].y) * ratio }
    }
    remaining -= segmentLength
  }
  return points[points.length - 1]
}

export function fireOriginForLocation(location: string): MapPoint {
  const normalized = location.toLowerCase()
  if (normalized.includes('corridor') || normalized.includes('lobby')) return { x: 350, y: 184 }
  if (normalized.includes('stairwell a') || normalized.includes('stair a') || normalized.includes('west exit') || normalized.includes('west stairwell')) return { x: 68, y: 184 }
  if (normalized.includes('stairwell b') || normalized.includes('stair b') || normalized.includes('east exit') || normalized.includes('east stairwell')) return { x: 629, y: 184 }
  if (normalized.includes('office')) return { x: 350, y: 252 }
  return { x: 490, y: 54 }
}

export function pointForZone(zoneName: string, fireLocation: string): MapPoint {
  if (zoneName.toLowerCase() === fireLocation.toLowerCase()) return fireOriginForLocation(fireLocation)
  const normalized = zoneName.toLowerCase()
  if (normalized.includes('corridor')) return { x: 350, y: 184 }
  if (normalized.includes('east stairwell')) return { x: 629, y: 184 }
  if (normalized.includes('west stairwell')) return { x: 68, y: 184 }
  if (normalized.includes('office area')) return { x: 350, y: 252 }
  return { x: 490, y: 54 }
}

export function buildEvacuationRoutes(fireLocation: string, safeExits: string[]): EvacuationRoute[] {
  const origin = fireOriginForLocation(fireLocation)
  return safeExits.map((exit) => {
    const points = routePointsToExit(origin, exit)
    const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
    const lengthInPlanUnits = points.slice(1).reduce((distance, point, index) => {
      const previous = points[index]
      return distance + Math.hypot(point.x - previous.x, point.y - previous.y)
    }, 0)

    // The mock floor plan is approximately 0.06 metres per drawing unit.
    return { exit, path, points, distanceMeters: Math.max(1, Math.round(lengthInPlanUnits * 0.06)) }
  })
}
