import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Html, Lightformer, Line, OrbitControls } from '@react-three/drei'
import { PCFSoftShadowMap } from 'three'
import type { Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { createMockFloorLayout, type RoomLayout } from '../data/mockFloorLayout'
import { FireSimulationControls, FireSimulationLayer } from './FireSimulationLayer'
import { OccupantVisualizationLayer } from './OccupantVisualizationLayer'
import type { FireSourceLocation, FireSimulationState } from './FireSimulationLayer'
import type { EvacuationGraph, EvacuationRoute, ReviewedPlanElement } from '../services/api'
import type { GraphOccupant } from '../data/graphOccupants'
import { occupantPosition } from '../data/graphOccupants'
import {
  buildRoomWalls,
  elementBoundsWorld,
  getRoomFinish,
  sourcePointToWorld,
  validatedRouteWorldPoints,
} from '../data/importedPlanGeometry'

export interface BuildingViewerProps {
  selectedFloor: number
  occupantCount: number
  fireLocation: string
  simulationRunId: number
  safeExits: string[]
  onEvacuatedChange: (count: number) => void
  onSelectFloor: (floor: number) => void
  onFireLocationChange?: (location: string) => void
  importedPlan?: { imageWidth: number; imageHeight: number; elements: ReviewedPlanElement[] }
  availableFloors?: number[]
  graph?: EvacuationGraph | null
  route?: EvacuationRoute | null
  routeStartId?: string
  occupants?: GraphOccupant[]
  fireNodeId?: string
  fireTime?: number
  firePlaying?: boolean
  onSelectFireNode?: (nodeId: string) => void
  onSelectStartNode?: (nodeId: string) => void
}

type SceneMode = 'building' | 'floor'
type RoomSelect = (room: RoomLayout) => void

function Box({ position, size, color, emissive = '#000000', emissiveIntensity = 0, metalness = 0.15, roughness = 0.75, castShadow = false, receiveShadow = true, onClick, onHover, glass = false }: {
  position: [number, number, number]
  size: [number, number, number]
  color: string
  emissive?: string
  emissiveIntensity?: number
  metalness?: number
  roughness?: number
  glass?: boolean
  castShadow?: boolean
  receiveShadow?: boolean
  onClick?: () => void
  onHover?: (value: boolean) => void
}) {
  return <mesh position={position} castShadow={castShadow} receiveShadow={receiveShadow}
    onClick={onClick ? (event) => { event.stopPropagation(); onClick() } : undefined}
    onPointerOver={onHover ? (event) => { event.stopPropagation(); onHover(true); document.body.style.cursor = 'pointer' } : undefined}
    onPointerOut={onHover ? () => { onHover(false); document.body.style.cursor = 'auto' } : undefined}>
    <boxGeometry args={size}/>{glass
      ? <meshPhysicalMaterial color="#b8dce0" transparent opacity={.3} transmission={.5} roughness={.16} metalness={.02} ior={1.42} thickness={.055} clearcoat={.45} depthWrite={false}/>
      : <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={emissiveIntensity} metalness={metalness} roughness={roughness}/>
    }
  </mesh>
}

function Room({ room, selected, onSelect, placementEnabled, onPlaceFire }: { room: RoomLayout; selected: boolean; onSelect: RoomSelect; placementEnabled: boolean; onPlaceFire: (source: FireSourceLocation) => void }) {
  const h = .9
  const t = .05
  const corridorWallZ = room.z < 0 ? room.depth / 2 : -room.depth / 2
  const rearWallZ = -corridorWallZ
  const floorTone = room.finish === 'wood' ? '#3c3127' : room.finish === 'tile' ? '#263740' : '#223038'
  const wallTone = selected ? '#45d7a6' : '#92a5ad'
  const isMeeting = room.type === 'meeting'

  const handleRoomClick = () => {
    if (placementEnabled) {
      onPlaceFire({ id: room.id, label: room.label, x: room.x, z: room.z })
    } else {
      onSelect(room)
    }
  }

  return <group position={[room.x, .12, room.z]}>
    <Box position={[0, 0, 0]} size={[room.width, .05, room.depth]} color={selected ? '#2e5645' : placementEnabled ? '#352219' : floorTone} emissive={placementEnabled ? '#e86125' : '#000000'} emissiveIntensity={placementEnabled ? 0.35 : 0} metalness={.12} roughness={.68} castShadow onClick={handleRoomClick} onHover={(hovered) => { document.body.style.cursor = hovered ? (placementEnabled ? 'crosshair' : 'pointer') : 'auto' }}/>
    <Box position={[0, h / 2, rearWallZ]} size={[room.width, h, t]} color={wallTone} roughness={.75} glass={isMeeting} castShadow onClick={handleRoomClick}/>
    <Box position={[-room.width / 2, h / 2, 0]} size={[t, h, room.depth]} color={wallTone} roughness={.75} glass={isMeeting} castShadow onClick={handleRoomClick}/>
    <Box position={[room.width / 2, h / 2, 0]} size={[t, h, room.depth]} color={wallTone} roughness={.75} glass={isMeeting} castShadow onClick={handleRoomClick}/>
    <Box position={[-room.width * .37, h / 2, corridorWallZ]} size={[room.width * .26, h, t]} color={wallTone} roughness={.75} glass={isMeeting} castShadow onClick={handleRoomClick}/>
    <Box position={[room.width * .37, h / 2, corridorWallZ]} size={[room.width * .26, h, t]} color={wallTone} roughness={.75} glass={isMeeting} castShadow onClick={handleRoomClick}/>
    <Box position={[0, h - .045, corridorWallZ]} size={[room.width * .48, .09, t]} color={wallTone} roughness={.75} glass={isMeeting} castShadow onClick={handleRoomClick}/>
    {isMeeting && <Box position={[.29, .41, corridorWallZ - Math.sign(corridorWallZ) * .045]} size={[.025, .73, .4]} color="#b5e4eb" glass/>}
    {selected && <Html position={[0, h + .07, 0]} center distanceFactor={7.5} className="dollhouse-room-label selected"><span>{room.label}</span></Html>}
    {selected && <mesh position={[0, .077, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[.72, .75, 32]}/><meshBasicMaterial color="#41cf90" transparent opacity={.5}/></mesh>}
    {placementEnabled && <mesh position={[0, .035, 0]} rotation={[-Math.PI / 2, 0, 0]} onClick={(event) => { event.stopPropagation(); handleRoomClick() }} onPointerOver={() => { document.body.style.cursor = 'crosshair' }}><ringGeometry args={[.24, .36, 24]}/><meshBasicMaterial color="#ff7722" transparent opacity={.75}/></mesh>}
  </group>
}

function Staircase({ x, name, selected, onSelect, placementEnabled, onPlaceFire }: { x: number; name: string; selected: boolean; onSelect: RoomSelect; placementEnabled?: boolean; onPlaceFire?: (source: FireSourceLocation) => void }) {
  const stairRoom: RoomLayout = { id: `stair-${name}`, label: `STAIR ${name}`, type: 'office', finish: 'tile', x, z: 0, width: .78, depth: 1.28 }
  const handleClick = () => {
    if (placementEnabled && onPlaceFire) {
      onPlaceFire({ id: `stair-${name}`, label: `STAIRWELL ${name}`, x, z: 0 })
    } else {
      onSelect(stairRoom)
    }
  }
  return <group onClick={(event) => { event.stopPropagation(); handleClick() }} onPointerOver={(event) => { event.stopPropagation(); document.body.style.cursor = placementEnabled ? 'crosshair' : 'pointer' }} onPointerOut={() => { document.body.style.cursor = 'auto' }}>
    <Box position={[x, .13, 0]} size={[.78, .09, 1.28]} color={selected ? '#264234' : placementEnabled ? '#3a2418' : '#1c2830'} emissive={placementEnabled ? '#e86125' : '#000000'} emissiveIntensity={placementEnabled ? 0.25 : 0} roughness={.65} castShadow onClick={handleClick}/>
    {Array.from({ length: 7 }, (_, i) => <Box key={i} position={[x, .2 + i * .065, -.48 + i * .14]} size={[.66, .045, .14]} color={i % 2 ? '#9fb1b8' : '#7f939c'} roughness={.55} castShadow onClick={handleClick}/>) }
    <Box position={[x - .35, .49, .02]} size={[.035, .58, 1.16]} color="#a5b5bd" metalness={.75} roughness={.25} onClick={handleClick}/>
    <Box position={[x + .35, .49, .02]} size={[.035, .58, 1.16]} color="#a5b5bd" metalness={.75} roughness={.25} onClick={handleClick}/>
    <Box position={[x - .35, .82, .02]} size={[.045, .035, 1.18]} color="#c2d3da" metalness={.8} roughness={.2}/>
    <Box position={[x + .35, .82, .02]} size={[.045, .035, 1.18]} color="#c2d3da" metalness={.8} roughness={.2}/>
    <Box position={[x, .79, .66]} size={[.66, .19, .045]} color="#00e676" emissive="#00e676" emissiveIntensity={3.2} castShadow/>
    <pointLight position={[x, .78, .53]} color="#50ffb0" intensity={1.5} distance={2.2}/>
    <Html position={[x, .96, .69]} center distanceFactor={8} className={`dollhouse-exit-label${selected ? ' selected' : ''}`}><span>EXIT {name}</span></Html>
  </group>
}

function ElevatorCore({ onSelect }: { onSelect: RoomSelect }) {
  const elevator: RoomLayout = { id: 'elevator-core', label: 'ELEVATORS', type: 'office', finish: 'tile', x: 0, z: -.46, width: .78, depth: .56 }
  return <group position={[0, 0, 0]} onClick={(event) => { event.stopPropagation(); onSelect(elevator) }} onPointerOver={(event) => { event.stopPropagation(); document.body.style.cursor = 'pointer' }} onPointerOut={() => { document.body.style.cursor = 'auto' }}>
    <Box position={[0, .48, -.54]} size={[.83, .88, .16]} color="#d0cec5" roughness={.65} castShadow/>
    <Box position={[-.19, .47, -.445]} size={[.36, .72, .025]} color="#899391" metalness={.68} roughness={.25}/>
    <Box position={[.19, .47, -.445]} size={[.36, .72, .025]} color="#899391" metalness={.68} roughness={.25}/>
    <Box position={[0, .49, -.425]} size={[.016, .68, .012]} color="#d4b77c" metalness={.72} roughness={.22}/>
    <Box position={[.38, .73, -.42]} size={[.035, .12, .025]} color="#e8c78b" emissive="#e4b668" emissiveIntensity={.7}/>
    <Html position={[0, 1.02, -.37]} center distanceFactor={8} className="dollhouse-core-label"><span>LIFTS</span></Html>
  </group>
}

function FloorScene({ floor, selectedRoom, occupantCount, safeExits, onEvacuatedChange, onSelectRoom, fireState, placementEnabled, onPlaceFire }: {
  floor: number
  selectedRoom: string | null
  occupantCount: number
  safeExits: string[]
  onEvacuatedChange: (count: number) => void
  onSelectRoom: RoomSelect
  fireState: FireSimulationState
  placementEnabled: boolean
  onPlaceFire: (source: FireSourceLocation) => void
}) {
  const floorGroup = useRef<Group>(null)
  const layout = useMemo(() => createMockFloorLayout(floor), [floor])
  const corridor: RoomLayout = { id: 'corridor', label: 'CENTRAL CORRIDOR', type: 'office', finish: 'tile', x: 0, z: 0, width: layout.corridorLength, depth: layout.corridorWidth }
  const placeFireAtFloorPoint = (x: number, z: number) => {
    const room = layout.rooms.find((candidate) => Math.abs(x - candidate.x) <= candidate.width / 2 && Math.abs(z - candidate.z) <= candidate.depth / 2)
    if (room) {
      onPlaceFire({ id: room.id, label: room.label, x: room.x, z: room.z })
      return
    }
    if (Math.abs(z) <= corridor.depth / 2) {
      onPlaceFire({ id: corridor.id, label: corridor.label, x, z })
      return
    }
    const nearestRoom = layout.rooms.reduce((nearest, candidate) => Math.hypot(candidate.x - x, candidate.z - z) < Math.hypot(nearest.x - x, nearest.z - z) ? candidate : nearest)
    onPlaceFire({ id: nearestRoom.id, label: nearestRoom.label, x: nearestRoom.x, z: nearestRoom.z })
  }
  return <group ref={floorGroup}>
    <Box position={[0, -.09, 0]} size={[6.55, .18, 4.75]} color="#152128" metalness={.25} roughness={.6} castShadow/>
    <Box position={[0, .02, 0]} size={[6.28, .035, 4.48]} color="#1e2d36" roughness={.7}/>
    <Box position={[0, .045, 0]} size={[layout.corridorLength, .04, layout.corridorWidth]} color={placementEnabled ? '#3b2518' : '#2a3d47'} emissive={placementEnabled ? '#e86125' : '#000000'} emissiveIntensity={placementEnabled ? 0.25 : 0} roughness={.5} metalness={.15} onClick={() => { if (placementEnabled) onPlaceFire({ id: corridor.id, label: corridor.label, x: 0, z: 0 }); else onSelectRoom(corridor) }} onHover={(hovered) => { document.body.style.cursor = hovered ? (placementEnabled ? 'crosshair' : 'pointer') : 'auto' }}/>
    {layout.rooms.map((room) => <Room key={room.id} room={room} selected={selectedRoom === room.id} onSelect={onSelectRoom} placementEnabled={placementEnabled} onPlaceFire={onPlaceFire}/>) }
    <ElevatorCore onSelect={onSelectRoom}/>
    <Staircase x={-2.67} name="A" selected={selectedRoom === 'stair-A'} onSelect={onSelectRoom} placementEnabled={placementEnabled} onPlaceFire={onPlaceFire}/>
    <Staircase x={2.67} name="B" selected={selectedRoom === 'stair-B'} onSelect={onSelectRoom} placementEnabled={placementEnabled} onPlaceFire={onPlaceFire}/>
    {placementEnabled && <mesh position={[0, 0.055, 0]} rotation={[-Math.PI / 2, 0, 0]} onClick={(event) => {
      event.stopPropagation()
      const floorPoint = floorGroup.current?.worldToLocal(event.point.clone())
      if (floorPoint) placeFireAtFloorPoint(floorPoint.x, floorPoint.z)
    }} onPointerOver={() => { document.body.style.cursor = 'crosshair' }} onPointerOut={() => { document.body.style.cursor = 'auto' }}>
      <planeGeometry args={[6.5, 4.6]}/><meshBasicMaterial transparent opacity={0.001} depthWrite={false}/>
    </mesh>}
    <FireSimulationLayer source={fireState.source} rooms={layout.rooms} time={fireState.time} intensity={fireState.intensity} smokeDensity={fireState.smokeDensity}/>
    <OccupantVisualizationLayer rooms={layout.rooms} count={occupantCount} source={fireState.source} time={fireState.time} smokeDensity={fireState.smokeDensity} safeExits={safeExits} onEvacuatedChange={onEvacuatedChange}/>
    <ContactShadows position={[0, .005, 0]} opacity={.42} scale={9} blur={2.2} far={3} resolution={256} frames={1}/>
  </group>
}

function TowerFloor({ level, hovered, onHover, onOpen, selectedFloor, mode }: { level: number; hovered: boolean; onHover: (value: number | null) => void; onOpen: (level: number) => void; selectedFloor: number; mode: SceneMode }) {
  const group = useRef<Group>(null)
  const opacity = useRef(1)
  const color = hovered ? '#2d9f83' : '#314651'
  useFrame((_, delta) => {
    if (!group.current) return
    const transitioning = mode === 'floor'
    const chosen = transitioning && level === selectedFloor
    const targetY = level * 1.14 + (transitioning && level > selectedFloor ? .46 : transitioning && level < selectedFloor ? -.18 : 0) + (chosen ? .28 : 0)
    const targetZ = chosen ? 2.15 : 0
    const targetScale = chosen ? 1.17 : 1
    const targetOpacity = transitioning && !chosen ? 0 : 1
    const rate = 1 - Math.exp(-delta * 3.1)
    group.current.position.y += (targetY - group.current.position.y) * rate
    group.current.position.z += (targetZ - group.current.position.z) * rate
    group.current.scale.setScalar(group.current.scale.x + (targetScale - group.current.scale.x) * rate)
    if (Math.abs(opacity.current - targetOpacity) > .006) {
      opacity.current += (targetOpacity - opacity.current) * rate
      setGroupOpacity(group.current, opacity.current)
    } else if (opacity.current !== targetOpacity) {
      opacity.current = targetOpacity
      setGroupOpacity(group.current, targetOpacity)
    }
  })
  return <group ref={group} position={[0, level * 1.14, 0]} onClick={(event) => { event.stopPropagation(); onOpen(level) }} onPointerOver={(event) => { event.stopPropagation(); onHover(level); document.body.style.cursor = 'pointer' }} onPointerOut={() => { onHover(null); document.body.style.cursor = 'auto' }}>
    <Box position={[0, 0, 0]} size={[6.35, .15, 4.55]} color={color} emissive={hovered ? '#0b7758' : '#081319'} emissiveIntensity={hovered ? .4 : .15} metalness={.5} castShadow/>
    <Box position={[0, .29, 0]} size={[5.9, .46, 4.12]} color="#21343d" metalness={.3} roughness={.55}/>
    <Box position={[0, .55, 0]} size={[6.42, .08, 4.62]} color={hovered ? '#46e0ad' : '#607983'} metalness={.55}/>
    {[-2.5, -1.5, -.5, .5, 1.5, 2.5].map((x) => <Box key={x} position={[x, .3, 2.08]} size={[.72, .27, .035]} color="#73a7b0" emissive="#246078" emissiveIntensity={.45} metalness={.65}/>) }
    {mode === 'building' && <Html position={[3.55, .32, 0]} center distanceFactor={10} className="building-floor-label"><span>F{String(level).padStart(2, '0')}</span></Html>}
  </group>
}

function setGroupOpacity(group: Group | null, opacity: number) {
  if (!group) return
  group.traverse((object) => {
    if ((object as any).userData?.skipOpacityBlend) return
    const mesh = object as Mesh
    if (!mesh.isMesh || !mesh.material) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach((material) => {
      const surface = material as MeshStandardMaterial
      surface.transparent = opacity < 1
      surface.opacity = opacity
      surface.depthWrite = opacity > .8
    })
  })
}

function SceneCamera({ mode }: { mode: SceneMode }) {
  const { camera } = useThree()
  const controls = useRef<any>(null)
  const target = useRef<Vector3 | null>(null)
  const moving = useRef(true)
  useEffect(() => { moving.current = true }, [mode])
  useFrame((_, delta) => {
    if (!moving.current) return
    const destination = mode === 'building' ? [13, 11, 17] : [5.6, 7.8, 7.2]
    const targetPosition = mode === 'building' ? { x: 0, y: 5.2, z: 0 } : { x: 0, y: .35, z: 0 }
    const alpha = 1 - Math.exp(-delta * 2.3)
    camera.position.lerp({ x: destination[0], y: destination[1], z: destination[2] } as Vector3, alpha)
    if (controls.current) {
      const controlTarget = controls.current.target as Vector3
      if (!target.current) target.current = controlTarget.clone()
      target.current.lerp(targetPosition as Vector3, alpha)
      controlTarget.copy(target.current)
      controls.current.update()
      if (camera.position.distanceTo({ x: destination[0], y: destination[1], z: destination[2] } as Vector3) < .08 && target.current.distanceTo(targetPosition as Vector3) < .04) moving.current = false
    }
  })
  return <OrbitControls ref={controls} enableDamping dampingFactor={.075} minDistance={5} maxDistance={28} maxPolarAngle={Math.PI * .49}/>
}

function SceneBlend({ mode, overview, structure, detail }: { mode: SceneMode; overview: React.RefObject<Group | null>; structure: React.RefObject<Group | null>; detail: React.RefObject<Group | null> }) {
  const blend = useRef(mode === 'building' ? 0 : 1)
  useFrame((_, delta) => {
    const target = mode === 'floor' ? 1 : 0
    if (Math.abs(blend.current - target) < 0.002) {
      if (blend.current !== target) {
        blend.current = target
        if (overview.current) overview.current.visible = target === 0
        if (structure.current) setGroupOpacity(structure.current, 1 - target)
        if (detail.current) {
          detail.current.visible = target === 1
          detail.current.scale.setScalar(.92 + target * .08)
          setGroupOpacity(detail.current, target)
        }
      }
      return
    }
    const alpha = 1 - Math.exp(-delta * 2.7)
    blend.current += (target - blend.current) * alpha
    if (overview.current) {
      overview.current.visible = blend.current < .995
      overview.current.scale.setScalar(1 - blend.current * .08)
    }
    if (structure.current) setGroupOpacity(structure.current, 1 - blend.current)
    if (detail.current) {
      detail.current.visible = blend.current > .005
      detail.current.scale.setScalar(.92 + blend.current * .08)
      setGroupOpacity(detail.current, blend.current)
    }
  })
  return null
}

function ImportedFloorScene({
  plan,
  graph,
  route,
  routeStartId,
  occupants,
  fireNodeId,
  fireTime = 0,
  selectedElementId,
  onSelectElement,
  placementEnabled,
  onPlaceFire,
}: {
  plan: NonNullable<BuildingViewerProps['importedPlan']>
  graph?: EvacuationGraph | null
  route?: EvacuationRoute | null
  routeStartId?: string
  occupants: GraphOccupant[]
  fireNodeId?: string
  fireTime?: number
  selectedElementId: string | null
  onSelectElement: (element: ReviewedPlanElement) => void
  placementEnabled: boolean
  onPlaceFire: (nodeId: string, label: string) => void
}) {
  const { imageWidth, imageHeight } = plan
  const rooms = useMemo(() => plan.elements.filter((e) => e.type === 'room'), [plan.elements])
  const corridors = useMemo(() => plan.elements.filter((e) => e.type === 'corridor'), [plan.elements])
  const doors = useMemo(() => plan.elements.filter((e) => e.type === 'door' || e.type === 'opening'), [plan.elements])
  const stairs = useMemo(() => plan.elements.filter((e) => e.type === 'stairs'), [plan.elements])
  const exits = useMemo(() => plan.elements.filter((e) => e.type === 'exit'), [plan.elements])
  const structuralWalls = useMemo(() => plan.elements.filter((e) => e.type === 'wall'), [plan.elements])
  const unknownElements = useMemo(() => plan.elements.filter((e) => e.type === 'unknown'), [plan.elements])

  const importedRoomsForFire: RoomLayout[] = useMemo(() => {
    return plan.elements
      .filter((e) => e.type === 'room' || e.type === 'corridor')
      .map((e) => {
        const bounds = elementBoundsWorld(e, imageWidth, imageHeight)
        return {
          id: e.id,
          label: e.label,
          type: 'office' as const,
          finish: 'tile' as const,
          x: bounds.centerX,
          z: bounds.centerZ,
          width: bounds.width,
          depth: bounds.depth,
        }
      })
  }, [plan.elements, imageWidth, imageHeight])

  const fireSource: FireSourceLocation | null = useMemo(() => {
    if (!fireNodeId) return null
    const node = graph?.nodes.find((n) => n.id === fireNodeId)
    if (node?.bbox) {
      const [x, , z] = sourcePointToWorld(node.bbox.x + node.bbox.width / 2, node.bbox.y + node.bbox.height / 2, imageWidth, imageHeight)
      return { id: node.id, label: node.label, x, z }
    }
    const element = plan.elements.find((e) => e.id === fireNodeId)
    if (element) {
      const bounds = elementBoundsWorld(element, imageWidth, imageHeight)
      return { id: element.id, label: element.label, x: bounds.centerX, z: bounds.centerZ }
    }
    return null
  }, [fireNodeId, graph?.nodes, plan.elements, imageWidth, imageHeight])

  const checkedRoute = graph && route && routeStartId ? validatedRouteWorldPoints(graph, route, routeStartId, imageWidth, imageHeight) : []

  const edgeLines = useMemo(() => {
    return graph?.edges.flatMap((edge) => {
      const from = graph.nodes.find((node) => node.id === edge.from)
      const to = graph.nodes.find((node) => node.id === edge.to)
      if (!from?.bbox || !to?.bbox) return []
      const a = sourcePointToWorld(from.bbox.x + from.bbox.width / 2, from.bbox.y + from.bbox.height / 2, imageWidth, imageHeight)
      const b = sourcePointToWorld(to.bbox.x + to.bbox.width / 2, to.bbox.y + to.bbox.height / 2, imageWidth, imageHeight)
      return [{ id: `${edge.from}-${edge.to}`, points: [[a[0], .16, a[2]], [b[0], .16, b[2]]] as [number, number, number][], blocked: edge.blocked }]
    }) ?? []
  }, [graph, imageWidth, imageHeight])

  const startElement = useMemo(() => {
    return routeStartId ? plan.elements.find((e) => e.id === routeStartId) : null
  }, [routeStartId, plan.elements])

  const startBounds = useMemo(() => {
    return startElement ? elementBoundsWorld(startElement, imageWidth, imageHeight) : null
  }, [startElement, imageWidth, imageHeight])

  const aspectDepth = 10 * imageHeight / Math.max(1, imageWidth)

  return (
    <group>
      {/* 3D Foundation Slab */}
      <mesh position={[0, -.07, 0]} receiveShadow>
        <boxGeometry args={[10.2, .14, aspectDepth + 0.2]} />
        <meshStandardMaterial color="#0c161d" metalness={.35} roughness={.7} />
      </mesh>
      <mesh position={[0, -.005, 0]} receiveShadow>
        <boxGeometry args={[10.05, .01, aspectDepth + 0.05]} />
        <meshStandardMaterial color="#192832" roughness={.8} />
      </mesh>

      {/* 1. ROOMS: Real vertical 3D walls with door cutouts & distinct finishes */}
      {rooms.map((room) => {
        const bounds = elementBoundsWorld(room, imageWidth, imageHeight)
        const finish = getRoomFinish(room.label)
        const walls = buildRoomWalls(room, plan.elements, imageWidth, imageHeight, 0.72, 0.055)
        const isSelected = selectedElementId === room.id || routeStartId === room.id
        const isFire = fireNodeId === room.id

        const handleClick = (e?: any) => {
          e?.stopPropagation()
          if (placementEnabled) {
            onPlaceFire(room.id, room.label)
          } else {
            onSelectElement(room)
          }
        }

        return (
          <group key={room.id}>
            {/* Room Floor Slab */}
            <mesh
              position={[bounds.centerX, .02, bounds.centerZ]}
              receiveShadow
              onClick={handleClick}
              onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = placementEnabled ? 'crosshair' : 'pointer' }}
              onPointerOut={() => { document.body.style.cursor = 'auto' }}
            >
              <boxGeometry args={[bounds.width, .04, bounds.depth]} />
              <meshStandardMaterial
                color={isSelected ? '#1f3e36' : isFire ? '#3b1c1c' : finish.floorColor}
                emissive={isFire ? '#ef4444' : isSelected ? '#10b981' : '#000000'}
                emissiveIntensity={isFire ? 0.35 : isSelected ? 0.2 : 0}
                roughness={.75}
              />
            </mesh>

            {/* 3D Vertical Perimeter Walls with Doorway Cutouts */}
            {walls.map((wall) => (
              <mesh
                key={wall.id}
                position={wall.position}
                castShadow
                receiveShadow
                onClick={handleClick}
              >
                <boxGeometry args={wall.size} />
                <meshStandardMaterial
                  color={wall.isLintel ? '#70838e' : finish.wallColor}
                  roughness={.78}
                />
              </mesh>
            ))}

            {/* Selection highlight ring */}
            {isSelected && (
              <mesh position={[bounds.centerX, .045, bounds.centerZ]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[Math.min(bounds.width, bounds.depth) * .28, Math.min(bounds.width, bounds.depth) * .34, 32]} />
                <meshBasicMaterial color="#38bdf8" transparent opacity={.75} />
              </mesh>
            )}

            {/* Placement reticle */}
            {placementEnabled && (
              <mesh position={[bounds.centerX, .05, bounds.centerZ]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[.22, .32, 24]} />
                <meshBasicMaterial color="#f97316" transparent opacity={.85} />
              </mesh>
            )}

            {/* 3D Floating Room Badge */}
            <Html position={[bounds.centerX, 0.85, bounds.centerZ]} center distanceFactor={14}>
              <div className={`imported-3d-badge room-badge${isSelected ? ' selected' : ''}`}>
                <span>{room.label || 'Room'}</span>
                {room.type === 'unknown' || (room.confidence ?? 1) < 0.8 ? (
                  <small className="badge-uncertain">⚠ UNCERTAIN</small>
                ) : null}
              </div>
            </Html>
          </group>
        )
      })}

      {/* 2. CORRIDORS */}
      {corridors.map((corridor) => {
        const bounds = elementBoundsWorld(corridor, imageWidth, imageHeight)
        return (
          <group key={corridor.id}>
            <mesh position={[bounds.centerX, .015, bounds.centerZ]} receiveShadow>
              <boxGeometry args={[bounds.width, .03, bounds.depth]} />
              <meshStandardMaterial color="#1a2730" roughness={.6} metalness={.2} />
            </mesh>
            <Html position={[bounds.centerX, .22, bounds.centerZ]} center distanceFactor={14}>
              <span className="imported-3d-label corridor-label">{corridor.label || 'Corridor'}</span>
            </Html>
          </group>
        )
      })}

      {/* 3. STRUCTURAL WALLS */}
      {structuralWalls.map((wall) => {
        const bounds = elementBoundsWorld(wall, imageWidth, imageHeight)
        return (
          <group key={wall.id}>
            <mesh position={[bounds.centerX, 0.36, bounds.centerZ]} castShadow receiveShadow>
              <boxGeometry args={[Math.max(0.06, bounds.width), 0.72, Math.max(0.06, bounds.depth)]} />
              <meshStandardMaterial color="#64748b" roughness={.85} />
            </mesh>
          </group>
        )
      })}

      {/* 4. DOORS & OPENINGS: 3D Portals & Frames */}
      {doors.map((door) => {
        const bounds = elementBoundsWorld(door, imageWidth, imageHeight)
        const isDoor = door.type === 'door'
        const alongX = bounds.width >= bounds.depth
        const w = Math.max(0.12, bounds.width)
        const d = Math.max(0.12, bounds.depth)

        return (
          <group key={door.id}>
            {/* Threshold plate */}
            <mesh position={[bounds.centerX, .015, bounds.centerZ]}>
              <boxGeometry args={[w, .03, d]} />
              <meshStandardMaterial color="#334155" roughness={.5} metalness={.3} />
            </mesh>

            {/* 3D Frame Posts & Lintel */}
            {alongX ? (
              <>
                <mesh position={[bounds.centerX - w / 2 + 0.02, 0.34, bounds.centerZ]}>
                  <boxGeometry args={[0.04, 0.68, 0.06]} />
                  <meshStandardMaterial color="#475569" metalness={.4} />
                </mesh>
                <mesh position={[bounds.centerX + w / 2 - 0.02, 0.34, bounds.centerZ]}>
                  <boxGeometry args={[0.04, 0.68, 0.06]} />
                  <meshStandardMaterial color="#475569" metalness={.4} />
                </mesh>
                <mesh position={[bounds.centerX, 0.68, bounds.centerZ]}>
                  <boxGeometry args={[w, 0.04, 0.06]} />
                  <meshStandardMaterial color="#475569" metalness={.4} />
                </mesh>
                {/* Swung open door leaf */}
                {isDoor && (
                  <mesh position={[bounds.centerX - w * 0.2, 0.34, bounds.centerZ + 0.12]} rotation={[0, Math.PI / 4, 0]}>
                    <boxGeometry args={[w * 0.45, 0.64, 0.02]} />
                    <meshStandardMaterial color="#b45309" roughness={.6} />
                  </mesh>
                )}
              </>
            ) : (
              <>
                <mesh position={[bounds.centerX, 0.34, bounds.centerZ - d / 2 + 0.02]}>
                  <boxGeometry args={[0.06, 0.68, 0.04]} />
                  <meshStandardMaterial color="#475569" metalness={.4} />
                </mesh>
                <mesh position={[bounds.centerX, 0.34, bounds.centerZ + d / 2 - 0.02]}>
                  <boxGeometry args={[0.06, 0.68, 0.04]} />
                  <meshStandardMaterial color="#475569" metalness={.4} />
                </mesh>
                <mesh position={[bounds.centerX, 0.68, bounds.centerZ]}>
                  <boxGeometry args={[0.06, 0.04, d]} />
                  <meshStandardMaterial color="#475569" metalness={.4} />
                </mesh>
                {isDoor && (
                  <mesh position={[bounds.centerX + 0.12, 0.34, bounds.centerZ - d * 0.2]} rotation={[0, -Math.PI / 4, 0]}>
                    <boxGeometry args={[0.02, 0.64, d * 0.45]} />
                    <meshStandardMaterial color="#b45309" roughness={.6} />
                  </mesh>
                )}
              </>
            )}

            <Html position={[bounds.centerX, .35, bounds.centerZ]} center distanceFactor={14}>
              <span className="imported-3d-label door-label">{door.label || (isDoor ? 'Door' : 'Opening')}</span>
            </Html>
          </group>
        )
      })}

      {/* 5. STAIRS: 3D cascading steps & purple beacons */}
      {stairs.map((stair) => {
        const bounds = elementBoundsWorld(stair, imageWidth, imageHeight)
        return (
          <group key={stair.id}>
            {/* 7-step treads */}
            {Array.from({ length: 7 }, (_, i) => {
              const stepY = 0.08 + i * 0.075
              const stepZ = bounds.minZ + (bounds.depth / 7) * (i + 0.5)
              return (
                <mesh key={i} position={[bounds.centerX, stepY, stepZ]} castShadow>
                  <boxGeometry args={[bounds.width * 0.85, 0.05, bounds.depth / 7]} />
                  <meshStandardMaterial color={i % 2 ? '#64748b' : '#475569'} roughness={.6} />
                </mesh>
              )
            })}
            {/* Steel railings */}
            <mesh position={[bounds.minX + 0.05, 0.42, bounds.centerZ]}>
              <boxGeometry args={[0.03, 0.5, bounds.depth]} />
              <meshStandardMaterial color="#94a3b8" metalness={.8} roughness={.2} />
            </mesh>
            <mesh position={[bounds.maxX - 0.05, 0.42, bounds.centerZ]}>
              <boxGeometry args={[0.03, 0.5, bounds.depth]} />
              <meshStandardMaterial color="#94a3b8" metalness={.8} roughness={.2} />
            </mesh>
            {/* Purple beacon */}
            <pointLight position={[bounds.centerX, 0.65, bounds.centerZ]} color="#c084fc" intensity={1.8} distance={2.8} />
            <Html position={[bounds.centerX, 0.82, bounds.centerZ]} center distanceFactor={14}>
              <div className="imported-3d-badge stair-badge">
                <span>STAIRS</span>
                <strong>{stair.label || 'Stairs'}</strong>
              </div>
            </Html>
          </group>
        )
      })}

      {/* 6. EXITS: Distinct glowing green portals */}
      {exits.map((exit) => {
        const bounds = elementBoundsWorld(exit, imageWidth, imageHeight)
        const isBlocked = graph?.nodes.find((n) => n.id === exit.id)?.status === 'blocked'
        const color = isBlocked ? '#ef4444' : '#22c55e'

        return (
          <group key={exit.id}>
            {/* Illuminated Portal */}
            <mesh position={[bounds.centerX, 0.35, bounds.centerZ]} castShadow>
              <boxGeometry args={[Math.max(0.35, bounds.width), 0.7, Math.max(0.35, bounds.depth)]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={2.4}
                roughness={.3}
              />
            </mesh>
            {/* Exit Emergency Beacon */}
            <pointLight
              position={[bounds.centerX, 0.75, bounds.centerZ]}
              color={isBlocked ? '#f87171' : '#4ade80'}
              intensity={2.8}
              distance={3.5}
            />
            {/* Distinct 3D Exit Badge */}
            <Html position={[bounds.centerX, 0.98, bounds.centerZ]} center distanceFactor={14}>
              <div className={`imported-3d-badge exit-badge${isBlocked ? ' blocked' : ''}`}>
                <span>{isBlocked ? 'BLOCKED EXIT' : 'EMERGENCY EXIT'}</span>
                <strong>{exit.label || 'EXIT'}</strong>
              </div>
            </Html>
          </group>
        )
      })}

      {/* 7. UNKNOWN / UNCERTAIN ELEMENTS */}
      {unknownElements.map((elem) => {
        const bounds = elementBoundsWorld(elem, imageWidth, imageHeight)
        return (
          <group key={elem.id}>
            <mesh position={[bounds.centerX, 0.02, bounds.centerZ]}>
              <boxGeometry args={[bounds.width, 0.04, bounds.depth]} />
              <meshStandardMaterial color="#854d0e" roughness={.8} />
            </mesh>
            <Html position={[bounds.centerX, 0.3, bounds.centerZ]} center distanceFactor={14}>
              <span className="imported-3d-label uncertain">{elem.label || 'Unlabeled'} · ⚠ UNCERTAIN</span>
            </Html>
          </group>
        )
      })}

      {/* 8. EVACUATION GRAPH EDGES */}
      {edgeLines.map((edge) => (
        <Line
          key={edge.id}
          points={edge.points}
          color={edge.blocked ? '#f87171' : '#34d399'}
          lineWidth={1.5}
          dashed
          dashSize={.08}
          gapSize={.04}
        />
      ))}

      {/* 9. ACTIVE VERIFIED ROUTE */}
      {checkedRoute.length > 1 && (
        <>
          <Line
            points={checkedRoute.map((p) => [p[0], .22, p[2]] as [number, number, number])}
            color="#38bdf8"
            lineWidth={5}
          />
          <Line
            points={checkedRoute.map((p) => [p[0], .22, p[2]] as [number, number, number])}
            color="#bae6fd"
            lineWidth={2}
          />
        </>
      )}

      {/* UNREACHABLE ROUTE WARNING */}
      {routeStartId && checkedRoute.length <= 1 && startBounds && (
        <Html position={[startBounds.centerX, 0.96, startBounds.centerZ]} center distanceFactor={14}>
          <div className="imported-3d-badge no-route-badge">
            <span>⚠ NO VALID ROUTE TO EXIT</span>
          </div>
        </Html>
      )}

      {/* 10. OCCUPANT AGENTS */}
      {graph && occupants.map((occupant) => {
        const [u, v] = occupantPosition(occupant, graph)
        const [x, , z] = sourcePointToWorld(u, v, imageWidth, imageHeight)
        const color = occupant.status === 'evacuated' ? '#22c55e' : occupant.status === 'trapped' ? '#ef4444' : '#38bdf8'

        return (
          <group key={occupant.id} position={[x, 0.02, z]}>
            {/* Ground Halo */}
            <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.065, 0.085, 16]} />
              <meshBasicMaterial color={color} transparent opacity={0.7} />
            </mesh>
            {/* Torso */}
            <mesh position={[0, 0.11, 0]}>
              <cylinderGeometry args={[0.035, 0.045, 0.14, 8]} />
              <meshStandardMaterial color={color} roughness={0.5} />
            </mesh>
            {/* Head */}
            <mesh position={[0, 0.22, 0]}>
              <sphereGeometry args={[0.048, 12, 10]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
            </mesh>
          </group>
        )
      })}

      {/* 11. SYNCHRONIZED FIRE & SMOKE SIMULATION */}
      {fireSource && (
        <FireSimulationLayer
          source={fireSource}
          rooms={importedRoomsForFire}
          time={fireTime}
          intensity={1.2}
          smokeDensity={0.75}
        />
      )}

      {/* Contact Shadows */}
      <ContactShadows position={[0, .005, 0]} opacity={.4} scale={14} blur={2} far={7} resolution={256} frames={1} />
    </group>
  )
}

function ImportedBuildingOverview({
  availableFloors,
  selectedFloor,
  hoveredFloor,
  onHoverFloor,
  onSelectFloor,
  imageWidth,
  imageHeight,
}: {
  availableFloors: number[]
  selectedFloor: number
  hoveredFloor: number | null
  onHoverFloor: (floor: number | null) => void
  onSelectFloor: (floor: number) => void
  imageWidth: number
  imageHeight: number
}) {
  const aspectDepth = 10 * imageHeight / Math.max(1, imageWidth)
  const floorLevels = availableFloors.length ? availableFloors : [selectedFloor]

  return (
    <group>
      {floorLevels.map((level, index) => {
        const y = index * 1.6
        const isHovered = hoveredFloor === level
        const isSelected = selectedFloor === level
        const slabColor = isHovered ? '#10b981' : isSelected ? '#0284c7' : '#1e293b'

        return (
          <group
            key={level}
            position={[0, y, 0]}
            onClick={(e) => { e.stopPropagation(); onSelectFloor(level) }}
            onPointerOver={(e) => { e.stopPropagation(); onHoverFloor(level); document.body.style.cursor = 'pointer' }}
            onPointerOut={() => { onHoverFloor(null); document.body.style.cursor = 'auto' }}
          >
            {/* Floor Slab Plate */}
            <mesh position={[0, 0, 0]} castShadow receiveShadow>
              <boxGeometry args={[10, 0.14, aspectDepth]} />
              <meshStandardMaterial
                color={slabColor}
                emissive={isHovered ? '#10b981' : isSelected ? '#0284c7' : '#000000'}
                emissiveIntensity={isHovered ? 0.35 : isSelected ? 0.2 : 0}
                roughness={0.6}
              />
            </mesh>
            {/* Perimeter Railing */}
            <mesh position={[0, 0.22, aspectDepth / 2]}>
              <boxGeometry args={[10, 0.3, 0.04]} />
              <meshPhysicalMaterial color="#94a3b8" transparent opacity={0.35} roughness={0.2} transmission={0.6} />
            </mesh>
            <mesh position={[0, 0.22, -aspectDepth / 2]}>
              <boxGeometry args={[10, 0.3, 0.04]} />
              <meshPhysicalMaterial color="#94a3b8" transparent opacity={0.35} roughness={0.2} transmission={0.6} />
            </mesh>
            {/* Floor Badge in 3D */}
            <Html position={[5.4, 0.1, 0]} center distanceFactor={12}>
              <div className={`building-floor-label${isSelected ? ' selected' : ''}`}>
                <span>F{String(level).padStart(2, '0')}</span>
              </div>
            </Html>
          </group>
        )
      })}
      {floorLevels.length > 1 && (
        <mesh position={[-4.5, (floorLevels.length - 1) * 0.8, 0]}>
          <boxGeometry args={[0.5, (floorLevels.length - 1) * 1.6 + 0.3, 0.5]} />
          <meshStandardMaterial color="#0f172a" roughness={0.7} />
        </mesh>
      )}
    </group>
  )
}

function DigitalTwinScene({
  props,
  mode,
  onOpenFloor,
  selectedRoom,
  onSelectRoom,
  fireState,
  placementEnabled,
  onPlaceFire,
  selectedElement,
  onSelectElement,
  onPlaceImportedFire,
}: {
  props: BuildingViewerProps
  mode: SceneMode
  onOpenFloor: (level: number) => void
  selectedRoom: RoomLayout | null
  onSelectRoom: RoomSelect
  fireState: FireSimulationState
  placementEnabled: boolean
  onPlaceFire: (source: FireSourceLocation) => void
  selectedElement: ReviewedPlanElement | null
  onSelectElement: (element: ReviewedPlanElement) => void
  onPlaceImportedFire: (nodeId: string, label: string) => void
}) {
  const [hoveredFloor, setHoveredFloor] = useState<number | null>(null)
  const overview = useRef<Group>(null)
  const structure = useRef<Group>(null)
  const detail = useRef<Group>(null)

  return <>
    <color attach="background" args={['#070e14']}/>
    <ambientLight intensity={.75}/><hemisphereLight args={['#effaff', '#17252b', 1.2]}/>
    <Environment resolution={128} background={false}>
      <Lightformer form="rect" intensity={2.4} color="#fff0d8" position={[-5, 8, 4]} scale={[7, 3, 1]} rotation={[0, Math.PI / 4, 0]}/>
      <Lightformer form="rect" intensity={1.7} color="#d9ecff" position={[6, 7, -4]} scale={[5, 4, 1]} rotation={[0, -Math.PI / 4, 0]}/>
      <Lightformer form="ring" intensity={1.2} color="#b8d8ca" position={[0, 9, 0]} scale={5}/>
    </Environment>
    <directionalLight castShadow position={[8, 14, 10]} intensity={2.5} color="#e8f7ff" shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-camera-left={-11} shadow-camera-right={11} shadow-camera-top={16} shadow-camera-bottom={-4} shadow-bias={-.00025}/>
    <spotLight position={[-8, 11, 7]} angle={.52} penumbra={.8} intensity={64} color="#20d39c" distance={28}/><pointLight position={[6, 10, -7]} intensity={30} color="#3589e8" distance={24}/>
    <gridHelper args={[32, 32, '#18323f', '#0c1b22']} position={[0, -.15, 0]}/>

    {/* SCENE RENDERING: Uploaded Plan vs Synthetic Mock */}
    {props.importedPlan ? (
      mode === 'building' ? (
        <ImportedBuildingOverview
          availableFloors={props.availableFloors ?? [props.selectedFloor]}
          selectedFloor={props.selectedFloor}
          hoveredFloor={hoveredFloor}
          onHoverFloor={setHoveredFloor}
          onSelectFloor={onOpenFloor}
          imageWidth={props.importedPlan.imageWidth}
          imageHeight={props.importedPlan.imageHeight}
        />
      ) : (
        <ImportedFloorScene
          plan={props.importedPlan}
          graph={props.graph}
          route={props.route}
          routeStartId={props.routeStartId}
          occupants={props.occupants ?? []}
          fireNodeId={props.fireNodeId}
          fireTime={props.fireTime}
          selectedElementId={selectedElement?.id ?? null}
          onSelectElement={onSelectElement}
          placementEnabled={placementEnabled}
          onPlaceFire={onPlaceImportedFire}
        />
      )
    ) : (
      <>
        <group ref={overview}>
          <group ref={structure}>
            <mesh position={[0, 5.15, 0]} castShadow receiveShadow><boxGeometry args={[.72, 10.2, .72]}/><meshStandardMaterial color="#152b34" emissive="#0a5544" emissiveIntensity={.3} metalness={.55}/></mesh>
            <Box position={[0, 10.5, 0]} size={[6.42, .2, 4.62]} color="#39d0a0" emissive="#117956" emissiveIntensity={.5} castShadow/>
          </group>
          {Array.from({ length: 9 }, (_, index) => index + 1).map((level) => <TowerFloor key={level} level={level} hovered={hoveredFloor === level} onHover={setHoveredFloor} onOpen={onOpenFloor} selectedFloor={props.selectedFloor} mode={mode}/>)}
        </group>
        <group ref={detail} visible={false}>
          <FloorScene floor={props.selectedFloor} selectedRoom={selectedRoom?.id ?? null} occupantCount={props.occupantCount} safeExits={props.safeExits} onEvacuatedChange={props.onEvacuatedChange} onSelectRoom={onSelectRoom} fireState={fireState} placementEnabled={placementEnabled} onPlaceFire={onPlaceFire}/>
        </group>
      </>
    )}

    <ContactShadows position={[0, -.1, 0]} opacity={.4} scale={22} blur={2.4} far={16} resolution={256} frames={1}/>
    <SceneCamera mode={props.importedPlan ? mode : mode}/>
    {!props.importedPlan && <SceneBlend mode={mode} overview={overview} structure={structure} detail={detail}/>}
  </>
}

function BuildingViewer(props: BuildingViewerProps) {
  const [mode, setMode] = useState<SceneMode>(() => props.importedPlan ? 'floor' : 'building')
  const [selectedRoom, setSelectedRoom] = useState<RoomLayout | null>(null)
  const [selectedElement, setSelectedElement] = useState<ReviewedPlanElement | null>(null)
  const [roomNotice, setRoomNotice] = useState<RoomLayout | null>(null)
  const [fireSource, setFireSource] = useState<FireSourceLocation | null>(null)
  const [fireTime, setFireTime] = useState(0)
  const [fireIntensity, setFireIntensity] = useState(1)
  const [smokeDensity, setSmokeDensity] = useState(.65)
  const [firePlaying, setFirePlaying] = useState(false)
  const [placementEnabled, setPlacementEnabled] = useState(false)
  const previousFloor = useRef(props.selectedFloor)
  const lastSimulationRun = useRef(props.simulationRunId)

  useEffect(() => {
    if (props.importedPlan) {
      // Default to floor dollhouse view for imported plans
      setMode('floor')
    }
  }, [props.importedPlan])

  useEffect(() => {
    if (props.simulationRunId === lastSimulationRun.current) return
    lastSimulationRun.current = props.simulationRunId
    const location = props.fireLocation.toLowerCase()
    let source: FireSourceLocation
    if (location.includes('corridor')) source = { id: 'corridor', label: 'CENTRAL CORRIDOR', x: 0, z: 0 }
    else if (location.includes('east stair')) source = { id: 'stair-B', label: 'EAST STAIRWELL', x: 2.67, z: 0 }
    else if (location.includes('west stair')) source = { id: 'stair-A', label: 'WEST STAIRWELL', x: -2.67, z: 0 }
    else if (location.includes('office')) source = { id: 'north-1', label: 'WORKSTATIONS', x: -1.52, z: -1.25 }
    else source = { id: 'north-3', label: 'FOCUS ROOM · EAST BREAKOUT', x: 1.52, z: -1.25 }
    setFireSource(source)
    setFireTime(0)
    setPlacementEnabled(false)
    setFirePlaying(true)
  }, [props.simulationRunId, props.fireLocation])

  useEffect(() => {
    if (previousFloor.current !== props.selectedFloor) {
      setSelectedRoom(null)
      setSelectedElement(null)
      setRoomNotice(null)
      setFireSource(null)
      setFireTime(0)
      setFirePlaying(false)
      setPlacementEnabled(false)
      previousFloor.current = props.selectedFloor
    }
  }, [props.selectedFloor])

  const openFloor = (level: number) => {
    props.onSelectFloor(level)
    setSelectedRoom(null)
    setSelectedElement(null)
    setRoomNotice(null)
    setFireSource(null)
    setFireTime(0)
    setFirePlaying(false)
    setPlacementEnabled(false)
    setMode('floor')
  }

  const placeFire = (source: FireSourceLocation | null) => {
    setFireSource(source)
    setFireTime(0)
    setFirePlaying(false)
    setPlacementEnabled(false)
    if (source) {
      props.onFireLocationChange?.(source.label)
    }
  }

  const handlePlaceImportedFire = (nodeId: string, label: string) => {
    setPlacementEnabled(false)
    props.onSelectFireNode?.(nodeId)
    props.onFireLocationChange?.(label)
  }

  const handleSelectElement = (element: ReviewedPlanElement) => {
    setSelectedElement(element)
    if (element.type === 'room' || element.type === 'corridor') {
      props.onSelectStartNode?.(element.id)
    }
  }

  const selectRoom: RoomSelect = (room) => {
    setSelectedRoom(room)
    setRoomNotice(room)
  }

  const returnToTower = () => { setMode('building'); setSelectedRoom(null); setSelectedElement(null); setRoomNotice(null) }
  const fireState: FireSimulationState = { source: fireSource, time: fireTime, intensity: fireIntensity, smokeDensity }

  useEffect(() => {
    if (mode === 'floor' && props.selectedFloor) {
      setSelectedRoom(null)
    }
  }, [mode, props.selectedFloor])

  const floorLayout = useMemo(() => createMockFloorLayout(props.selectedFloor), [props.selectedFloor])

  return <div className={`building-viewer-shell${mode === 'floor' ? ' floor-scene-open' : ''}`}>
    <div className="building-viewer-topline">
      <div>
        <span className="viewer-live-indicator"/>{' '}
        {props.importedPlan ? 'SAVED FLOOR PLAN · 3D' : 'DIGITAL TWIN'}{' '}
        <span className="viewer-divider">/</span>{' '}
        {props.importedPlan
          ? mode === 'building'
            ? 'BUILDING OVERVIEW · UPLOADED FLOORS'
            : `FLOOR ${String(props.selectedFloor).padStart(2, '0')} · DOLLHOUSE ARCHITECTURE`
          : mode === 'building'
            ? 'NORTH TOWER · 9 FLOORS'
            : `FLOOR ${String(props.selectedFloor).padStart(2, '0')} · DOLLHOUSE VIEW`}
      </div>

      <div className="building-viewer-actions">
        {props.importedPlan ? (
          <>
            {props.availableFloors && props.availableFloors.length > 1 && (
              mode === 'floor' ? (
                <button type="button" onClick={() => setMode('building')}>← BUILDING OVERVIEW</button>
              ) : (
                <button type="button" onClick={() => setMode('floor')}>INSPECT FLOOR {props.selectedFloor} →</button>
              )
            )}
            {props.availableFloors?.length ? (
              <label className="imported-floor-picker">
                FLOOR
                <select value={props.selectedFloor} onChange={(event) => props.onSelectFloor(Number(event.target.value))}>
                  {props.availableFloors.map((floor) => <option key={floor} value={floor}>{floor}</option>)}
                </select>
              </label>
            ) : null}
            {selectedElement && <span className="selected-room-readout">{selectedElement.type.toUpperCase()} · {selectedElement.label}</span>}
          </>
        ) : (
          <>
            {mode === 'floor' && roomNotice && !fireSource && <span className="selected-room-readout">ROOM · {roomNotice.label}</span>}
            {mode === 'floor' ? <button type="button" onClick={returnToTower}>← BACK TO BUILDING</button> : <span>SELECT A FLOOR TO INSPECT</span>}
          </>
        )}
      </div>
    </div>

    {placementEnabled && (
      <div className="fire-placement-banner" role="status">
        <span className="banner-pulse" />
        <strong>FIRE PLACEMENT MODE</strong>
        <span>Click any room in the 3D model, or pick from the dock dropdown below</span>
        <button type="button" onClick={() => setPlacementEnabled(false)}>✕ Cancel</button>
      </div>
    )}

    <Canvas dpr={[1, 1.5]} camera={{ position: [13, 11, 17], fov: 38 }} gl={{ antialias: true, alpha: false }} shadows={{ type: PCFSoftShadowMap }}>
      <DigitalTwinScene
        props={props}
        mode={mode}
        onOpenFloor={openFloor}
        selectedRoom={selectedRoom}
        onSelectRoom={selectRoom}
        fireState={fireState}
        placementEnabled={placementEnabled}
        onPlaceFire={placeFire}
        selectedElement={selectedElement}
        onSelectElement={handleSelectElement}
        onPlaceImportedFire={handlePlaceImportedFire}
      />
    </Canvas>

    {!props.importedPlan && mode === 'floor' && (
      <FireSimulationControls
        state={fireState}
        playing={firePlaying}
        placementEnabled={placementEnabled}
        rooms={floorLayout.rooms}
        onPlayingChange={setFirePlaying}
        onPlacementChange={setPlacementEnabled}
        onSourceChange={placeFire}
        onTimeChange={setFireTime}
        onIntensityChange={setFireIntensity}
        onSmokeDensityChange={setSmokeDensity}
      />
    )}

    <div className="building-viewer-hint">
      {props.importedPlan
        ? mode === 'floor'
          ? (placementEnabled ? 'CLICK ANY ROOM IN 3D TO SET FIRE ORIGIN' : 'CLICK ANY ROOM TO INSPECT & TEST ROUTES · REVIEWED WALLS & DOORS EXTRACTED FROM PLAN')
          : 'SELECT A FLOOR SLAB TO OPEN DETAILED 3D DOLLHOUSE'
        : mode === 'floor'
          ? (placementEnabled ? 'CLICK ANY ROOM OR CORRIDOR TO POSITION THE FIRE' : 'CLICK A ROOM TO INSPECT')
          : 'SELECT FLOOR TO OPEN'}
      <span> · </span> DRAG TO ORBIT <span> · </span> SCROLL TO ZOOM
    </div>
  </div>
}

export default BuildingViewer
