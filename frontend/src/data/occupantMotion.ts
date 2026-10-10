import type { SimulationResponse } from '../services/api'
import { fireOriginForLocation, pointForZone, pointAlongRoute, routePointsToExit, type MapPoint } from './routeGeometry'

export interface OccupantAgent {
  id: number
  start: MapPoint
  exit: string
  points: MapPoint[]
  trapped: boolean
  weight: number
}

export function createOccupantAgents(result: SimulationResponse, fireLocation: string, totalOccupants: number): OccupantAgent[] {
  const count = Math.min(72, Math.max(0, totalOccupants))
  const zoneWeights = result.zones.map((zone) => Math.max(0, zone.estimated_occupants))
  const totalZoneWeight = zoneWeights.reduce((sum, value) => sum + value, 0)
  const zones = result.zones.length ? result.zones : [{ zone: fireLocation, estimated_occupants: totalOccupants, status: 'safe' as const, risk_level: 'low' as const }]
  const exits = result.safe_exits.length ? result.safe_exits : ['No safe exit']
  const agents = Array.from({ length: count }, (_, id) => {
    const zoneIndex = totalZoneWeight > 0 ? Math.min(zones.length - 1, Math.floor((id / count) * zones.length)) : 0
    const zone = zones[zoneIndex]
    const anchor = pointForZone(zone.zone, fireLocation)
    const column = id % 6
    const row = Math.floor(id / 6) % 6
    const start = { x: anchor.x + (column - 2.5) * 5, y: anchor.y + (row - 2.5) * 5 }
    const exit = exits.reduce((nearest, candidate) => {
      const destination = /(?:stairwell|stair)\s*a|exit\s*a/i.test(candidate) ? { x: 74, y: 342 } : { x: 616, y: 342 }
      const currentDestination = /(?:stairwell|stair)\s*a|exit\s*a/i.test(nearest) ? { x: 74, y: 342 } : { x: 616, y: 342 }
      return Math.hypot(start.x - destination.x, start.y - destination.y) < Math.hypot(start.x - currentDestination.x, start.y - currentDestination.y) ? candidate : nearest
    }, exits[0])
    return { id, start, exit, points: routePointsToExit(start, exit), trapped: false, weight: totalOccupants / count }
  })
  const trappedCount = Math.min(count, Math.round((result.people_trapped / Math.max(1, totalOccupants)) * count))
  const hazard = fireOriginForLocation(fireLocation)
  agents.sort((a, b) => Math.hypot(a.start.x - hazard.x, a.start.y - hazard.y) - Math.hypot(b.start.x - hazard.x, b.start.y - hazard.y))
  agents.forEach((agent, index) => { agent.trapped = index < trappedCount })
  return agents
}

export function positionForOccupant(agent: OccupantAgent, progress: number, congestionZones: string[], blockedAt?: number): MapPoint {
  if (agent.trapped) return agent.start
  const cap = blockedAt === undefined ? progress : Math.min(progress, blockedAt)
  const slowSegments = congestionZones.length ? [1, 2] : []
  return pointAlongRoute(agent.points, cap, slowSegments)
}
