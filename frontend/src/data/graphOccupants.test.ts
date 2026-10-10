import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EvacuationGraph, EvacuationRoute } from '../services/api'
import { advanceOccupants, backendRouteEdgeKeys, createGraphOccupants, playbackTransition, validatedRoutesForStart, validateBackendRoute } from './graphOccupants'
import { getEvacuationRoute } from '../services/api'

const graph: EvacuationGraph = {
  nodes: [
    { id: 'room', type: 'room', label: 'Reception', bbox: { x: 0, y: 0, width: .1, height: .1 }, confidence: 1, status: 'unverified' },
    { id: 'door', type: 'door', label: 'Reviewed door', bbox: { x: .1, y: 0, width: .02, height: .02 }, confidence: 1, status: 'unverified' },
    { id: 'corridor', type: 'corridor', label: 'Main corridor', bbox: { x: .2, y: 0, width: .1, height: .1 }, confidence: 1, status: 'unverified' },
    { id: 'exit', type: 'exit', label: 'EXIT A', bbox: { x: .4, y: 0, width: .02, height: .02 }, confidence: 1, status: 'unverified' },
  ],
  edges: [
    { from: 'room', to: 'door', relation: 'reviewed-passage', length: .1, confidence: 1, blocked: false },
    { from: 'door', to: 'corridor', relation: 'reviewed-passage', length: .1, confidence: 1, blocked: false },
    { from: 'corridor', to: 'exit', relation: 'labeled-exit', length: .1, confidence: 1, blocked: false },
  ],
  adjacency: {},
}
const route: EvacuationRoute = { exit_id: 'exit', exit_label: 'EXIT A', path_node_ids: ['room', 'door', 'corridor', 'exit'], path_length: .3 }
const persistedOfficePath = ['gemini-0-0-1', 'door-reception', 'gemini-0-0-5', 'door-stair-upper', 'gemini-0-0-15', 'door-west-exit', 'gemini-0-0-17']
const persistedOfficeGraph: EvacuationGraph = {
  nodes: [
    { id: persistedOfficePath[0], type: 'room', label: 'RECEPTION', bbox: { x: .091, y: .166, width: .19, height: .188 }, confidence: 1, status: 'safe' },
    { id: persistedOfficePath[1], type: 'door', label: 'DOOR — RECEPTION TO MAIN CORRIDOR B', bbox: { x: .16, y: .345, width: .012, height: .014 }, confidence: 1, status: 'safe' },
    { id: persistedOfficePath[2], type: 'corridor', label: 'MAIN CORRIDOR B', bbox: { x: .062, y: .354, width: .875, height: .041 }, confidence: 1, status: 'safe' },
    { id: persistedOfficePath[3], type: 'door', label: 'DOOR — MAIN CORRIDOR B TO STAIR A', bbox: { x: .105, y: .385, width: .012, height: .04 }, confidence: 1, status: 'safe' },
    { id: persistedOfficePath[4], type: 'stairs', label: 'STAIR A', bbox: { x: .071, y: .414, width: .074, height: .157 }, confidence: 1, status: 'safe' },
    { id: persistedOfficePath[5], type: 'door', label: 'DOOR — STAIR A TO EXIT E2 WEST', bbox: { x: .063, y: .49, width: .012, height: .012 }, confidence: 1, status: 'safe' },
    { id: persistedOfficePath[6], type: 'exit', label: 'EXIT E2 — WEST', bbox: { x: .06, y: .482, width: .006, height: .028 }, confidence: 1, status: 'safe' },
  ],
  edges: [.09415, .33426, .3897, .08755, .03916, .006].map((length, index) => ({ from: persistedOfficePath[index], to: persistedOfficePath[index + 1], length, confidence: 1, relation: 'reviewed-passage', blocked: false })),
  adjacency: {},
}
const persistedOfficeRoute: EvacuationRoute = { exit_id: persistedOfficePath[6], exit_label: 'EXIT E2 — WEST', path_node_ids: persistedOfficePath, path_length: .95082 }

afterEach(() => vi.unstubAllGlobals())

describe('backend graph route visualization and occupants', () => {
  it('returns only route line segments backed by graph edges', () => {
    expect([...backendRouteEdgeKeys(graph, route, 'room')]).toEqual(['door::room', 'corridor::door', 'corridor::exit'])
    const incomplete = { ...graph, edges: graph.edges.slice(0, 2) }
    expect(backendRouteEdgeKeys(incomplete, route, 'room').size).toBe(0)
    expect(validateBackendRoute(incomplete, route, 'room').reason).toContain('missing the connection')
  })

  it('rejects a route containing a repeated node even when each edge exists', () => {
    const looped = { ...route, path_node_ids: ['room', 'door', 'room', 'door', 'corridor', 'exit'], path_length: .5 }
    expect(validateBackendRoute(graph, looped, 'room')).toMatchObject({ valid: false })
    expect(validateBackendRoute(graph, looped, 'room').reason).toContain('loop')
  })

  it('assigns a reachable occupant to a real labeled exit and advances along ordered edges', () => {
    const people = createGraphOccupants(graph, 'room', 1, route)
    expect(people[0]).toMatchObject({ status: 'moving', assignedRoom: 'Reception', destinationExit: 'EXIT A', route: route.path_node_ids })
    const progressed = advanceOccupants(people, graph, 40)
    expect(progressed[0].currentLocationId).toBe('exit')
    expect(progressed[0].status).toBe('evacuated')
  })

  it('offers only backend routes for the selected start that validate on the current graph', () => {
    const summary = { start_node_id: 'room', nearest_exit: route, alternate_exits: [], blocked_paths: [], blocked_edges: [], path_length: route.path_length }
    const options = validatedRoutesForStart(graph, summary, 'room')
    expect(options.map((item) => item.exit_label)).toEqual(['EXIT A'])
    expect(validatedRoutesForStart(graph, summary, 'corridor')).toEqual([])
    const people = createGraphOccupants(graph, 'room', 2, options.find((item) => item.exit_id === 'exit'))
    expect(people.every((person) => person.status === 'moving' && person.destinationExit === 'EXIT A' && person.route[0] === 'room' && person.route[person.route.length - 1] === 'exit')).toBe(true)
    const blocked = { ...graph, edges: graph.edges.map((edge) => edge.from === 'room' ? { ...edge, blocked: true } : edge) }
    expect(validatedRoutesForStart(blocked, summary, 'room')).toEqual([])
  })

  it('selects the persisted Reception-to-E2 route and assigns it to generated occupants', () => {
    const routes = { start_node_id: persistedOfficePath[0], nearest_exit: persistedOfficeRoute, alternate_exits: [], blocked_paths: [], blocked_edges: [], path_length: .95082 }
    const options = validatedRoutesForStart(persistedOfficeGraph, routes, persistedOfficePath[0])
    expect(options.map((item) => item.exit_label)).toEqual(['EXIT E2 — WEST'])
    const selectedDestination = options.find((item) => item.exit_id === persistedOfficePath[6])
    const people = createGraphOccupants(persistedOfficeGraph, persistedOfficePath[0], 24, selectedDestination)
    expect(people).toHaveLength(24)
    expect(people.every((person) => person.status === 'moving' && person.destinationExit === 'EXIT E2 — WEST' && JSON.stringify(person.route) === JSON.stringify(persistedOfficePath))).toBe(true)
  })

  it('marks unreachable people trapped without fabricating a route', () => {
    const people = createGraphOccupants({ ...graph, edges: [] }, 'room', 2, null)
    expect(people.every((person) => person.status === 'trapped' && person.destinationExit === null && person.route.length === 1)).toBe(true)
    expect(people[0].unreachableReason).toContain('no reachable')
    const stationary = advanceOccupants(people, { ...graph, edges: [] }, 100)
    expect(stationary.every((person) => person.status === 'trapped' && person.currentLocationId === 'room' && person.distance === 0)).toBe(true)
  })

  it('stops movement when a reviewed edge becomes blocked', () => {
    const people = createGraphOccupants(graph, 'room', 1, route)
    const blockedGraph = { ...graph, edges: graph.edges.map((edge) => edge.from === 'door' && edge.to === 'corridor' ? { ...edge, blocked: true } : edge) }
    const stopped = advanceOccupants(people, blockedGraph, 20)
    expect(stopped[0].status).toBe('trapped')
    expect(stopped[0].unreachableReason).toContain('blocked')
  })

  it('supports play, pause, completion and reset transitions', () => {
    const initial = createGraphOccupants(graph, 'room', 1, route)
    expect(playbackTransition(false, 'play', initial)).toBe(true)
    expect(playbackTransition(true, 'pause', initial)).toBe(false)
    const completed = advanceOccupants(initial, graph, 40)
    expect(playbackTransition(true, 'tick', completed)).toBe(false)
    const reset = createGraphOccupants(graph, 'room', 1, route)
    expect(reset[0]).toMatchObject({ status: 'moving', currentLocationId: 'room', distance: 0 })
  })

  it('surfaces backend route API errors instead of treating them as empty success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Graph review is required.' }), { status: 409, headers: { 'Content-Type': 'application/json' } })))
    await expect(getEvacuationRoute('building', 'document', 'room')).rejects.toThrow('Graph review is required.')
  })
})
