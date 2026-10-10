import { describe, expect, it } from 'vitest'
import {
  buildRoomWalls,
  elementBoundsWorld,
  elementCenterToWorld,
  getRoomFinish,
  sourcePointToWorld,
  validatedRouteWorldPoints,
} from './importedPlanGeometry'
import type { EvacuationGraph, EvacuationRoute, ReviewedPlanElement } from '../services/api'

const graph: EvacuationGraph = {
  nodes: [
    { id: 'reception', type: 'room', label: 'Reception', bbox: { x: .1, y: .2, width: .2, height: .2 }, confidence: 1, status: 'safe' },
    { id: 'hall', type: 'corridor', label: 'Hall', bbox: { x: .4, y: .2, width: .2, height: .2 }, confidence: 1, status: 'safe' },
    { id: 'exit', type: 'exit', label: 'EXIT E2 — WEST', bbox: { x: .7, y: .2, width: .1, height: .2 }, confidence: 1, status: 'safe' },
  ], edges: [{ from: 'reception', to: 'hall', length: .3, confidence: 1, relation: 'passage', blocked: false }, { from: 'hall', to: 'exit', length: .3, confidence: 1, relation: 'passage', blocked: false }], adjacency: { reception: ['hall'], hall: ['reception', 'exit'], exit: ['hall'] },
}
const route: EvacuationRoute = { exit_id: 'exit', exit_label: 'EXIT E2 — WEST', path_node_ids: ['reception', 'hall', 'exit'], path_length: .6 }

describe('imported plan 3D coordinate mapping', () => {
  it('maps normalized original-image coordinates with source aspect ratio', () => {
    expect(sourcePointToWorld(0, 0, 2000, 1000)).toEqual([-5, .12, 2.5])
    expect(sourcePointToWorld(1, 1, 2000, 1000)).toEqual([5, .12, -2.5])
  })
  it('maps reviewed element centers into that same coordinate space', () => {
    const element: ReviewedPlanElement = { id: 'r', type: 'room', label: 'Reception', bbox: { x: .1, y: .2, width: .2, height: .2 } }
    expect(elementCenterToWorld(element, 2000, 1000)).toEqual([-3, .12, 1])
  })
  it('maps validated route nodes in backend path order and rejects invalid routes', () => {
    expect(validatedRouteWorldPoints(graph, route, 'reception', 2000, 1000)).toEqual([[-3, .12, 1], [0, .12, 1], [2.5, .12, 1]])
    expect(validatedRouteWorldPoints(graph, { ...route, path_node_ids: ['reception', 'exit'] }, 'reception', 2000, 1000)).toEqual([])
  })
  it('computes accurate world bounding box coordinates for plan elements', () => {
    const element: ReviewedPlanElement = { id: 'r', type: 'room', label: 'Office', bbox: { x: .2, y: .1, width: .3, height: .2 } }
    const bounds = elementBoundsWorld(element, 1000, 1000)
    expect(bounds.minX).toBeCloseTo(-3)
    expect(bounds.maxX).toBeCloseTo(0)
    expect(bounds.width).toBeCloseTo(3)
    expect(bounds.depth).toBeCloseTo(2)
  })
  it('generates 3D walls around rooms with doorway cutouts when passages exist', () => {
    const room: ReviewedPlanElement = { id: 'office-1', type: 'room', label: 'Office 1', bbox: { x: .2, y: .2, width: .4, height: .4 } }
    // Door situated on the North wall (y = 0.2 in image coords)
    const door: ReviewedPlanElement = { id: 'door-1', type: 'door', label: 'Door 1', bbox: { x: .35, y: .18, width: .1, height: .04 } }
    const walls = buildRoomWalls(room, [room, door], 1000, 1000)
    expect(walls.length).toBeGreaterThan(4)
    // Check lintel existence
    const lintels = walls.filter((w) => w.isLintel)
    expect(lintels.length).toBe(1)
    expect(lintels[0].id).toContain('north-lintel')
  })
  it('selects appropriate room finishes based on semantic labels', () => {
    expect(getRoomFinish('Conference Room A').style).toBe('meeting')
    expect(getRoomFinish('IT Server Room').style).toBe('server')
    expect(getRoomFinish('Staff Pantry & Kitchen').style).toBe('pantry')
    expect(getRoomFinish('Corridor Area', true).floorColor).toBe('#1a2933')
  })
})
