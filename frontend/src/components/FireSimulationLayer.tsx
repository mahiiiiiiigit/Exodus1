import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { CSSProperties, Dispatch, SetStateAction } from 'react'
import type { Group, PointLight } from 'three'
import type { RoomLayout } from '../data/mockFloorLayout'

export interface FireSourceLocation {
  id: string
  label: string
  x: number
  z: number
}

export interface FireSimulationState {
  source: FireSourceLocation | null
  time: number
  intensity: number
  smokeDensity: number
}

export interface FireSimulationControlsProps {
  state: FireSimulationState
  playing: boolean
  placementEnabled: boolean
  rooms?: RoomLayout[]
  onPlayingChange: (playing: boolean) => void
  onPlacementChange: (enabled: boolean) => void
  onSourceChange: (source: FireSourceLocation | null) => void
  onTimeChange: Dispatch<SetStateAction<number>>
  onIntensityChange: (value: number) => void
  onSmokeDensityChange: (value: number) => void
}

const timelineMarks = [0, 30, 60, 90, 120]
const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

function formatSeconds(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function FireSimulationControls({ state, playing, placementEnabled, rooms, onPlayingChange, onPlacementChange, onSourceChange, onTimeChange, onIntensityChange, onSmokeDensityChange }: FireSimulationControlsProps) {
  const timelineTime = useRef(state.time)
  useEffect(() => { timelineTime.current = state.time }, [state.time])
  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      const next = Math.min(120, timelineTime.current + 1)
      timelineTime.current = next
      onTimeChange(next)
      if (next >= 120) onPlayingChange(false)
    }, 100)
    return () => window.clearInterval(timer)
  }, [playing, onPlayingChange, onTimeChange])

  return <section className="fire-layer-dock" aria-label="Fire and smoke simulation controls">
    <div className="fire-dock-controls">
      <div className="fire-placement-btn-group">
        <button
          type="button"
          className={`fire-place-toggle${placementEnabled ? ' active' : ''}`}
          onClick={() => onPlacementChange(!placementEnabled)}
          aria-pressed={placementEnabled}
        >
          {placementEnabled ? '✕ CANCEL' : '＋ PLACE FIRE'}
        </button>
        {placementEnabled && rooms && rooms.length > 0 && (
          <select
            className="fire-place-select"
            defaultValue=""
            onChange={(e) => {
              const val = e.target.value
              if (!val) return
              if (val === 'corridor') {
                onSourceChange({ id: 'corridor', label: 'CENTRAL CORRIDOR', x: 0, z: 0 })
              } else if (val === 'stair-A') {
                onSourceChange({ id: 'stair-A', label: 'WEST STAIRWELL', x: -2.67, z: 0 })
              } else if (val === 'stair-B') {
                onSourceChange({ id: 'stair-B', label: 'EAST STAIRWELL', x: 2.67, z: 0 })
              } else {
                const rm = rooms.find((r) => r.id === val)
                if (rm) onSourceChange({ id: rm.id, label: rm.label, x: rm.x, z: rm.z })
              }
              onPlacementChange(false)
            }}
          >
            <option value="">Choose room or click 3D model…</option>
            <option value="corridor">Central Corridor</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
            <option value="stair-A">West Stairwell A</option>
            <option value="stair-B">East Stairwell B</option>
          </select>
        )}
      </div>
      <span className={`fire-source-readout${state.source ? ' has-source' : ''}`}><i/>{state.source ? state.source.label : 'No source selected'}</span>
      <div className="fire-play-controls">
        <button type="button" onClick={() => { onTimeChange(0); onPlayingChange(false) }} disabled={!state.source} aria-label="Reset fire timeline">↺</button>
        <button type="button" className="fire-play-button" onClick={() => onPlayingChange(!playing)} disabled={!state.source} aria-label={playing ? 'Pause simulation' : 'Play simulation'}>{playing ? 'Ⅱ PAUSE' : '▶ PLAY'}</button>
      </div>
      <label className="fire-range-control"><span>FIRE INTENSITY <b>{state.intensity.toFixed(1)}×</b></span><input type="range" min="0.4" max="1.8" step="0.1" value={state.intensity} onChange={(event) => onIntensityChange(Number(event.target.value))}/></label>
      <label className="fire-range-control"><span>SMOKE DENSITY <b>{Math.round(state.smokeDensity * 100)}%</b></span><input type="range" min="0.2" max="1" step="0.05" value={state.smokeDensity} onChange={(event) => onSmokeDensityChange(Number(event.target.value))}/></label>
      <output className="fire-time-readout">T+ {formatSeconds(state.time)}</output>
    </div>
    <div className="fire-timeline-row">
      <span className="fire-timeline-label">SIMULATION TIMELINE</span>
      <div className="fire-timeline-track">
        <input type="range" min="0" max="120" step="1" value={state.time} onChange={(event) => onTimeChange(Number(event.target.value))} disabled={!state.source} aria-label="Simulation timeline in seconds" style={{ '--timeline-progress': `${(state.time / 120) * 100}%` } as CSSProperties}/>
        <div className="fire-timeline-marks">{timelineMarks.map((mark) => <span key={mark} className={state.time >= mark ? 'reached' : ''}>{mark} sec</span>)}</div>
      </div>
      <button type="button" className="fire-clear-button" disabled={!state.source} onClick={() => { onSourceChange(null); onTimeChange(0); onPlayingChange(false); onPlacementChange(false) }}>CLEAR</button>
    </div>
  </section>
}

export interface SmokeZone {
  id: string
  center: [number, number]
  arrival: number
  isCorridor?: boolean
}

export function smokeLevel(zone: SmokeZone, source: FireSourceLocation, time: number, density: number) {
  const arrival = zone.id === source.id ? 8 : zone.arrival
  if (time < arrival) return 0
  const fill = clamp01((time - arrival) / 28)
  const spread = clamp01((time - arrival) / Math.max(18, 54 * (1.2 - density * .65)))
  const originBoost = zone.id === source.id ? .2 : 0
  return clamp01((.08 + fill * .92 + originBoost) * density * spread)
}

export function buildSmokeZones(source: FireSourceLocation, rooms: RoomLayout[], density: number): SmokeZone[] {
  const corridor: SmokeZone = { id: 'corridor', center: [0, 0], arrival: source.id === 'corridor' ? 0 : 12 / density, isCorridor: true }
  const roomZones = rooms.map((room) => {
    const distance = Math.hypot(room.x - source.x, room.z - source.z)
    const arrival = room.id === source.id ? 0 : source.id === 'corridor' ? 15 + distance * 7 : 22 + distance * 5
    return { id: room.id, center: [room.x, room.z] as [number, number], arrival: arrival / density }
  })
  return source.id === 'corridor' ? [corridor, ...roomZones] : [...roomZones, corridor]
}

/* 3D Billowing Smoke Volumetric Puff Cloud */
function BillowingSmokePuffs({ source, time, density }: { source: FireSourceLocation; time: number; density: number }) {
  const group = useRef<Group>(null)
  const puffs = useMemo(() => Array.from({ length: 16 }, (_, i) => ({
    seed: i,
    offsetAngle: (i / 16) * Math.PI * 2,
    radius: 0.1 + (i % 4) * 0.07,
    speed: 0.32 + (i % 5) * 0.12,
    baseSize: 0.22 + (i % 3) * 0.08,
  })), [])

  // Smoke starts after incipient flame has burned for ~4 seconds
  const smokeGrowth = clamp01((time - 4) / 40)

  useFrame(({ clock }) => {
    if (!group.current || smokeGrowth <= 0) return
    const t = clock.elapsedTime
    group.current.children.forEach((child, index) => {
      const p = puffs[index]
      if (!p) return
      const progress = ((t * p.speed + p.seed * 0.2) % 1)
      child.position.y = 0.18 + progress * 0.85
      const drift = Math.sin(t * 1.2 + p.seed) * 0.15 * progress
      child.position.x = Math.cos(p.offsetAngle + t * 0.3) * (p.radius + progress * 0.4) + drift
      child.position.z = Math.sin(p.offsetAngle + t * 0.3) * (p.radius + progress * 0.4)
      const scale = (p.baseSize + progress * 0.45) * (smokeGrowth * 0.95)
      child.scale.setScalar(scale)
      child.rotation.y = t * 0.35 + p.seed
      child.rotation.x = Math.sin(t * 0.3 + p.seed) * 0.25
    })
  })

  if (smokeGrowth <= 0) return null

  const smokeOpacity = Math.min(0.36, (0.06 + density * 0.2) * smokeGrowth)

  return (
    <group ref={group} position={[source.x, 0.1, source.z]} userData={{ skipOpacityBlend: true }}>
      {puffs.map((p) => (
        <mesh key={p.seed} renderOrder={4} userData={{ skipOpacityBlend: true }}>
          <sphereGeometry args={[0.26, 10, 8]} />
          <meshStandardMaterial
            color="#1b2428"
            roughness={0.96}
            metalness={0.04}
            transparent
            opacity={smokeOpacity}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  )
}

/* Ceiling Rolling Smoke Layer for adjacent rooms & corridor */
function CorridorCeilingSmoke({ zones, source, time, density }: { zones: SmokeZone[]; source: FireSourceLocation; time: number; density: number }) {
  if (time < 8) return null
  return (
    <group userData={{ skipOpacityBlend: true }}>
      {zones.map((zone) => {
        const level = smokeLevel(zone, source, time, density)
        if (level < 0.12) return null
        const isCorridor = zone.isCorridor
        const width = isCorridor ? 5.6 : 1.4
        const depth = isCorridor ? 0.65 : 1.15
        return (
          <group key={zone.id} position={[zone.center[0], 0.65 + level * 0.18, zone.center[1]]} userData={{ skipOpacityBlend: true }}>
            <mesh renderOrder={4} userData={{ skipOpacityBlend: true }}>
              <boxGeometry args={[width, 0.22 * level, depth]} />
              <meshStandardMaterial
                color="#182024"
                roughness={0.92}
                transparent
                opacity={Math.min(0.48, level * 0.42)}
                depthWrite={false}
              />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

/* 3D Dynamic Rising Flame Column */
function VolumetricFlameColumn({ source, time, intensity }: { source: FireSourceLocation; time: number; intensity: number }) {
  const flameGroup = useRef<Group>(null)
  const coreMesh = useRef<any>(null)
  const innerFlame = useRef<any>(null)
  const outerFlame = useRef<any>(null)
  const fireLight = useRef<PointLight>(null)

  // Flame growth: at time = 0s, growth is 0 (gentle starter spark, no raging inferno)
  const flameGrowth = clamp01(time / 38)

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const flicker = Math.sin(t * 18.0) * 0.08 + Math.sin(t * 31.0) * 0.06 + Math.cos(t * 7.5) * 0.08
    const currentIntensity = intensity * (1 + flicker)

    if (fireLight.current) {
      fireLight.current.intensity = (0.35 + flameGrowth * 3.8) * currentIntensity
      fireLight.current.distance = 1.2 + flameGrowth * 4.5
    }

    if (coreMesh.current) {
      const baseScale = 0.055 + flameGrowth * 0.22
      const scale = baseScale * (1 + flicker * 0.25)
      coreMesh.current.scale.set(scale, scale * (1.1 + Math.sin(t * 12) * 0.2), scale)
      coreMesh.current.position.y = 0.02 + flameGrowth * 0.06
    }

    if (innerFlame.current) {
      innerFlame.current.rotation.y = t * 2.2
      innerFlame.current.rotation.z = Math.sin(t * 8) * 0.12
      const baseScale = 0.08 + flameGrowth * 0.34
      const s = baseScale * (1 + flicker * 0.2)
      innerFlame.current.scale.set(s, s * (1.3 + Math.sin(t * 9) * 0.35), s)
      innerFlame.current.position.y = 0.05 + flameGrowth * 0.18
    }

    if (outerFlame.current) {
      outerFlame.current.rotation.y = -t * 1.8
      outerFlame.current.rotation.x = Math.cos(t * 7) * 0.1
      const outerGrowth = clamp01((time - 4) / 34)
      const baseScale = outerGrowth * 0.46
      const s = baseScale * (1 + flicker * 0.15)
      outerFlame.current.scale.set(s, s * (1.5 + Math.sin(t * 11) * 0.4), s)
      outerFlame.current.position.y = 0.08 + outerGrowth * 0.22
      outerFlame.current.visible = outerGrowth > 0.02
    }
  })

  const craterRadius = 0.12 + flameGrowth * 0.42
  const craterOpacity = 0.3 + flameGrowth * 0.48

  const ringInner = 0.22 + flameGrowth * 0.52
  const ringOuter = 0.28 + flameGrowth * 0.62
  const ringOpacity = flameGrowth * 0.36

  return (
    <group ref={flameGroup} position={[source.x, 0.12, source.z]} userData={{ skipOpacityBlend: true }}>
      {/* Dynamic Flickering Fire Point Light */}
      <pointLight ref={fireLight} color="#ff7b25" decay={2} castShadow />

      {/* Incandescent White-Hot Plasma Core */}
      <mesh ref={coreMesh} position={[0, 0.02, 0]} renderOrder={5} userData={{ skipOpacityBlend: true }}>
        <sphereGeometry args={[0.22, 16, 12]} />
        <meshBasicMaterial color="#fffbe6" toneMapped={false} />
      </mesh>

      {/* Mid Flame Cone: Blazing Orange */}
      <mesh ref={innerFlame} position={[0, 0.05, 0]} renderOrder={5} userData={{ skipOpacityBlend: true }}>
        <coneGeometry args={[0.28, 0.85, 10]} />
        <meshBasicMaterial color="#ff6e14" transparent opacity={0.88} toneMapped={false} />
      </mesh>

      {/* Outer Flame Cone: Crimson Licks */}
      <mesh ref={outerFlame} position={[0, 0.08, 0]} renderOrder={5} userData={{ skipOpacityBlend: true }}>
        <coneGeometry args={[0.42, 1.15, 10]} />
        <meshBasicMaterial color="#e52610" transparent opacity={0.65} toneMapped={false} />
      </mesh>

      {/* Ground Charred Soot Crater */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} renderOrder={3} userData={{ skipOpacityBlend: true }}>
        <circleGeometry args={[craterRadius, 32]} />
        <meshBasicMaterial color="#0c0704" transparent opacity={craterOpacity} depthWrite={false} />
      </mesh>

      {/* Pulsing Heat Hazard Ring (only when fire expands) */}
      {flameGrowth > 0.05 && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.018, 0]} renderOrder={3} userData={{ skipOpacityBlend: true }}>
          <ringGeometry args={[ringInner, ringOuter, 48]} />
          <meshBasicMaterial color="#ff4411" transparent opacity={ringOpacity} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
    </group>
  )
}

/* Rising Embers & Glowing Spark Particles */
function RisingEmbersParticles({ source, time }: { source: FireSourceLocation; time: number }) {
  const count = 24
  const particles = useMemo(() => Array.from({ length: count }, (_, i) => ({
    id: i,
    speed: 0.55 + (i % 6) * 0.22,
    radius: 0.06 + (i % 5) * 0.06,
    phase: (i / count) * Math.PI * 2,
    size: 0.014 + (i % 4) * 0.006,
  })), [count])

  const emberGroup = useRef<Group>(null)
  const emberGrowth = clamp01((time - 6) / 30)

  useFrame(({ clock }) => {
    if (!emberGroup.current || emberGrowth <= 0) return
    const t = clock.elapsedTime
    emberGroup.current.children.forEach((mesh, i) => {
      const p = particles[i]
      if (!p) return
      const life = ((t * p.speed + p.phase) % 1)
      mesh.position.y = 0.15 + life * 1.4
      mesh.position.x = Math.cos(p.phase + t * 2.2) * (p.radius + life * 0.32)
      mesh.position.z = Math.sin(p.phase + t * 2.2) * (p.radius + life * 0.32)
      const scale = p.size * (1 - life * 0.6) * emberGrowth
      mesh.scale.setScalar(scale)
    })
  })

  if (emberGrowth <= 0) return null

  return (
    <group ref={emberGroup} position={[source.x, 0.15, source.z]} userData={{ skipOpacityBlend: true }}>
      {particles.map((p) => (
        <mesh key={p.id} renderOrder={6} userData={{ skipOpacityBlend: true }}>
          <sphereGeometry args={[1, 6, 6]} />
          <meshBasicMaterial color={p.id % 2 ? '#ffb733' : '#ff5511'} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

export function FireSimulationLayer({ source, rooms, time, intensity, smokeDensity }: { source: FireSourceLocation | null; rooms: RoomLayout[]; time: number; intensity: number; smokeDensity: number }) {
  const zones = useMemo(() => source ? buildSmokeZones(source, rooms, smokeDensity) : [], [source, rooms, smokeDensity])
  if (!source) return null
  return <group userData={{ skipOpacityBlend: true }}>
    <CorridorCeilingSmoke zones={zones} source={source} time={time} density={smokeDensity} />
    <BillowingSmokePuffs source={source} time={time} density={smokeDensity} />
    <RisingEmbersParticles source={source} time={time} />
    <VolumetricFlameColumn source={source} time={time} intensity={intensity} />
  </group>
}
