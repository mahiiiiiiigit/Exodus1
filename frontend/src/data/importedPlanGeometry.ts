import type { EvacuationGraph, EvacuationRoute, ReviewedPlanElement } from '../services/api'
import { validateBackendRoute } from './graphOccupants'

export interface ImportedPlanGeometry {
  imageWidth: number
  imageHeight: number
  elements: ReviewedPlanElement[]
}

export const PLAN_WORLD_WIDTH = 10

export function sourcePointToWorld(x: number, y: number, imageWidth: number, imageHeight: number): [number, number, number] {
  const width = imageWidth > 0 ? imageWidth : 1
  const height = imageHeight > 0 ? imageHeight : 1
  return [Number(((x - .5) * PLAN_WORLD_WIDTH).toFixed(6)), .12, Number(((.5 - y) * PLAN_WORLD_WIDTH * height / width).toFixed(6))]
}

export function elementCenterToWorld(element: ReviewedPlanElement, imageWidth: number, imageHeight: number) {
  return sourcePointToWorld(element.bbox.x + element.bbox.width / 2, element.bbox.y + element.bbox.height / 2, imageWidth, imageHeight)
}

export interface ElementWorldBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  centerX: number
  centerZ: number
  width: number
  depth: number
}

export function elementBoundsWorld(element: ReviewedPlanElement, imageWidth: number, imageHeight: number): ElementWorldBounds {
  const widthRatio = imageWidth > 0 ? imageWidth : 1
  const heightRatio = imageHeight > 0 ? imageHeight : 1
  const aspectFactor = (PLAN_WORLD_WIDTH * heightRatio) / widthRatio

  const minX = (element.bbox.x - 0.5) * PLAN_WORLD_WIDTH
  const maxX = (element.bbox.x + element.bbox.width - 0.5) * PLAN_WORLD_WIDTH
  const maxZ = (0.5 - element.bbox.y) * aspectFactor
  const minZ = (0.5 - (element.bbox.y + element.bbox.height)) * aspectFactor

  return {
    minX: Math.min(minX, maxX),
    maxX: Math.max(minX, maxX),
    minZ: Math.min(minZ, maxZ),
    maxZ: Math.max(minZ, maxZ),
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    width: Math.abs(maxX - minX),
    depth: Math.abs(maxZ - minZ),
  }
}

export interface WallSegment {
  id: string
  position: [number, number, number]
  size: [number, number, number]
  rotation?: [number, number, number]
  isLintel?: boolean
}

export interface RoomFinish {
  floorColor: string
  wallColor: string
  accentColor: string
  style: 'meeting' | 'server' | 'office' | 'pantry' | 'restroom' | 'training' | 'default'
}

export function getRoomFinish(label: string, isCorridor = false): RoomFinish {
  if (isCorridor) {
    return { floorColor: '#1a2933', wallColor: '#788d98', accentColor: '#38bdf8', style: 'default' }
  }
  const l = (label || '').toLowerCase()
  if (l.includes('meet') || l.includes('conf') || l.includes('board')) {
    return { floorColor: '#1e333d', wallColor: '#8da5b0', accentColor: '#2dd4bf', style: 'meeting' }
  }
  if (/\b(server|datacenter|data\s*center|tech)\b/i.test(l) || /\bit\b/i.test(l)) {
    return { floorColor: '#17202a', wallColor: '#607d8b', accentColor: '#00e5ff', style: 'server' }
  }
  if (l.includes('pantry') || l.includes('kitchen') || l.includes('break') || l.includes('cafe')) {
    return { floorColor: '#2b3942', wallColor: '#90a4ae', accentColor: '#f59e0b', style: 'pantry' }
  }
  if (l.includes('restroom') || l.includes('toilet') || l.includes('wc') || l.includes('wash')) {
    return { floorColor: '#22333b', wallColor: '#78909c', accentColor: '#06b6d4', style: 'restroom' }
  }
  if (l.includes('training') || l.includes('class') || l.includes('audit')) {
    return { floorColor: '#36281e', wallColor: '#8d786a', accentColor: '#fb923c', style: 'training' }
  }
  return { floorColor: '#23323c', wallColor: '#8da0aa', accentColor: '#60a5fa', style: 'office' }
}

/** Construct 3D perimeter walls around a room with door cutouts where passages exist. */
export function buildRoomWalls(
  room: ReviewedPlanElement,
  allElements: ReviewedPlanElement[],
  imageWidth: number,
  imageHeight: number,
  wallHeight = 0.72,
  wallThickness = 0.05
): WallSegment[] {
  const bounds = elementBoundsWorld(room, imageWidth, imageHeight)
  const doors = allElements.filter(
    (e) => e.type === 'door' || e.type === 'opening' || (e.type === 'exit' && e.id !== room.id)
  )

  const doorCutouts = doors.map((door) => {
    const dBounds = elementBoundsWorld(door, imageWidth, imageHeight)
    return { id: door.id, ...dBounds }
  })

  const walls: WallSegment[] = []
  const halfH = wallHeight / 2
  const lintelH = 0.08
  const lintelY = wallHeight - lintelH / 2

  // 1. North Wall (z = bounds.maxZ): runs along X from minX to maxX
  const northDoors = doorCutouts
    .filter((d) => Math.abs(d.centerZ - bounds.maxZ) <= Math.max(0.25, d.depth) && d.maxX >= bounds.minX && d.minX <= bounds.maxX)
    .sort((a, b) => a.minX - b.minX)

  let curX = bounds.minX
  northDoors.forEach((door, index) => {
    const cutStart = Math.max(bounds.minX, door.minX)
    const cutEnd = Math.min(bounds.maxX, door.maxX)
    if (cutStart > curX + 0.03) {
      const segWidth = cutStart - curX
      walls.push({
        id: `${room.id}-north-${index}`,
        position: [curX + segWidth / 2, halfH, bounds.maxZ],
        size: [segWidth, wallHeight, wallThickness],
      })
    }
    const cutWidth = cutEnd - cutStart
    if (cutWidth > 0.03) {
      walls.push({
        id: `${room.id}-north-lintel-${door.id}`,
        position: [cutStart + cutWidth / 2, lintelY, bounds.maxZ],
        size: [cutWidth, lintelH, wallThickness],
        isLintel: true,
      })
    }
    curX = Math.max(curX, cutEnd)
  })
  if (bounds.maxX > curX + 0.03) {
    const segWidth = bounds.maxX - curX
    walls.push({
      id: `${room.id}-north-end`,
      position: [curX + segWidth / 2, halfH, bounds.maxZ],
      size: [segWidth, wallHeight, wallThickness],
    })
  }

  // 2. South Wall (z = bounds.minZ): runs along X from minX to maxX
  const southDoors = doorCutouts
    .filter((d) => Math.abs(d.centerZ - bounds.minZ) <= Math.max(0.25, d.depth) && d.maxX >= bounds.minX && d.minX <= bounds.maxX)
    .sort((a, b) => a.minX - b.minX)

  curX = bounds.minX
  southDoors.forEach((door, index) => {
    const cutStart = Math.max(bounds.minX, door.minX)
    const cutEnd = Math.min(bounds.maxX, door.maxX)
    if (cutStart > curX + 0.03) {
      const segWidth = cutStart - curX
      walls.push({
        id: `${room.id}-south-${index}`,
        position: [curX + segWidth / 2, halfH, bounds.minZ],
        size: [segWidth, wallHeight, wallThickness],
      })
    }
    const cutWidth = cutEnd - cutStart
    if (cutWidth > 0.03) {
      walls.push({
        id: `${room.id}-south-lintel-${door.id}`,
        position: [cutStart + cutWidth / 2, lintelY, bounds.minZ],
        size: [cutWidth, lintelH, wallThickness],
        isLintel: true,
      })
    }
    curX = Math.max(curX, cutEnd)
  })
  if (bounds.maxX > curX + 0.03) {
    const segWidth = bounds.maxX - curX
    walls.push({
      id: `${room.id}-south-end`,
      position: [curX + segWidth / 2, halfH, bounds.minZ],
      size: [segWidth, wallHeight, wallThickness],
    })
  }

  // 3. West Wall (x = bounds.minX): runs along Z from minZ to maxZ
  const westDoors = doorCutouts
    .filter((d) => Math.abs(d.centerX - bounds.minX) <= Math.max(0.25, d.width) && d.maxZ >= bounds.minZ && d.minZ <= bounds.maxZ)
    .sort((a, b) => a.minZ - b.minZ)

  let curZ = bounds.minZ
  westDoors.forEach((door, index) => {
    const cutStart = Math.max(bounds.minZ, door.minZ)
    const cutEnd = Math.min(bounds.maxZ, door.maxZ)
    if (cutStart > curZ + 0.03) {
      const segDepth = cutStart - curZ
      walls.push({
        id: `${room.id}-west-${index}`,
        position: [bounds.minX, halfH, curZ + segDepth / 2],
        size: [wallThickness, wallHeight, segDepth],
      })
    }
    const cutDepth = cutEnd - cutStart
    if (cutDepth > 0.03) {
      walls.push({
        id: `${room.id}-west-lintel-${door.id}`,
        position: [bounds.minX, lintelY, cutStart + cutDepth / 2],
        size: [wallThickness, lintelH, cutDepth],
        isLintel: true,
      })
    }
    curZ = Math.max(curZ, cutEnd)
  })
  if (bounds.maxZ > curZ + 0.03) {
    const segDepth = bounds.maxZ - curZ
    walls.push({
      id: `${room.id}-west-end`,
      position: [bounds.minX, halfH, curZ + segDepth / 2],
      size: [wallThickness, wallHeight, segDepth],
    })
  }

  // 4. East Wall (x = bounds.maxX): runs along Z from minZ to maxZ
  const eastDoors = doorCutouts
    .filter((d) => Math.abs(d.centerX - bounds.maxX) <= Math.max(0.25, d.width) && d.maxZ >= bounds.minZ && d.minZ <= bounds.maxZ)
    .sort((a, b) => a.minZ - b.minZ)

  curZ = bounds.minZ
  eastDoors.forEach((door, index) => {
    const cutStart = Math.max(bounds.minZ, door.minZ)
    const cutEnd = Math.min(bounds.maxZ, door.maxZ)
    if (cutStart > curZ + 0.03) {
      const segDepth = cutStart - curZ
      walls.push({
        id: `${room.id}-east-${index}`,
        position: [bounds.maxX, halfH, curZ + segDepth / 2],
        size: [wallThickness, wallHeight, segDepth],
      })
    }
    const cutDepth = cutEnd - cutStart
    if (cutDepth > 0.03) {
      walls.push({
        id: `${room.id}-east-lintel-${door.id}`,
        position: [bounds.maxX, lintelY, cutStart + cutDepth / 2],
        size: [wallThickness, lintelH, cutDepth],
        isLintel: true,
      })
    }
    curZ = Math.max(curZ, cutEnd)
  })
  if (bounds.maxZ > curZ + 0.03) {
    const segDepth = bounds.maxZ - curZ
    walls.push({
      id: `${room.id}-east-end`,
      position: [bounds.maxX, halfH, curZ + segDepth / 2],
      size: [wallThickness, wallHeight, segDepth],
    })
  }

  return walls
}

/** Return only graph route points that validate against the currently loaded graph. */
export function validatedRouteWorldPoints(graph: EvacuationGraph, route: EvacuationRoute | null | undefined, startId: string, imageWidth: number, imageHeight: number): [number, number, number][] {
  const checked = validateBackendRoute(graph, route, startId)
  if (!checked.valid || !route) return []
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  return route.path_node_ids.flatMap((id) => {
    const node = byId.get(id)
    return node?.bbox ? [sourcePointToWorld(node.bbox.x + node.bbox.width / 2, node.bbox.y + node.bbox.height / 2, imageWidth, imageHeight)] : []
  })
}
