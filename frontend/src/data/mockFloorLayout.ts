export interface RoomLayout {
  id: string
  label: string
  type: 'workstation' | 'meeting' | 'focus' | 'reception' | 'huddle' | 'office'
  finish: 'carpet' | 'wood' | 'tile'
  x: number
  z: number
  width: number
  depth: number
}

export interface FloorLayout {
  rooms: RoomLayout[]
  corridorWidth: number
  corridorLength: number
}

/** Replace this provider with an AI-generated FloorLayout when that pipeline is ready. */
export function createMockFloorLayout(_floor: number): FloorLayout {
  const rooms: RoomLayout[] = []
  const columns = [-1.52, 0, 1.52]
  columns.forEach((x, index) => {
    rooms.push({ id: `north-${index + 1}`, label: ['WORKSTATIONS', 'MEETING ROOM', 'FOCUS ROOM'][index], type: ['workstation', 'meeting', 'focus'][index] as RoomLayout['type'], finish: ['carpet', 'tile', 'carpet'][index] as RoomLayout['finish'], x, z: -1.25, width: 1.38, depth: 1.05 })
    rooms.push({ id: `south-${index + 1}`, label: ['RECEPTION', 'HUDDLE ROOM', 'PRIVATE OFFICE'][index], type: ['reception', 'huddle', 'office'][index] as RoomLayout['type'], finish: ['tile', 'wood', 'wood'][index] as RoomLayout['finish'], x, z: 1.25, width: 1.38, depth: 1.05 })
  })
  return { rooms, corridorWidth: 0.58, corridorLength: 5.65 }
}
