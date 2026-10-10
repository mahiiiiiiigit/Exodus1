import { describe, expect, it } from 'vitest'
import {
  buildRoomWalls,
  elementBoundsWorld,
  getRoomFinish,
  sourcePointToWorld,
  validatedRouteWorldPoints,
} from './importedPlanGeometry'
import { validateBackendRoute } from './graphOccupants'
import type { EvacuationGraph, EvacuationRoute, ReviewedPlanElement } from '../services/api'

// ==========================================
// FIXTURE PLAN 1: Office Floor Plan
// ==========================================
const plan1Elements: ReviewedPlanElement[] = [
  { id: 'reception', type: 'room', label: 'Reception Area', bbox: { x: 0.1, y: 0.1, width: 0.35, height: 0.35 }, confidence: 1.0 },
  { id: 'conf-room', type: 'room', label: 'Executive Conference Room', bbox: { x: 0.55, y: 0.1, width: 0.35, height: 0.35 }, confidence: 1.0 },
  { id: 'server-rm', type: 'room', label: 'IT Server Room', bbox: { x: 0.1, y: 0.55, width: 0.35, height: 0.35 }, confidence: 1.0 },
  { id: 'corridor-1', type: 'corridor', label: 'Central Corridor', bbox: { x: 0.1, y: 0.45, width: 0.8, height: 0.1 }, confidence: 1.0 },
  { id: 'door-rec', type: 'door', label: 'Reception Door', bbox: { x: 0.22, y: 0.44, width: 0.08, height: 0.03 }, confidence: 1.0 },
  { id: 'door-conf', type: 'door', label: 'Conference Door', bbox: { x: 0.65, y: 0.44, width: 0.08, height: 0.03 }, confidence: 1.0 },
  { id: 'stair-west', type: 'stairs', label: 'STAIR A — WEST', bbox: { x: 0.02, y: 0.45, width: 0.07, height: 0.1 }, confidence: 1.0 },
  { id: 'exit-west', type: 'exit', label: 'EXIT E1 — WEST', bbox: { x: 0.01, y: 0.46, width: 0.02, height: 0.08 }, confidence: 1.0 },
  { id: 'door-exit-west', type: 'door', label: 'Stair Exit Door', bbox: { x: 0.08, y: 0.47, width: 0.03, height: 0.06 }, confidence: 1.0 },
]

const plan1Graph: EvacuationGraph = {
  nodes: [
    { id: 'reception', type: 'room', label: 'Reception Area', bbox: plan1Elements[0].bbox, confidence: 1, status: 'safe' },
    { id: 'corridor-1', type: 'corridor', label: 'Central Corridor', bbox: plan1Elements[3].bbox, confidence: 1, status: 'safe' },
    { id: 'door-rec', type: 'door', label: 'Reception Door', bbox: plan1Elements[4].bbox, confidence: 1, status: 'safe' },
    { id: 'door-exit-west', type: 'door', label: 'Stair Exit Door', bbox: plan1Elements[8].bbox, confidence: 1, status: 'safe' },
    { id: 'exit-west', type: 'exit', label: 'EXIT E1 — WEST', bbox: plan1Elements[7].bbox, confidence: 1, status: 'safe' },
  ],
  edges: [
    { from: 'reception', to: 'door-rec', length: 0.2, confidence: 1, relation: 'passage', blocked: false },
    { from: 'door-rec', to: 'corridor-1', length: 0.1, confidence: 1, relation: 'passage', blocked: false },
    { from: 'corridor-1', to: 'door-exit-west', length: 0.3, confidence: 1, relation: 'passage', blocked: false },
    { from: 'door-exit-west', to: 'exit-west', length: 0.05, confidence: 1, relation: 'passage', blocked: false },
  ],
  adjacency: {
    'reception': ['door-rec'],
    'door-rec': ['reception', 'corridor-1'],
    'corridor-1': ['door-rec', 'door-exit-west'],
    'door-exit-west': ['corridor-1', 'exit-west'],
    'exit-west': ['door-exit-west'],
  },
}

const plan1Route: EvacuationRoute = {
  exit_id: 'exit-west',
  exit_label: 'EXIT E1 — WEST',
  path_node_ids: ['reception', 'door-rec', 'corridor-1', 'door-exit-west', 'exit-west'],
  path_length: 0.65,
}

// ==========================================
// FIXTURE PLAN 2: Bio-Research Laboratory Plan
// ==========================================
const plan2Elements: ReviewedPlanElement[] = [
  { id: 'vault-iso', type: 'room', label: 'Bio-Containment Vault (Isolated)', bbox: { x: 0.05, y: 0.05, width: 0.3, height: 0.4 }, confidence: 1.0 },
  { id: 'lab-b', type: 'room', label: 'Research Lab B', bbox: { x: 0.5, y: 0.1, width: 0.35, height: 0.35 }, confidence: 1.0 },
  { id: 'corridor-2', type: 'corridor', label: 'Service Hallway', bbox: { x: 0.45, y: 0.5, width: 0.45, height: 0.2 }, confidence: 1.0 },
  { id: 'door-lab', type: 'door', label: 'Lab B Access Door', bbox: { x: 0.62, y: 0.47, width: 0.08, height: 0.05 }, confidence: 1.0 },
  { id: 'exit-north', type: 'exit', label: 'EXIT NORTH BIO-SAFETY', bbox: { x: 0.88, y: 0.52, width: 0.06, height: 0.16 }, confidence: 1.0 },
  { id: 'door-exit-north', type: 'door', label: 'Exit Airlock', bbox: { x: 0.86, y: 0.55, width: 0.04, height: 0.08 }, confidence: 1.0 },
]

const plan2Graph: EvacuationGraph = {
  nodes: [
    { id: 'vault-iso', type: 'room', label: 'Bio-Containment Vault (Isolated)', bbox: plan2Elements[0].bbox, confidence: 1, status: 'warning' },
    { id: 'lab-b', type: 'room', label: 'Research Lab B', bbox: plan2Elements[1].bbox, confidence: 1, status: 'safe' },
    { id: 'corridor-2', type: 'corridor', label: 'Service Hallway', bbox: plan2Elements[2].bbox, confidence: 1, status: 'safe' },
    { id: 'door-lab', type: 'door', label: 'Lab B Access Door', bbox: plan2Elements[3].bbox, confidence: 1, status: 'safe' },
    { id: 'door-exit-north', type: 'door', label: 'Exit Airlock', bbox: plan2Elements[5].bbox, confidence: 1, status: 'safe' },
    { id: 'exit-north', type: 'exit', label: 'EXIT NORTH BIO-SAFETY', bbox: plan2Elements[4].bbox, confidence: 1, status: 'safe' },
  ],
  edges: [
    { from: 'lab-b', to: 'door-lab', length: 0.15, confidence: 1, relation: 'passage', blocked: false },
    { from: 'door-lab', to: 'corridor-2', length: 0.1, confidence: 1, relation: 'passage', blocked: false },
    { from: 'corridor-2', to: 'door-exit-north', length: 0.25, confidence: 1, relation: 'passage', blocked: false },
    { from: 'door-exit-north', to: 'exit-north', length: 0.04, confidence: 1, relation: 'passage', blocked: false },
  ],
  adjacency: {
    'vault-iso': [], // Isolated: NO CONNECTIONS
    'lab-b': ['door-lab'],
    'door-lab': ['lab-b', 'corridor-2'],
    'corridor-2': ['door-lab', 'door-exit-north'],
    'door-exit-north': ['corridor-2', 'exit-north'],
    'exit-north': ['door-exit-north'],
  },
}

describe('Uploaded Building 3D Generation Acceptance Tests', () => {
  describe('Test Plan 1: Office Layout 3D Building Generation', () => {
    it('generates 3D walls enclosing rooms with doorway cutouts where passages exist', () => {
      const reception = plan1Elements[0]
      const walls = buildRoomWalls(reception, plan1Elements, 2000, 1000)
      expect(walls.length).toBeGreaterThan(4)
      const lintels = walls.filter((w) => w.isLintel)
      expect(lintels.length).toBeGreaterThanOrEqual(1)
      expect(lintels.some((l) => l.id.includes('door-rec'))).toBe(true)
    })

    it('assigns realistic distinct room finishes to different architectural zones', () => {
      expect(getRoomFinish('Executive Conference Room').style).toBe('meeting')
      expect(getRoomFinish('IT Server Room').style).toBe('server')
      expect(getRoomFinish('Reception Area').style).toBe('office')
    })

    it('validates evacuation routes strictly along verified doorways and corridors', () => {
      const validation = validateBackendRoute(plan1Graph, plan1Route, 'reception')
      expect(validation.valid).toBe(true)

      const worldPoints = validatedRouteWorldPoints(plan1Graph, plan1Route, 'reception', 2000, 1000)
      expect(worldPoints.length).toBe(5)
      // First point is reception center, last point is exit-west
      expect(worldPoints[0][0]).toBeLessThan(0)
      expect(worldPoints[4][0]).toBeCloseTo(sourcePointToWorld(0.02, 0.5, 2000, 1000)[0], 0)
    })
  })

  describe('Test Plan 2: Bio-Research Laboratory with Isolated Room', () => {
    it('maps distinct source image coordinate system without colliding with Plan 1', () => {
      // 1600x900 image aspect ratio
      const boundsVault = elementBoundsWorld(plan2Elements[0], 1600, 900)
      const boundsLab = elementBoundsWorld(plan2Elements[1], 1600, 900)

      expect(boundsVault.minX).toBeCloseTo(-4.5)
      expect(boundsVault.maxX).toBeCloseTo(-1.5)
      expect(boundsLab.minX).toBeCloseTo(0.0)
      expect(boundsLab.maxX).toBeCloseTo(3.5)
    })

    it('honestly reports unreachable exits for isolated rooms without passages', () => {
      // An invalid invented route skipping doors directly to exit must be rejected
      const inventedRoute: EvacuationRoute = {
        exit_id: 'exit-north',
        exit_label: 'EXIT NORTH BIO-SAFETY',
        path_node_ids: ['vault-iso', 'exit-north'],
        path_length: 0.8,
      }
      const validation = validateBackendRoute(plan2Graph, inventedRoute, 'vault-iso')
      expect(validation.valid).toBe(false)
      expect(validation.reason).toContain('missing the connection')

      // Empty route world points returned for invalid route
      const points = validatedRouteWorldPoints(plan2Graph, inventedRoute, 'vault-iso', 1600, 900)
      expect(points).toEqual([])
    })

    it('computes valid route for connected Lab B through verified airlock', () => {
      const validLabRoute: EvacuationRoute = {
        exit_id: 'exit-north',
        exit_label: 'EXIT NORTH BIO-SAFETY',
        path_node_ids: ['lab-b', 'door-lab', 'corridor-2', 'door-exit-north', 'exit-north'],
        path_length: 0.54,
      }
      const validation = validateBackendRoute(plan2Graph, validLabRoute, 'lab-b')
      expect(validation.valid).toBe(true)

      const points = validatedRouteWorldPoints(plan2Graph, validLabRoute, 'lab-b', 1600, 900)
      expect(points.length).toBe(5)
    })
  })
})
