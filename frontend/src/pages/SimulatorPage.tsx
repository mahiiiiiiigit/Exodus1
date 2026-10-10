import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownToLine, Bell, ChevronDown, Clock3, Crosshair, HeartPulse, Layers3, Map, Moon, Radio, Settings2, Siren, SlidersHorizontal, Sun, Users } from 'lucide-react'
const BuildingViewer = lazy(() => import('../components/BuildingViewer'))
import SimulationPanel from '../components/SimulationPanel'
import { floors } from '../data/building'
import { buildEvacuationRoutes } from '../data/routeGeometry'
import { createOccupantAgents } from '../data/occupantMotion'
import { getHealth, runSimulation, type SimulationRequest, type SimulationResponse } from '../services/api'
import '../simulator.css'

function SimulatorPage() {
  const [inputs, setInputs] = useState<SimulationRequest>({
    incident_type: 'fire',
    floor: 4,
    occupant_count: 36,
    fire_location: 'East breakout room',
  })
  const [simulation, setSimulation] = useState<SimulationResponse | null>(null)
  const [viewerEvacuated, setViewerEvacuated] = useState(0)
  const [simulationRunId, setSimulationRunId] = useState(0)
  const [simulationLoading, setSimulationLoading] = useState(false)
  const [simulationError, setSimulationError] = useState<string | null>(null)
  const [animationProgress, setAnimationProgress] = useState(0)
  const [blockedExits, setBlockedExits] = useState<Record<string, number>>({})
  const [notice, setNotice] = useState('')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => window.localStorage.getItem('exodus-theme') === 'light' ? 'light' : 'dark')
  const [healthState, setHealthState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [healthMessage, setHealthMessage] = useState('')
  const currentFloor = floors.find((item) => item.level === inputs.floor) ?? floors[0]
  const evacuationRoutes = simulation ? buildEvacuationRoutes(inputs.fire_location, simulation.safe_exits) : []
  const occupants = useMemo(() => simulation ? createOccupantAgents(simulation, inputs.fire_location, inputs.occupant_count) : [], [simulation, inputs.fire_location, inputs.occupant_count])
  const blockedWeight = occupants.reduce((sum, occupant) => sum + (occupant.trapped ? 0 : (occupant.exit in blockedExits && animationProgress >= blockedExits[occupant.exit] ? occupant.weight : 0)), 0)
  const livePeopleSaved = simulation ? Math.min(simulation.people_saved, viewerEvacuated) : 0
  const livePeopleTrapped = simulation ? Math.min(inputs.occupant_count, simulation.people_trapped + Math.ceil(blockedWeight * simulation.people_saved / Math.max(1, inputs.occupant_count))) : 0
  const isAnimating = Boolean(simulation && animationProgress < 1)
  const estimatedTime = simulation ? `${Math.floor(simulation.evacuation_time_seconds / 60)}m ${String(simulation.evacuation_time_seconds % 60).padStart(2, '0')}s` : ''

  useEffect(() => {
    window.localStorage.setItem('exodus-theme', theme)
  }, [theme])

  useEffect(() => {
    if (!simulation) { setAnimationProgress(0); return }
    setAnimationProgress(0)
    setBlockedExits({})
    const startedAt = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const next = Math.min(1, (now - startedAt) / 12000)
      setAnimationProgress(next)
      if (next < 1) frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [simulation])

  const updateInput = <K extends keyof SimulationRequest>(field: K, value: SimulationRequest[K]) => {
    setInputs((current) => ({ ...current, [field]: value }))
    setSimulation(null)
    setSimulationError(null)
    setAnimationProgress(0)
    setBlockedExits({})
  }

  const handleRunSimulation = async () => {
    setSimulationLoading(true)
    setSimulationError(null)
    setSimulation(null)
    setViewerEvacuated(0)
    setAnimationProgress(0)
    setBlockedExits({})
    try {
      const result = await runSimulation(inputs)
      setSimulation(result)
      setSimulationRunId((current) => current + 1)
    } catch (error) {
      setSimulationError(error instanceof Error ? error.message : 'Unable to reach the simulation API.')
    } finally {
      setSimulationLoading(false)
    }
  }

  const handleViewerEvacuatedChange = useCallback((count: number) => setViewerEvacuated((current) => current === count ? current : count), [])

  const toggleTheme = () => setTheme((current) => current === 'light' ? 'dark' : 'light')
  const checkApiHealth = async () => {
    setHealthState('loading')
    setHealthMessage('Checking…')
    try {
      const result = await getHealth()
      setHealthState('success')
      setHealthMessage(JSON.stringify(result))
    } catch (error) {
      setHealthState('error')
      setHealthMessage(error instanceof Error ? error.message : 'Unable to reach the API')
    }
  }
  const notify = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2600)
  }

  return (
    <div className="simulator-app" data-theme={theme}>
      <aside className="sim-sidebar">
        <Link className="sim-brand" to="/"><span className="sim-brand-mark"><i/><i/><i/></span><span>exodus</span></Link>
        <div className="sim-workspace-label">SIMULATION WORKSPACE</div>
        <Link className="sim-building-switch" to="/buildings/new"><span className="sim-building-symbol"><Layers3 size={17}/></span><span><strong>Building workspace</strong><small>Upload and manage plans</small></span><ChevronDown size={15}/></Link>
        <div className="sim-section-label">SIMULATE</div>
        <nav className="sim-nav"><button className="sim-nav-item active"><Map size={17}/><span>Evacuation plan</span></button><button className="sim-nav-item" onClick={() => notify('Live monitoring view selected')}><Radio size={17}/><span>Live monitoring</span></button><button className="sim-nav-item" onClick={() => notify('Scenario library opened')}><Siren size={17}/><span>Scenarios</span></button><button className="sim-nav-item" onClick={() => notify('Occupant directory opened')}><Users size={17}/><span>Occupants</span></button></nav>
        <div className="sim-sidebar-bottom"><div className={`sim-ai-status ${healthState}`}><span className="sim-ai-pulse"><i/></span><span><strong>Backend API</strong><small>{healthState === 'success' ? 'Connected' : healthState === 'error' ? 'Connection error' : 'Check connection above'}</small></span><b/></div><button className="sim-nav-item" onClick={() => notify('Settings opened')}><Settings2 size={17}/><span>Settings</span></button><div className="sim-profile"><span className="sim-avatar">MC</span><span><strong>Maya Chen</strong><small>Safety coordinator</small></span><ChevronDown size={14}/></div></div>
      </aside>

      <main className="sim-main">
        <header className="sim-topbar"><div className="sim-crumb"><Link to="/">Exodus</Link><b>/</b><strong>Simulator</strong></div><div className="sim-top-actions"><div className={`sim-state-pill ${simulationError ? 'error' : ''}`}><i className={simulationLoading || isAnimating ? 'is-running' : ''}/>{simulationLoading ? 'Simulation running' : isAnimating ? 'Evacuation in progress' : simulation ? 'Simulation complete' : simulationError ? 'Simulation failed' : 'Ready to simulate'}</div><div className={`sim-api-check ${healthState}`}><button type="button" onClick={checkApiHealth} disabled={healthState === 'loading'}><HeartPulse size={14}/>{healthState === 'loading' ? 'Checking API…' : 'Check API'}</button>{healthMessage && <output aria-live="polite">{healthMessage}</output>}</div><button className="sim-theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>{theme === 'light' ? <Moon size={15}/> : <Sun size={15}/>}<span>{theme === 'light' ? 'Dark mode' : 'Light mode'}</span></button><button aria-label="Notifications" onClick={() => notify('No new alerts')}><Bell size={17}/></button><span className="sim-top-divider"/><span className="sim-avatar">MC</span></div></header>

        <div className="sim-workspace">
          <section className="sim-page-heading"><div><div className="sim-overline"><i/> EVACUATION SIMULATOR <span>·</span> SCENARIO</div><h1>North Tower <em>evacuation plan</em></h1><p>Set incident conditions and request an evacuation estimate from the Exodus API.</p></div><div className="sim-heading-actions"><button className="sim-secondary-button" onClick={() => notify('Export is available after a simulation response is generated.')}><ArrowDownToLine size={15}/> Export plan</button><button className="sim-primary-button" onClick={handleRunSimulation} disabled={simulationLoading}><Crosshair size={15}/> Run simulation</button></div></section>

          <div className="sim-toolbar"><div className="sim-tabs"><span className="sim-tab-label"><Map size={14}/> LIVE 3D BUILDING</span></div><div className="sim-toolbar-right"><span><i/>{simulation ? 'Live API results shown' : 'Waiting for simulation'}</span><button aria-label="Map settings" onClick={() => notify('Map settings opened')}><SlidersHorizontal size={15}/></button></div></div>

          <div className="sim-content-grid">
            <section className="sim-map-column">
              <div className="sim-map-card">
                <div className="sim-map-header">
                  <div className="sim-floor-heading"><span><Layers3 size={17}/></span><div><strong>North Tower · 9 floors</strong><small>Interactive office building model</small></div></div>
                  <div className="sim-view-controls"><span><i/> MODEL ONLINE</span><button type="button" className="sim-layer-button" onClick={() => notify('Drag to orbit · scroll to zoom · select a floor to inspect')}>3D controls</button></div>
                </div>
                <Suspense fallback={<div className="building-viewer-loading">Loading 3D building model…</div>}><BuildingViewer selectedFloor={inputs.floor} occupantCount={inputs.occupant_count} fireLocation={inputs.fire_location} simulationRunId={simulationRunId} safeExits={simulation?.safe_exits ?? ['Stairwell A', 'Stairwell B']} onEvacuatedChange={handleViewerEvacuatedChange} onSelectFloor={(floor) => updateInput('floor', floor)} onFireLocationChange={(location) => {
                  const locLower = location.toLowerCase()
                  let mapped = 'East breakout room'
                  if (locLower.includes('corridor')) mapped = 'Central corridor'
                  else if (locLower.includes('stair') && (locLower.includes('b') || locLower.includes('east'))) mapped = 'East stairwell'
                  else if (locLower.includes('stair') && (locLower.includes('a') || locLower.includes('west'))) mapped = 'West stairwell'
                  else if (locLower.includes('workstation') || locLower.includes('office') || locLower.includes('reception') || locLower.includes('huddle')) mapped = 'Office area'
                  else mapped = 'East breakout room'
                  updateInput('fire_location', mapped)
                  notify(`Fire origin placed at ${location}`)
                }}/></Suspense>
                <div className="sim-floor-strip"><strong>SELECT FLOOR</strong><div>{floors.map((item) => <button key={item.level} className={inputs.floor === item.level ? 'selected' : ''} aria-pressed={inputs.floor === item.level} onClick={() => updateInput('floor', item.level)}>{String(item.level).padStart(2, '0')}</button>)}</div><small>{currentFloor.area}</small></div>
              </div>
              {simulation && <section className="sim-route-summary" aria-live="polite"><div className="sim-route-summary-heading"><strong>Generated evacuation routes</strong><span>Estimated geometry</span></div><div className="sim-route-list">{evacuationRoutes.map((route) => <article key={route.exit}><span className="route-summary-icon"><ArrowDownToLine size={14}/></span><span className="route-summary-name"><strong>{route.exit}</strong><small>Via corridor and stairwell</small></span><span className="route-summary-stat"><strong>{route.distanceMeters} m</strong><small>route distance</small></span><span className="route-summary-stat eta"><strong><Clock3 size={12}/>{estimatedTime}</strong><small>estimated evacuation</small></span><button type="button" className={`route-block-toggle${route.exit in blockedExits ? ' active' : ''}`} aria-pressed={route.exit in blockedExits} onClick={() => setBlockedExits((current) => { const next = { ...current }; if (route.exit in next) delete next[route.exit]; else next[route.exit] = animationProgress; return next })}>{route.exit in blockedExits ? 'Restore route' : 'Block route'}</button></article>)}</div></section>}
              <div className="sim-footnote"><span>i</span> Mock 3D geometry · evacuation estimates and outcomes are provided by the Exodus API.</div>
            </section>
            <aside className="sim-panels"><SimulationPanel values={inputs} result={simulation} isLoading={simulationLoading} error={simulationError} onChange={updateInput} onRun={handleRunSimulation} livePeopleSaved={livePeopleSaved} livePeopleTrapped={livePeopleTrapped} isAnimating={isAnimating}/></aside>
          </div>
        </div>
      </main>
      {notice && <div className="sim-toast"><span>✓</span>{notice}</div>}
    </div>
  )
}

export default SimulatorPage
