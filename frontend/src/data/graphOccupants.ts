import type { EvacuationGraph, EvacuationNode, EvacuationRoute, EvacuationRoutes } from '../services/api'

export type GraphOccupantStatus = 'moving' | 'evacuated' | 'trapped'

export interface GraphOccupant {
  id: string
  assignedRoomId: string
  assignedRoom: string
  currentLocationId: string
  currentLocation: string
  destinationExitId: string | null
  destinationExit: string | null
  speed: number
  route: string[]
  status: GraphOccupantStatus
  unreachableReason?: string
  distance: number
}

export interface RouteValidation {
  valid: boolean
  reason?: string
  edgeKeys: Set<string>
}

export function playbackTransition(_playing: boolean, action: 'play' | 'pause' | 'tick', occupants: GraphOccupant[]): boolean {
  if (action === 'pause') return false
  if (action === 'play') return occupants.some((occupant) => occupant.status === 'moving')
  return occupants.some((occupant) => occupant.status === 'moving')
}

export const edgeKey = (from: string, to: string) => [from, to].sort().join('::')

/** Validate backend route data against the currently loaded graph before display or motion. */
export function validateBackendRoute(graph: EvacuationGraph, route: EvacuationRoute | null | undefined, startId: string): RouteValidation {
  const edgeKeys = new Set<string>()
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]))
  if (!route) return { valid: false, reason: 'The backend found no reachable explicitly labeled exit from this room.', edgeKeys }
  if (!Array.isArray(route.path_node_ids) || route.path_node_ids.length < 2 || route.path_node_ids[0] !== startId || route.path_node_ids[route.path_node_ids.length - 1] !== route.exit_id) {
    return { valid: false, reason: 'The backend route is incomplete or does not match the selected starting room.', edgeKeys }
  }
  if (new Set(route.path_node_ids).size !== route.path_node_ids.length) return { valid: false, reason: 'The backend route repeats a node and contains a loop.', edgeKeys }
  const destination = nodes.get(route.exit_id)
  if (destination?.type !== 'exit' || !destination.label.trim() || route.exit_label.trim() !== destination.label.trim()) {
    return { valid: false, reason: 'The route destination is not an explicitly labeled exit in the current graph.', edgeKeys }
  }
  if (!Number.isFinite(route.path_length) || route.path_length < 0) return { valid: false, reason: 'The backend route has an invalid estimated path length.', edgeKeys }
  let measuredLength = 0
  for (let index = 0; index < route.path_node_ids.length; index += 1) {
    const node = nodes.get(route.path_node_ids[index])
    if (!node) return { valid: false, reason: 'The route references a node missing from the current graph.', edgeKeys }
    if (!node.bbox) return { valid: false, reason: `The route geometry for ${node.label} is unavailable.`, edgeKeys }
    if (node.status === 'dangerous' || node.status === 'blocked') return { valid: false, reason: `The route is blocked by ${node.label} (${node.status}).`, edgeKeys }
    if (index === route.path_node_ids.length - 1) continue
    const nextId = route.path_node_ids[index + 1]
    const edge = graph.edges.find((candidate) => (candidate.from === node.id && candidate.to === nextId) || (candidate.to === node.id && candidate.from === nextId))
    if (!edge) return { valid: false, reason: `The reviewed graph is missing the connection from ${node.label} to ${nodes.get(nextId)?.label ?? nextId}.`, edgeKeys }
    if (!Number.isFinite(edge.length) || edge.length <= 0) return { valid: false, reason: `The graph connection from ${node.label} has invalid movement geometry.`, edgeKeys }
    if (edge.blocked) return { valid: false, reason: `The graph connection from ${node.label} to ${nodes.get(nextId)?.label ?? nextId} is blocked.`, edgeKeys }
    measuredLength += edge.length
    edgeKeys.add(edgeKey(node.id, nextId))
  }
  if (Math.abs(measuredLength - route.path_length) > .001) return { valid: false, reason: 'The backend route length does not match the lengths of its graph edges.', edgeKeys }
  return { valid: true, edgeKeys }
}

export function backendRouteEdgeKeys(graph: EvacuationGraph, route: EvacuationRoute | null | undefined, startId: string): Set<string> {
  const checked = validateBackendRoute(graph, route, startId)
  return checked.valid ? checked.edgeKeys : new Set()
}

/** Reachable exits for this exact start node, checked against the current graph before selection. */
export function validatedRoutesForStart(graph: EvacuationGraph, routes: EvacuationRoutes | null | undefined, startId: string): EvacuationRoute[] {
  if (!routes || routes.start_node_id !== startId) return []
  return [routes.nearest_exit, ...routes.alternate_exits].filter((route): route is EvacuationRoute => Boolean(route && validateBackendRoute(graph, route, startId).valid))
}

export function createGraphOccupants(graph: EvacuationGraph, roomId: string, count: number, route: EvacuationRoute | null | undefined): GraphOccupant[] {
  const room = graph.nodes.find((node) => node.id === roomId && node.type === 'room')
  if (!room) return []
  const validation = validateBackendRoute(graph, route, roomId)
  const assignedRoute = validation.valid ? route!.path_node_ids : [room.id]
  return Array.from({ length: Math.max(0, Math.min(500, Math.floor(count))) }, (_, index) => {
    // Plan coordinates are normalized to the source image. This range makes a
    // quarter-second UI tick visibly move the marker while remaining an estimate.
    const speed = Number((0.04 + ((index * 37) % 19) / 1000).toFixed(3))
    return {
      id: `EX-${String(index + 1).padStart(4, '0')}`,
      assignedRoomId: room.id,
      assignedRoom: room.label,
      currentLocationId: room.id,
      currentLocation: room.label,
      destinationExitId: validation.valid ? route!.exit_id : null,
      destinationExit: validation.valid ? route!.exit_label : null,
      speed,
      route: assignedRoute,
      status: validation.valid ? 'moving' as const : 'trapped' as const,
      unreachableReason: validation.valid ? undefined : validation.reason,
      distance: 0,
    }
  })
}

export function advanceOccupants(occupants: GraphOccupant[], graph: EvacuationGraph, seconds: number): GraphOccupant[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]))
  return occupants.map((occupant) => {
    if (occupant.status !== 'moving') return occupant
    const path = occupant.route
    const currentIndex = path.indexOf(occupant.currentLocationId)
    if (currentIndex < 0 || currentIndex >= path.length - 1) return { ...occupant, status: 'trapped', unreachableReason: 'The current location is not connected to the remaining route.' }
    const validation = validateBackendRoute(graph, {
      exit_id: occupant.destinationExitId ?? '',
      exit_label: occupant.destinationExit ?? '',
      path_node_ids: path.slice(currentIndex),
      path_length: path.slice(currentIndex, -1).reduce((sum, from, index) => {
        const to = path[currentIndex + index + 1]
        const edge = graph.edges.find((candidate) => (candidate.from === from && candidate.to === to) || (candidate.to === from && candidate.from === to))
        return sum + (edge?.length ?? 0)
      }, 0),
    }, occupant.currentLocationId)
    if (!validation.valid) return { ...occupant, status: 'trapped', unreachableReason: validation.reason }

    let distance = occupant.distance + occupant.speed * Math.max(0, seconds)
    let routeIndex = currentIndex
    while (routeIndex < path.length - 1) {
      const from = path[routeIndex]
      const to = path[routeIndex + 1]
      const edge = graph.edges.find((candidate) => (candidate.from === from && candidate.to === to) || (candidate.to === from && candidate.from === to))
      if (!edge || edge.blocked || nodes.get(to)?.status === 'dangerous' || nodes.get(to)?.status === 'blocked') {
        return { ...occupant, status: 'trapped', unreachableReason: `Movement stopped because the connection to ${nodes.get(to)?.label ?? to} is blocked.` }
      }
      if (distance < edge.length) break
      distance -= edge.length
      routeIndex += 1
    }
    const currentLocationId = path[Math.min(routeIndex, path.length - 1)]
    const currentNode = nodes.get(currentLocationId)
    const status = currentNode?.type === 'exit' && currentLocationId === occupant.destinationExitId ? 'evacuated' : 'moving'
    return { ...occupant, currentLocationId, currentLocation: currentNode?.label ?? currentLocationId, distance, status }
  })
}

export function occupantPosition(occupant: GraphOccupant, graph: EvacuationGraph, nodesById = new Map(graph.nodes.map((node) => [node.id, node]))): [number, number] {
  const from = nodesById.get(occupant.currentLocationId) ?? nodesById.get(occupant.route[0])
  const to = nodesById.get(occupant.route[occupant.route.indexOf(occupant.currentLocationId) + 1])
  if (!from?.bbox) return [0, 0]
  const center = (node: EvacuationNode) => [node.bbox!.x + node.bbox!.width / 2, node.bbox!.y + node.bbox!.height / 2] as [number, number]
  if (!to?.bbox) return center(from)
  const start = center(from)
  const end = center(to)
  const edge = graph.edges.find((item) => (item.from === from.id && item.to === to.id) || (item.to === from.id && item.from === to.id))
  const progress = Math.max(0, Math.min(1, occupant.distance / Math.max(edge?.length ?? 0, 0.0001)))
  return [start[0] + (end[0] - start[0]) * progress, start[1] + (end[1] - start[1]) * progress]
}
