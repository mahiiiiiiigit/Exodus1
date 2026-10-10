import { Activity, AlertTriangle, Check, ChevronDown, Clock3, Flame, Layers3, LoaderCircle, ShieldAlert, ShieldCheck, Users, Wind } from 'lucide-react'
import type { SimulationRequest, SimulationResponse } from '../services/api'
import { floors } from '../data/building'

interface SimulationPanelProps {
  values: SimulationRequest
  result: SimulationResponse | null
  isLoading: boolean
  error: string | null
  onChange: <K extends keyof SimulationRequest>(field: K, value: SimulationRequest[K]) => void
  onRun: () => void
  livePeopleSaved: number
  livePeopleTrapped: number
  isAnimating: boolean
}

const fireLocations = ['East breakout room', 'Central corridor', 'East stairwell', 'West stairwell', 'Office area']

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${String(remainingSeconds).padStart(2, '0')}s`
}

function SimulationPanel({ values, result, isLoading, error, onChange, onRun, livePeopleSaved, livePeopleTrapped, isAnimating }: SimulationPanelProps) {
  return (
    <>
      <section className="panel scenario-panel">
        <div className="panel-title-row"><div><span className="panel-kicker">SIMULATION INPUTS</span><h2>Incident conditions</h2></div><span className="sim-input-icon"><Activity size={15}/></span></div>
        <label className="field-label" htmlFor="incident-type">Incident type</label>
        <div className="select-wrap"><span className="incident-icon"><Flame size={15}/></span><select id="incident-type" value={values.incident_type} onChange={(event) => onChange('incident_type', event.target.value)}><option value="fire">Fire</option><option value="electrical fire">Electrical fire</option><option value="smoke">Smoke</option><option value="gas leak">Gas leak</option><option value="explosion">Explosion</option><option value="medical emergency">Medical emergency</option></select><ChevronDown size={14}/></div>

        <label className="field-label" htmlFor="floor-select">Floor</label>
        <div className="select-wrap"><span className="strategy-icon"><Layers3 size={15}/></span><select id="floor-select" value={values.floor} onChange={(event) => onChange('floor', Number(event.target.value))}>{floors.map((floor) => <option key={floor.level} value={floor.level}>Floor {floor.label} · {floor.name}</option>)}</select><ChevronDown size={14}/></div>

        <label className="field-label" htmlFor="occupant-count">Occupant count</label>
        <div className="number-wrap"><Users size={15}/><input id="occupant-count" type="number" min={0} max={100000} value={values.occupant_count} onChange={(event) => onChange('occupant_count', Number(event.target.value))}/><span>people</span></div>

        <label className="field-label" htmlFor="fire-location">Fire location</label>
        <div className="select-wrap"><span className="incident-icon"><AlertTriangle size={15}/></span><select id="fire-location" value={values.fire_location} onChange={(event) => onChange('fire_location', event.target.value)}>{fireLocations.map((location) => <option key={location} value={location}>{location}</option>)}</select><ChevronDown size={14}/></div>

        <button className="run-button" onClick={onRun} disabled={isLoading || values.occupant_count < 0}>{isLoading ? <><LoaderCircle className="loading-spinner" size={15}/>Running simulation…</> : <><Activity size={15}/>Run simulation</>}</button>
        {error && <div className="simulation-error" role="alert"><ShieldAlert size={15}/><span><strong>Simulation failed</strong><small>{error}</small></span></div>}
      </section>

      <section className="panel outcome-panel" aria-live="polite">
        <div className="panel-title-row"><div><span className="panel-kicker">LIVE API RESPONSE</span><h2>Evacuation results</h2></div>{result && <span className="live-result-tag"><Check size={11}/> {isAnimating ? 'MOVING' : 'COMPLETE'}</span>}</div>
        {!result && !isLoading && !error && <div className="empty-results"><span><Activity size={17}/></span><p>Set the incident conditions and run a simulation to see the API results here.</p></div>}
        {isLoading && <div className="loading-results"><LoaderCircle className="loading-spinner" size={18}/>Calculating evacuation outcome…</div>}
        {result && <>
          <div className="result-metrics"><div className="result-time"><span>EVACUATION TIME</span><strong><Clock3 size={16}/>{formatTime(result.evacuation_time_seconds)}</strong></div><div className={`risk-score ${result.risk_score >= 75 ? 'critical' : result.risk_score >= 55 ? 'high' : result.risk_score >= 30 ? 'moderate' : 'low'}`}><span>RISK SCORE</span><strong>{result.risk_score}<small>/100</small></strong></div></div>
          <div className="saved-trapped"><div><span className="saved-icon"><ShieldCheck size={14}/></span><span><small>{isAnimating ? 'Evacuated' : 'People saved'}</small><strong>{livePeopleSaved}</strong></span></div><div><span className="trapped-icon"><Users size={14}/></span><span><small>Trapped occupants</small><strong>{livePeopleTrapped}</strong></span></div></div>
          <div className="result-section"><h3><ShieldCheck size={13}/> Safe exits <span>{result.safe_exits.length}</span></h3>{result.safe_exits.length ? <div className="result-chip-list">{result.safe_exits.map((exit) => <span className="safe-exit-chip" key={exit}><Check size={11}/>{exit}</span>)}</div> : <p className="no-zones">No safe exits returned for this scenario.</p>}</div>
          <div className="result-section"><h3><AlertTriangle size={13}/> Congestion zones <span>{result.congestion_zones.length}</span></h3>{result.congestion_zones.length ? <div className="result-chip-list">{result.congestion_zones.map((zone) => <span className="congestion-chip" key={zone}>{zone}</span>)}</div> : <p className="no-zones">No congestion zones predicted.</p>}</div>
          <div className="result-section zones-result"><h3><Wind size={13}/> Zone assessment <span>{result.zones.length}</span></h3><div className="zone-result-list">{result.zones.map((zone) => <div className="zone-result-row" key={zone.zone}><span className={`zone-status-dot ${zone.status}`}/><span className="zone-result-name"><strong>{zone.zone}</strong><small>{zone.estimated_occupants} occupants</small></span><span className={`zone-risk ${zone.risk_level}`}>{zone.risk_level}</span></div>)}</div></div>
        </>}
      </section>
    </>
  )
}

export default SimulationPanel
