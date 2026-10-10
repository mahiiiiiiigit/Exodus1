import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, CylinderGeometry, InstancedMesh, MeshStandardMaterial, Object3D, SphereGeometry } from 'three'
import { Html, Line } from '@react-three/drei'
import type { RoomLayout } from '../data/mockFloorLayout'
import type { FireSourceLocation } from './FireSimulationLayer'
import { buildSmokeZones, smokeLevel } from './FireSimulationLayer'

type OccupantStatus = 'safe' | 'moving' | 'evacuated' | 'trapped'

interface OccupantAgent {
  id: string
  roomId: string
  roomName: string
  start: [number, number]
  route: [number, number][]
  departure: number
  duration: number
  dangerAt: number
  represents: number
  status: OccupantStatus
  position: [number, number]
  exit: string | null
}

const statusColors: Record<OccupantStatus, Color> = {
  safe: new Color('#00e5ff'),
  moving: new Color('#ffaa00'),
  evacuated: new Color('#00e676'),
  trapped: new Color('#ff2442'),
}

function clamp01(value: number) { return Math.max(0, Math.min(1, value)) }

function pointOnRoute(route: [number, number][], progress: number): [number, number] {
  const lengths = route.slice(1).map((point, index) => Math.hypot(point[0] - route[index][0], point[1] - route[index][1]))
  const total = lengths.reduce((sum, length) => sum + length, 0)
  let distance = clamp01(progress) * total
  for (let index = 0; index < lengths.length; index += 1) {
    if (distance <= lengths[index] || index === lengths.length - 1) {
      const amount = lengths[index] ? distance / lengths[index] : 1
      return [route[index][0] + (route[index + 1][0] - route[index][0]) * amount, route[index][1] + (route[index + 1][1] - route[index][1]) * amount]
    }
    distance -= lengths[index]
  }
  return route[route.length - 1]
}

function getSmokeAt(point: [number, number], source: FireSourceLocation, time: number, density: number) {
  const distance = Math.hypot(point[0] - source.x, point[1] - source.z)
  const zone = { id: 'corridor', center: [0, 0] as [number, number], arrival: source.id === 'corridor' ? 0 : 12 / density, isCorridor: true }
  const base = smokeLevel(zone, source, time, density)
  const localArrival = source.id === 'corridor' ? Math.max(0, distance * 6 / density) : Math.max(0, (distance - .55) * 7 / density)
  const localFill = clamp01((time - localArrival) / 28)
  return Math.max(base * .25, localFill * base * Math.exp(-distance * .12))
}

function shortestSafeRoute(start: [number, number], room: RoomLayout, source: FireSourceLocation, time: number, density: number, safeExits: string[]) {
  const candidates = safeExits.map((name) => ({
    name,
    x: /\bA\b|west/i.test(name) ? -2.67 : /\bB\b|east/i.test(name) ? 2.67 : null,
  })).filter((item): item is { name: string; x: number } => item.x !== null)
  const exits = candidates.length ? candidates : [{ name: 'Stairwell A', x: -2.67 }, { name: 'Stairwell B', x: 2.67 }]
  const doorZ = room.z < 0 ? -.725 : .725
  const entry: [number, number] = [room.x, 0]
  const initial: [number, number][] = [start, [start[0], doorZ], entry]
  let best: { route: [number, number][]; exit: string; cost: number } | null = null

  for (const exit of exits) {
    const direction = Math.sign(exit.x - entry[0]) || 1
    const route = [...initial]
    let x = entry[0]
    let cost = Math.hypot(start[0] - room.x, start[1] - doorZ) + Math.abs(doorZ)
    let blocked = false
    while (Math.abs(exit.x - x) > .001) {
      const nextX = x + direction * Math.min(.3, Math.abs(exit.x - x))
      const midpoint: [number, number] = [(x + nextX) / 2, 0]
      const fireDistance = Math.hypot(midpoint[0] - source.x, midpoint[1] - source.z)
      const smoke = getSmokeAt(midpoint, source, time, density)
      if (fireDistance < .46 || smoke > .86) { blocked = true; break }
      cost += Math.abs(nextX - x) * (1 + smoke * 3)
      route.push([nextX, 0])
      x = nextX
    }
    if (blocked) continue
    route.push([exit.x, .66])
    cost += .66
    if (!best || cost < best.cost) best = { route, exit: exit.name, cost }
  }
  return best
}

function makeAgents(rooms: RoomLayout[], count: number, source: FireSourceLocation | null, time: number, smokeDensity: number, safeExits: string[]): OccupantAgent[] {
  const visibleCount = Math.max(0, Math.round(count))
  if (!visibleCount || !rooms.length) return []
  const weights = rooms.map((room) => ({
    room,
    weight: ({ workstation: .33, meeting: .14, focus: .09, reception: .11, huddle: .13, office: .2 } as const)[room.type],
  }))
  const totalWeight = weights.reduce((sum, item) => sum + item.weight, 0)
  const assignments = Array.from({ length: visibleCount }, (_, index) => {
    const share = (index + .5) / visibleCount
    let cumulative = 0
    return weights.find(({ weight }) => { cumulative += weight / totalWeight; return share <= cumulative })?.room ?? rooms[rooms.length - 1]
  })
  const perRoom = new Map<string, number>()
  const roomTotals = new Map<string, number>()
  assignments.forEach((room) => roomTotals.set(room.id, (roomTotals.get(room.id) ?? 0) + 1))
  const represents = count / visibleCount

  return assignments.map((room, index) => {
    const roomIndex = perRoom.get(room.id) ?? 0
    perRoom.set(room.id, roomIndex + 1)
    const occupantsInRoom = roomTotals.get(room.id) ?? 1
    const columns = Math.max(2, Math.ceil(Math.sqrt(occupantsInRoom * room.width / room.depth)))
    const rows = Math.max(1, Math.ceil(occupantsInRoom / columns))
    const column = roomIndex % columns
    const row = Math.floor(roomIndex / columns)
    const jitterX = Math.sin((index + 1) * 12.9898) * .035
    const jitterZ = Math.cos((index + 1) * 4.1414) * .035
    const start: [number, number] = [
      room.x + ((column + .5) / columns - .5) * (room.width - .28) + jitterX,
      room.z + ((row + .5) / rows - .5) * (room.depth - .28) + jitterZ,
    ]
    const path = source ? shortestSafeRoute(start, room, source, time, smokeDensity, safeExits) : null
    const route = path?.route ?? [start]
    const distance = route.slice(1).reduce((sum, point, routeIndex) => sum + Math.hypot(point[0] - route[routeIndex][0], point[1] - route[routeIndex][1]), 0)
    const departure = source ? 4 + (roomIndex % 4) * 1.5 : Number.POSITIVE_INFINITY
    const duration = 18 + distance * 8
    const roomZone = source ? buildSmokeZones(source, rooms, smokeDensity).find((zone) => zone.id === room.id) : undefined
    const smokeArrival = roomZone?.arrival ?? Number.POSITIVE_INFINITY
    const dangerAt = smokeArrival + (room.id === source?.id ? 30 : 44)
    const timeProgress = clamp01((time - departure) / duration)
    let status: OccupantStatus = 'safe'
    let position = start
    if (source && time >= departure) {
      if (!path) {
        status = 'trapped'
      } else if (timeProgress >= 1) {
        status = 'evacuated'
        position = route[route.length - 1]
      } else {
        status = 'moving'
        position = pointOnRoute(route, timeProgress)
      }
    }
    if (source && time >= dangerAt && status !== 'evacuated' && status !== 'trapped') status = 'trapped'
    return { id: `EX-${String(index + 1).padStart(4, '0')}`, roomId: room.id, roomName: room.label, start, route, departure, duration, dangerAt, represents, status, position, exit: path?.exit ?? null }
  })
}

/* Minimalist Floating Glassmorphic Room Badges */
function SleekRoomBadges({ rooms, agents }: { rooms: RoomLayout[]; agents: OccupantAgent[] }) {
  return (
    <group>
      {rooms.map((room) => {
        const assigned = agents.filter((agent) => agent.roomId === room.id)
        if (!assigned.length) return null
        const total = Math.round(assigned.reduce((sum, a) => sum + a.represents, 0))
        const anyTrapped = assigned.some((a) => a.status === 'trapped')
        const anyMoving = assigned.some((a) => a.status === 'moving')

        return (
          <mesh key={`badge-${room.id}`} position={[room.x, 1.05, room.z]} raycast={() => null}>
            <Html center distanceFactor={8} className="occupant-room-badge">
              <span className={`room-badge-pill${anyTrapped ? ' has-trapped' : anyMoving ? ' is-evacuating' : ''}`}>
                <i className="badge-dot" />
                <strong className="badge-name">{room.label}</strong>
                <span className="badge-count">{total}</span>
              </span>
            </Html>
          </mesh>
        )
      })}
    </group>
  )
}

/* Glowing Holographic Route Guide Ribbons on the Floor */
function EvacuationRouteRibbons({ agents }: { agents: OccupantAgent[] }) {
  const routes = useMemo(() => {
    const seen = new Set<string>()
    const active: { id: string; points: [number, number, number][] }[] = []
    agents.forEach((agent) => {
      if (agent.route.length > 2 && agent.exit && !seen.has(agent.roomId)) {
        seen.add(agent.roomId)
        const pts = agent.route.map((p) => [p[0], 0.165, p[1]] as [number, number, number])
        active.push({ id: agent.roomId, points: pts })
      }
    })
    return active
  }, [agents])

  if (!routes.length) return null

  return (
    <group>
      {routes.map((r) => (
        <Line
          key={r.id}
          points={r.points}
          color="#00e5ff"
          lineWidth={2.2}
          dashed
          dashSize={0.12}
          gapSize={0.06}
        />
      ))}
    </group>
  )
}

export function OccupantVisualizationLayer({ rooms, count, source, time, smokeDensity, safeExits, onEvacuatedChange }: { rooms: RoomLayout[]; count: number; source: FireSourceLocation | null; time: number; smokeDensity: number; safeExits: string[]; onEvacuatedChange?: (count: number) => void }) {
  const agents = useMemo(() => makeAgents(rooms, count, source, time, smokeDensity, safeExits), [rooms, count, source, time, smokeDensity, safeExits])
  const bodyMesh = useRef<InstancedMesh>(null)
  const headMesh = useRef<InstancedMesh>(null)

  const bodyDummy = useMemo(() => new Object3D(), [])
  const headDummy = useMemo(() => new Object3D(), [])

  const bodyGeometry = useMemo(() => new CylinderGeometry(0.038, 0.038, 0.13, 8), [])
  const headGeometry = useMemo(() => new SphereGeometry(0.036, 12, 10), [])

  const bodyMaterial = useMemo(() => new MeshStandardMaterial({ roughness: 0.35, metalness: 0.4 }), [])
  const headMaterial = useMemo(() => new MeshStandardMaterial({ roughness: 0.25, metalness: 0.5 }), [])

  const [hoveredAgent, setHoveredAgent] = useState<number | null>(null)
  const evacuatedCount = agents.reduce((sum, agent) => sum + (agent.status === 'evacuated' ? agent.represents : 0), 0)

  useEffect(() => { onEvacuatedChange?.(Math.floor(evacuatedCount)) }, [evacuatedCount, onEvacuatedChange])

  useFrame(({ clock }) => {
    if (!bodyMesh.current || !headMesh.current) return
    const t = clock.elapsedTime

    agents.forEach((agent, index) => {
      const isMoving = agent.status === 'moving'
      const isTrapped = agent.status === 'trapped'

      // Walking vertical bobbing when moving
      const walkingBob = isMoving ? Math.abs(Math.sin(t * 14.0 + index)) * 0.025 : 0
      const trappedPulse = isTrapped ? (1 + Math.sin(t * 8.0) * 0.15) : 1
      const yBase = 0.21 + walkingBob

      // Body Capsule
      bodyDummy.position.set(agent.position[0], yBase, agent.position[1])
      bodyDummy.scale.set(trappedPulse, trappedPulse, trappedPulse)
      bodyDummy.updateMatrix()
      bodyMesh.current!.setMatrixAt(index, bodyDummy.matrix)
      bodyMesh.current!.setColorAt(index, statusColors[agent.status])

      // Head Sphere
      headDummy.position.set(agent.position[0], yBase + 0.095, agent.position[1])
      headDummy.scale.set(trappedPulse, trappedPulse, trappedPulse)
      headDummy.updateMatrix()
      headMesh.current!.setMatrixAt(index, headDummy.matrix)
      headMesh.current!.setColorAt(index, statusColors[agent.status])
    })

    bodyMesh.current.count = agents.length
    headMesh.current.count = agents.length

    bodyMesh.current.instanceMatrix.needsUpdate = true
    headMesh.current.instanceMatrix.needsUpdate = true

    if (bodyMesh.current.instanceColor) bodyMesh.current.instanceColor.needsUpdate = true
    if (headMesh.current.instanceColor) headMesh.current.instanceColor.needsUpdate = true
  })

  const hovered = hoveredAgent === null ? null : agents[hoveredAgent]

  return (
    <group>
      {/* 3D Humanoid Body Cylinders */}
      <instancedMesh
        ref={bodyMesh}
        args={[bodyGeometry, bodyMaterial, Math.max(1, agents.length)]}
        frustumCulled={false}
        onPointerMove={(event) => {
          const id = event.instanceId
          if (id === undefined || id >= agents.length) return
          setHoveredAgent((current) => current === id ? current : id)
          document.body.style.cursor = 'help'
        }}
        onPointerOut={() => { setHoveredAgent(null); document.body.style.cursor = 'auto' }}
      />

      {/* 3D Humanoid Heads */}
      <instancedMesh
        ref={headMesh}
        args={[headGeometry, headMaterial, Math.max(1, agents.length)]}
        frustumCulled={false}
      />

      {/* Glowing Route Ribbons along corridors */}
      <EvacuationRouteRibbons agents={agents} />

      {/* Sleek Minimalist Room Badges */}
      <SleekRoomBadges rooms={rooms} agents={agents} />

      {/* Hover Info Tag */}
      {hovered && (
        <Html position={[hovered.position[0], 0.7, hovered.position[1]]} center distanceFactor={7} className={`occupant-id-tag ${hovered.status}`}>
          <span>{hovered.id}</span>
          <b>{hovered.status.toUpperCase()}</b>
          <small>{hovered.roomName}</small>
        </Html>
      )}
    </group>
  )
}
