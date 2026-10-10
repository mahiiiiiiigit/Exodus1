import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight, Building2, FileImage, FileText, Flame, Layers3, Moon, Pause, Play, RotateCcw, ScanLine, Sun, X } from 'lucide-react'
import { advanceFirePropagation, analyzeFloorPlan, buildingDocumentUrl, createEvacuationGraph, getBuilding, getEvacuationGraph, getEvacuationRoute, getFloorPlanAnalysis, initializeManualReview, type BuildingRecord, type EvacuationGraphResponse, type EvacuationNode, type FloorDocument, type FloorPlanAnalysis, type PlanDetection } from '../services/api'
import { getFloorPlanSource, saveFloorPlanReview, type FloorPlanSource, type ReviewedPlanElement } from '../services/api'
import { FloorPlanReview } from '../components/FloorPlanReview'
import BuildingViewer from '../components/BuildingViewer'
import './building-pages.css'
import './floorplan-analysis.css'
import './evacuation-graph.css'
import './evacuation-hazards.css'
import './graph-occupants.css'
import './building-workspace-tabs.css'
import { advanceOccupants, backendRouteEdgeKeys, createGraphOccupants, occupantPosition, playbackTransition, validatedRoutesForStart, validateBackendRoute, type GraphOccupant } from '../data/graphOccupants'

function BuildingWorkspacePage() {
  const { buildingId = '' } = useParams()
  const [building, setBuilding] = useState<BuildingRecord | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedDocument, setSelectedDocument] = useState<FloorDocument | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [activeTab, setActiveTab] = useState<'review' | 'simulation'>('review')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => window.localStorage.getItem('exodus-theme') === 'dark' ? 'dark' : 'light')
  const [analysis, setAnalysis] = useState<FloorPlanAnalysis | null>(null)
  const [sourcePage, setSourcePage] = useState<FloorPlanSource | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [savingReview, setSavingReview] = useState(false)
  const [reviewDirty, setReviewDirty] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [graphResponse, setGraphResponse] = useState<EvacuationGraphResponse | null>(null)
  const [routeSummary, setRouteSummary] = useState<EvacuationGraphResponse['routes']>(null)
  const [startNodeId, setStartNodeId] = useState('')
  const [fireNodeId, setFireNodeId] = useState('')
  const [fireTime, setFireTime] = useState(0)
  const [firePlaying, setFirePlaying] = useState(false)
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphError, setGraphError] = useState('')
  const [occupantCount, setOccupantCount] = useState(24)
  const [occupantRoomId, setOccupantRoomId] = useState('')
  const [occupantExitId, setOccupantExitId] = useState('')
  const [occupants, setOccupants] = useState<GraphOccupant[]>([])
  const [occupantsPlaying, setOccupantsPlaying] = useState(false)
  const [occupantClock, setOccupantClock] = useState(0)
  const [occupantRouteSummary, setOccupantRouteSummary] = useState<EvacuationGraphResponse['routes']>(null)
  const [occupantRouteError, setOccupantRouteError] = useState('')
  const [occupantRouteLoading, setOccupantRouteLoading] = useState(false)

  useEffect(() => {
    window.localStorage.setItem('exodus-theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme((current) => current === 'light' ? 'dark' : 'light')

  useEffect(() => {
    let active = true
    setLoading(true)
    getBuilding(buildingId).then((record) => { if (active) setBuilding(record) }).catch((requestError) => {
      if (active) setError(requestError instanceof Error ? requestError.message : 'Could not load this building.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [buildingId])

  useEffect(() => {
    let active = true
    setAnalysis(null)
    setReviewDirty(false)
    setAnalysisError('')
    setSourcePage(null)
    if (!selectedDocument) return () => { active = false }
    getFloorPlanSource(buildingId, selectedDocument.id, pageNumber).then((result) => { if (active) setSourcePage(result) }).catch((requestError) => { if (active) setAnalysisError(requestError instanceof Error ? requestError.message : 'Could not load the source page.') })
    getFloorPlanAnalysis(buildingId, selectedDocument.id, pageNumber).then((result) => { if (active) setAnalysis(result.model ? result : null) }).catch(() => { if (active) setAnalysis(null) })
    return () => { active = false }
  }, [buildingId, selectedDocument, pageNumber])

  useEffect(() => {
    let active = true
    setGraphResponse(null)
    setRouteSummary(null)
    setFireTime(0)
    setFirePlaying(false)
    setGraphError('')
    if (!selectedDocument) return () => { active = false }
    getEvacuationGraph(buildingId, selectedDocument.id, pageNumber).then((result) => {
      if (!active) return
      setGraphResponse(result)
      setFireTime(result.graph.fire?.elapsed_seconds ?? 0)
      const nodes = result.graph.nodes
      setStartNodeId((current) => nodes.some((node) => node.id === current) ? current : (nodes.find((node) => node.type === 'room') ?? nodes.find((node) => node.type === 'corridor'))?.id ?? '')
      setFireNodeId((current) => nodes.some((node) => node.id === current) ? current : nodes.find((node) => node.type === 'room')?.id ?? nodes.find((node) => node.type === 'corridor')?.id ?? '')
      setOccupants([])
      setOccupantsPlaying(false)
      setOccupantExitId('')
      if (nodes.length > 0) {
        setActiveTab('simulation')
      }
    }).catch((requestError) => {
      if (active) {
        setGraphResponse(null)
        setGraphError(requestError instanceof Error ? requestError.message : 'Saved graph is missing or outdated. Generate it again from the saved review.')
      }
    })
    return () => { active = false }
  }, [buildingId, selectedDocument, pageNumber])

  useEffect(() => {
    let active = true
    if (!graphResponse || !startNodeId || !selectedDocument || firePlaying) return
    getEvacuationRoute(buildingId, selectedDocument.id, startNodeId, pageNumber)
      .then((result) => { if (active) setRouteSummary(result.routes ?? null) })
      .catch((requestError) => { if (active) setGraphError(requestError instanceof Error ? requestError.message : 'Could not calculate routes.') })
    return () => { active = false }
  }, [buildingId, graphResponse, startNodeId, pageNumber, firePlaying, selectedDocument])

  useEffect(() => {
    let active = true
    setOccupantRouteSummary(null)
    setOccupantRouteError('')
    setOccupantRouteLoading(Boolean(graphResponse && occupantRoomId && selectedDocument))
    if (!graphResponse || !occupantRoomId || !selectedDocument) return () => { active = false }
    getEvacuationRoute(buildingId, selectedDocument.id, occupantRoomId, pageNumber)
      .then((result) => { if (active) setOccupantRouteSummary(result.routes ?? null) })
      .catch((requestError) => { if (active) setOccupantRouteError(requestError instanceof Error ? requestError.message : 'Could not load a backend route for this room.') })
      .finally(() => { if (active) setOccupantRouteLoading(false) })
    return () => { active = false }
  }, [buildingId, graphResponse, occupantRoomId, pageNumber, selectedDocument])

  const runAnalysis = async () => {
    if (!selectedDocument || analyzing) return
    setAnalyzing(true)
    setAnalysisError('')
    try {
      const result = await analyzeFloorPlan(buildingId, selectedDocument.id, pageNumber)
      setAnalysis(result)
      setReviewDirty(false)
      setGraphResponse(null)
      setRouteSummary(null)
      setOccupants([])
      setOccupantsPlaying(false)
      setOccupantExitId('')
      setFireTime(0)
    } catch (requestError) {
      setAnalysisError(requestError instanceof Error ? requestError.message : 'Could not analyze this plan.')
    } finally {
      setAnalyzing(false)
    }
  }

  const startManualReview = async () => {
    if (!selectedDocument || analyzing) return
    setAnalyzing(true)
    setAnalysisError('')
    try {
      const result = await initializeManualReview(buildingId, selectedDocument.id, pageNumber)
      setAnalysis(result)
      setReviewDirty(false)
      setGraphResponse(null)
      setRouteSummary(null)
      setOccupants([])
      setOccupantsPlaying(false)
      setOccupantExitId('')
      setFireTime(0)
    } catch (requestError) {
      setAnalysisError(requestError instanceof Error ? requestError.message : 'Could not initialize manual review.')
    } finally {
      setAnalyzing(false)
    }
  }

  const saveReview = async (elements: ReviewedPlanElement[], rejectedCandidateIds: string[]) => {
    if (!selectedDocument || !analysis) return
    setSavingReview(true)
    setGraphError('')
    try {
      const result = await saveFloorPlanReview(buildingId, selectedDocument.id, pageNumber, elements, rejectedCandidateIds)
      const collectionFor: Record<ReviewedPlanElement['type'], PlanDetection[]> = { room: [], wall: [], unknown: [], corridor: [], door: [], opening: [], stairs: [], exit: [] }
      elements.forEach((element) => collectionFor[element.type].push({ id: element.id, type: element.type, label: element.label, bbox: element.bbox, polygon: element.polygon, confidence: 1, review_status: 'confirmed' }))
      setAnalysis((current) => current ? { ...current, elements: result.elements, candidates: result.candidates, validated: result.validated, rooms: collectionFor.room, corridors: collectionFor.corridor, doors: collectionFor.door, openings: collectionFor.opening, stairs: collectionFor.stairs, exits: collectionFor.exit } : current)
      setReviewDirty(false)
      setOccupants([])
      setOccupantsPlaying(false)
      setOccupantExitId('')
      setOccupantClock(0)
      setGraphResponse(null)
      setRouteSummary(null)
      setGraphLoading(true)
      try {
        const refreshed = await createEvacuationGraph(buildingId, selectedDocument.id, pageNumber)
        setGraphResponse(refreshed)
        setRouteSummary(refreshed.routes ?? null)
        setGraphError('')
        const start = (refreshed.graph.nodes.find((node) => node.type === 'room') ?? refreshed.graph.nodes.find((node) => node.type === 'corridor'))?.id ?? ''
        setStartNodeId(start)
        setFireNodeId(refreshed.graph.nodes.find((node) => node.type === 'room')?.id ?? start)
        setFireTime(0)
        setActiveTab('simulation')
      } catch (graphRequestError) {
        setGraphResponse(null)
        setRouteSummary(null)
        setGraphError(`Geometry was saved, but graph regeneration failed: ${graphRequestError instanceof Error ? graphRequestError.message : 'Unknown graph error.'}`)
      } finally {
        setGraphLoading(false)
      }
    } catch (requestError) {
      setGraphError(requestError instanceof Error ? requestError.message : 'Could not save the plan review.')
    } finally {
      setSavingReview(false)
    }
  }

  const generateGraph = async () => {
    if (!selectedDocument || !analysis?.validated) return
    setGraphLoading(true)
    setGraphError('')
    setFirePlaying(false)
    try {
      const result = await createEvacuationGraph(buildingId, selectedDocument.id, pageNumber)
      setGraphResponse(result)
      setRouteSummary(result.routes ?? null)
      setOccupants([])
      setOccupantsPlaying(false)
      setOccupantExitId('')
      const start = (result.graph.nodes.find((node) => node.type === 'room') ?? result.graph.nodes.find((node) => node.type === 'corridor'))?.id ?? ''
      const source = result.graph.nodes.find((node) => node.type === 'room')?.id ?? result.graph.nodes.find((node) => node.type === 'corridor')?.id ?? ''
      setStartNodeId(start)
      setFireNodeId(source)
      setFireTime(0)
      setActiveTab('simulation')
    } catch (requestError) {
      setGraphError(requestError instanceof Error ? requestError.message : 'Could not create the evacuation graph.')
    } finally {
      setGraphLoading(false)
    }
  }

  useEffect(() => {
    if (!firePlaying || !selectedDocument || !graphResponse || !fireNodeId || !startNodeId) return
    const nextTime = Math.min(600, fireTime + 5)
    const timer = window.setTimeout(() => {
      advanceFirePropagation(buildingId, selectedDocument.id, pageNumber, fireNodeId, startNodeId, nextTime)
        .then((result) => {
          setGraphResponse(result)
          setRouteSummary(result.routes ?? null)
          setFireTime(nextTime)
          if (nextTime >= 600) setFirePlaying(false)
        })
        .catch((requestError) => {
          setGraphError(requestError instanceof Error ? requestError.message : 'Fire propagation update failed.')
          setFirePlaying(false)
        })
    }, 500)
    return () => window.clearTimeout(timer)
  }, [firePlaying, fireTime, selectedDocument, graphResponse, fireNodeId, startNodeId, buildingId, pageNumber])

  useEffect(() => {
    if (!graphResponse) return
    const rooms = graphResponse.graph.nodes.filter((node) => node.type === 'room')
    setOccupantRoomId((current) => rooms.some((room) => room.id === current) ? current : rooms[0]?.id ?? '')
    setOccupants((current) => current.length ? advanceOccupants(current, graphResponse.graph, 0) : current)
  }, [graphResponse])

  useEffect(() => {
    if (!occupantsPlaying) return
    const timer = window.setInterval(() => {
      setOccupantClock((clock) => clock + 0.25)
      setOccupants((current) => {
        return advanceOccupants(current, graphResponse?.graph ?? { nodes: [], edges: [], adjacency: {} }, 0.25)
      })
    }, 250)
    return () => window.clearInterval(timer)
  }, [occupantsPlaying, graphResponse])

  useEffect(() => {
    setOccupantsPlaying((playing) => playbackTransition(playing, 'tick', occupants))
  }, [occupants])

  const resetFire = async () => {
    if (!selectedDocument || !graphResponse || !fireNodeId || !startNodeId) return
    setFirePlaying(false)
    setGraphError('')
    try {
      const result = await advanceFirePropagation(buildingId, selectedDocument.id, pageNumber, fireNodeId, startNodeId, 0)
      setGraphResponse(result)
      setRouteSummary(result.routes ?? null)
      setFireTime(0)
    } catch (requestError) {
      setGraphError(requestError instanceof Error ? requestError.message : 'Could not reset fire propagation.')
    }
  }

  if (loading) return <main className="building-pages" data-theme={theme}><div className="building-page-state">Loading building workspace…</div></main>
  if (error || !building) return <main className="building-pages" data-theme={theme}><div className="building-page-state error">{error || 'Building not found.'}<Link to="/buildings/new">Upload building plans</Link></div></main>

  const documentCount = building.floors.reduce((total, floor) => total + floor.documents.length, 0)
  const graph = graphResponse?.graph
  const nodeMap = new Map(graph?.nodes.map((node) => [node.id, node]) ?? [])
  const nearestValidation = graph ? validateBackendRoute(graph, routeSummary?.nearest_exit, startNodeId) : null
  const nearestPairs = nearestValidation?.valid ? nearestValidation.edgeKeys : new Set<string>()
  const alternatePairs = new Set(graph ? (routeSummary?.alternate_exits ?? []).flatMap((route) => [...backendRouteEdgeKeys(graph, route, routeSummary?.start_node_id ?? startNodeId)]) : [])
  const occupantAvailableRoutes = graph ? validatedRoutesForStart(graph, occupantRouteSummary, occupantRoomId) : []
  const occupantRoute = occupantAvailableRoutes.find((route) => route.exit_id === occupantExitId) ?? occupantAvailableRoutes[0] ?? null
  const occupantRouteValidation = graph ? validateBackendRoute(graph, occupantRoute, occupantRoomId) : null
  const viewerRoute = occupantRoomId ? (occupantRouteValidation?.valid ? occupantRoute : null) : (nearestValidation?.valid ? routeSummary?.nearest_exit ?? null : null)
  const viewerRouteStart = occupantRoomId || startNodeId
  const occupantRoutePairs = graph && occupantRouteValidation?.valid ? occupantRouteValidation.edgeKeys : new Set<string>()
  const blockedOccupantConnections = graph && occupantRouteSummary?.start_node_id === occupantRoomId
    ? occupantRouteSummary.blocked_edges.map((edge) => `${nodeMap.get(edge.from)?.label ?? edge.from} ↔ ${nodeMap.get(edge.to)?.label ?? edge.to}`).join(', ')
    : ''
  const graphSelectableNodes = graph?.nodes.filter((node) => node.type === 'room' || node.type === 'corridor') ?? []
  const occupantRooms = graph?.nodes.filter((node) => node.type === 'room') ?? []
  const occupantNodeMap = new Map(graph?.nodes.map((node) => [node.id, node]) ?? [])
  const graphOverlay = graph && <g className={`graph-overlay${occupants.length ? ' with-occupants' : ''}`}>
    {graph.edges.map((edge) => {
      const from = nodeMap.get(edge.from), to = nodeMap.get(edge.to)
      if (!from?.bbox || !to?.bbox) return null
      const [x1, y1] = nodeCenter(from), [x2, y2] = nodeCenter(to)
      const edgeKey = [edge.from, edge.to].sort().join('::')
      return <line key={`${edge.from}-${edge.to}`} className={`graph-edge${edge.blocked ? ' blocked' : ''}${nearestPairs.has(edgeKey) || occupantRoutePairs.has(edgeKey) ? ' on-route' : ''}${alternatePairs.has(edgeKey) ? ' alternate-route' : ''}`} x1={x1} y1={y1} x2={x2} y2={y2}><title>{edge.relation} · {edge.length.toFixed(3)} plan units{edge.blocked ? ' · blocked' : ''}</title></line>
    })}
    {graph.nodes.map((node) => {
      if (!node.bbox) return null
      const [cx, cy] = nodeCenter(node)
      return <g key={node.id} className={`graph-node ${node.status} ${node.type}`}><circle cx={cx} cy={cy} r={node.type === 'exit' ? .012 : .008}/><title>{node.label} · {node.status} · {Math.round(node.confidence * 100)}% reviewed confidence</title></g>
    })}
    {occupants.map((occupant) => { const [cx, cy] = occupantPosition(occupant, graph); return <g key={occupant.id} className={`graph-occupant-marker ${occupant.status}`} transform={`translate(${cx} ${cy})`}><circle className="occupant-marker-halo" r=".014"/><circle className="occupant-marker-head" cy="-.007" r=".005"/><path className="occupant-marker-body" d="M 0 -.001 L 0 .008 M -.005 .002 L .005 .002 M 0 .008 L -.004 .015 M 0 .008 L .004 .015"/><title>{occupant.id} · from {occupant.assignedRoom} · to {occupant.destinationExit ?? 'no reachable labeled exit'} · {occupant.status} · {occupant.currentLocation}{occupant.unreachableReason ? ` · ${occupant.unreachableReason}` : ''}</title></g> })}
  </g>

  return <main className="building-pages" data-theme={theme}>
    <header className="building-pages-header">
      <Link to="/simulator" className="building-back"><ArrowLeft size={16}/> Simulator</Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <button
          className="building-theme-toggle"
          type="button"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          {theme === 'light' ? <Moon size={15}/> : <Sun size={15}/>}
        </button>
        <span className="building-pages-brand"><span>EX</span> EXODUS · BUILDING WORKSPACE</span>
      </div>
    </header>

    <div className="building-pages-content">
      <div className="building-page-heading">
        <span className="building-page-icon"><Building2 size={19}/></span>
        <div>
          <span className="building-page-kicker">BUILDING WORKSPACE</span>
          <h1>{building.name}</h1>
          <p>Plans and floor documents uploaded for this building.</p>
        </div>
        <Link className="building-add-link" to="/buildings/new">＋ Add another building</Link>
      </div>

      <section className="building-metadata-grid" aria-label="Building metadata">
        <article><span><Building2 size={15}/> BUILDING</span><strong>{building.name}</strong></article>
        <article><span><Layers3 size={15}/> FLOORS</span><strong>{building.number_of_floors}</strong></article>
        <article><span><FileText size={15}/> DOCUMENTS</span><strong>{documentCount}</strong></article>
      </section>

      <section className="uploaded-floors-section">
        <div className="uploaded-floors-heading">
          <div><span className="building-page-kicker">UPLOADED SOURCE DOCUMENTS</span><h2>Floor plans</h2></div>
          <span>{building.floors.length} {building.floors.length === 1 ? 'floor' : 'floors'}</span>
        </div>
        {building.floors.length === 0 ? (
          <div className="building-empty-floors">
            <p>No floor documents have been uploaded yet.</p>
            <Link to="/buildings/new">Upload floor plans</Link>
          </div>
        ) : (
          <div className="uploaded-floor-list">
            {building.floors.map((floor) => (
              <article className="uploaded-floor-card" key={floor.floor_number}>
                <div className="uploaded-floor-number"><small>FLOOR</small><strong>{String(floor.floor_number).padStart(2, '0')}</strong></div>
                <div className="uploaded-floor-documents">
                  {floor.documents.map((document) => (
                    <div key={document.id} className="uploaded-document-row">
                      <a className="uploaded-document" href={buildingDocumentUrl(building.id, document.id)} target="_blank" rel="noreferrer">
                        <span className="uploaded-document-icon">{document.filename.toLowerCase().endsWith('.pdf') ? <FileText size={17}/> : <FileImage size={17}/>}</span>
                        <span><strong>{document.filename}</strong><small>{document.content_type} · {Math.max(1, Math.round(document.size_bytes / 1024))} KB</small></span>
                        <ArrowUpRight size={14}/>
                      </a>
                      <button
                        type="button"
                        className="analyze-plan-button"
                        onClick={() => {
                          setSelectedDocument(document)
                          setPageNumber(1)
                        }}
                      >
                        <ScanLine size={13}/> Inspect &amp; Simulate
                      </button>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {selectedDocument && (
        <section className="workspace-tabs-section">
          {/* Unified Tab Navigation Bar */}
          <div className="workspace-tabs-bar">
            <div className="workspace-tabs-group">
              <button
                type="button"
                className={`workspace-tab-btn ${activeTab === 'review' ? 'active' : ''}`}
                onClick={() => setActiveTab('review')}
              >
                <ScanLine size={15}/>
                <span>2D Geometry Review</span>
                <span className="workspace-tab-badge">{analysis?.elements?.length ?? 0}</span>
              </button>
              <button
                type="button"
                className={`workspace-tab-btn ${activeTab === 'simulation' ? 'active' : ''}`}
                onClick={() => setActiveTab('simulation')}
              >
                <Layers3 size={15}/>
                <span>3D Evacuation &amp; Simulation</span>
                {graph && graph.nodes.length > 0 ? (
                  <span className="workspace-tab-badge success">{graph.nodes.length} nodes · {graph.edges.length} edges</span>
                ) : (
                  <span className="workspace-tab-badge muted">Graph pending</span>
                )}
              </button>
            </div>

            <div className="workspace-tabs-actions">
              {selectedDocument.filename.toLowerCase().endsWith('.pdf') && (
                <div className="workspace-page-picker">
                  <span>PAGE</span>
                  <button
                    type="button"
                    className="page-nav-btn"
                    disabled={pageNumber <= 1}
                    onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                    title="Previous page"
                  >
                    ◀
                  </button>
                  <input
                    type="number"
                    min="1"
                    max={sourcePage?.page_count ?? 1}
                    value={pageNumber}
                    onChange={(event) => setPageNumber(Math.max(1, Math.min(sourcePage?.page_count ?? 99, Number(event.target.value))))}
                  />
                  <span className="page-count-text">of {sourcePage?.page_count ?? 1}</span>
                  <button
                    type="button"
                    className="page-nav-btn"
                    disabled={Boolean(sourcePage?.page_count && pageNumber >= sourcePage.page_count)}
                    onClick={() => setPageNumber((p) => sourcePage?.page_count ? Math.min(sourcePage.page_count, p + 1) : p + 1)}
                    title="Next page"
                  >
                    ▶
                  </button>
                </div>
              )}
              <button
                type="button"
                className="graph-generate-button"
                onClick={generateGraph}
                disabled={!analysis?.validated || graphLoading || reviewDirty}
              >
                {graphLoading ? 'Building graph…' : reviewDirty ? 'Save reviewed geometry before graphing' : analysis?.validated ? 'Generate evacuation graph' : 'Validate geometry to enable routes'}
              </button>
              <button
                type="button"
                className="plan-analysis-close"
                onClick={() => { setSelectedDocument(null); setAnalysis(null) }}
                title="Close this floor plan"
              >
                <X size={15} style={{ verticalAlign: 'middle', marginRight: 4 }}/> Close
              </button>
            </div>
          </div>

          {/* TAB 1: 2D Geometry Review */}
          {activeTab === 'review' && (
            <div className="workspace-tab-content review-tab-content">
              <div className="plan-analysis-panel">
                <div className="plan-analysis-heading">
                  <div>
                    <span className="building-page-kicker">GEMINI FLOOR PLAN REVIEW · 2D GEOMETRY</span>
                    <h2>{selectedDocument.filename} (Floor {selectedDocument.floor_number})</h2>
                  </div>
                </div>

                {analysisError && (
                  <div className="analysis-error" role="alert" style={{ marginBottom: 12 }}>
                    <div>{analysisError}</div>
                    {analysisError.includes('GEMINI_API_KEY') && (
                      <p style={{ margin: '6px 0 0 0', fontSize: '0.86rem', opacity: 0.9 }}>
                        To enable automated AI detection, add <code>GEMINI_API_KEY=your_key</code> to <code>backend/.env</code> and restart the backend. Or click <b>Start manual review (without AI)</b> below to draw and name rooms and exits directly.
                      </p>
                    )}
                  </div>
                )}
                {graphError && !graph && <p className="analysis-error" role="alert">{graphError}</p>}
                {!sourcePage && <p className="analysis-progress">Loading the original uploaded page…</p>}

                {sourcePage && (
                  <FloorPlanReview
                    key={`${selectedDocument.id}-${pageNumber}`}
                    source={sourcePage}
                    analysis={analysis}
                    analyzing={analyzing}
                    saving={savingReview}
                    onAnalyze={runAnalysis}
                    onManualInit={startManualReview}
                    onSave={saveReview}
                    onDirtyChange={setReviewDirty}
                    graphOverlay={graphOverlay}
                  />
                )}
              </div>
            </div>
          )}

          {/* TAB 2: 3D Evacuation & Simulation (Side-by-Side Stage & Controls Dock) */}
          {activeTab === 'simulation' && (
            <div className="workspace-tab-content simulation-tab-content">
              <div className="simulation-dashboard-grid">
                {/* Left: 3D Model Stage */}
                <div className="sim-dashboard-stage">
                  <div className="stage-card">
                    <div className="stage-header">
                      <div>
                        <span className="stage-kicker">3D DIGITAL TWIN · IMPORTED FLOOR GEOMETRY</span>
                        <h3>Floor {String(selectedDocument.floor_number).padStart(2, '0')} Evacuation Space</h3>
                      </div>
                      <div className="stage-header-stats">
                        <span><b>{analysis?.elements?.length ?? 0}</b> features</span>
                        <span><b>{graph?.edges.length ?? 0}</b> passages</span>
                        {fireTime > 0 && <span className="stage-fire-badge"><Flame size={12}/> T+{fireTime}s</span>}
                      </div>
                    </div>

                    {sourcePage ? (
                      <div className="imported-floor-3d-wrapper">
                        <BuildingViewer
                          selectedFloor={selectedDocument.floor_number}
                          occupantCount={occupants.length}
                          fireLocation=""
                          simulationRunId={0}
                          safeExits={viewerRoute ? [viewerRoute.exit_label] : []}
                          onEvacuatedChange={() => undefined}
                          onSelectFloor={(floorNumber) => {
                            const nextFloor = building.floors.find((item) => item.floor_number === floorNumber)
                            const nextDocument = nextFloor?.documents[0]
                            if (nextDocument) {
                              setSelectedDocument(nextDocument)
                              setPageNumber(1)
                            }
                          }}
                          importedPlan={{ imageWidth: sourcePage.image_width, imageHeight: sourcePage.image_height, elements: analysis?.elements ?? [] }}
                          availableFloors={building.floors.filter((floor) => floor.documents.length).map((floor) => floor.floor_number)}
                          graph={graph ?? null}
                          route={viewerRoute}
                          routeStartId={viewerRouteStart}
                          occupants={occupants}
                          fireNodeId={fireNodeId}
                          fireTime={fireTime}
                          firePlaying={firePlaying}
                          onSelectFireNode={(nodeId) => setFireNodeId(nodeId)}
                          onSelectStartNode={(nodeId) => setStartNodeId(nodeId)}
                        />
                      </div>
                    ) : (
                      <p className="analysis-progress">Loading 3D floor layout…</p>
                    )}

                    <div className="stage-footer">
                      <div className="stage-legend">
                        <span><i className="dot-route"/> Verified Route</span>
                        <span><i className="dot-corridor"/> Corridor</span>
                        <span><i className="dot-door"/> Door</span>
                        <span><i className="dot-exit"/> Exit</span>
                        <span><i className="dot-occupant"/> Occupant</span>
                      </div>
                      <div className="stage-camera-hint">Orbit: Drag · Zoom: Scroll · Inspect: Click</div>
                    </div>

                    {!analysis?.elements?.length && (
                      <p className="analysis-method-note" style={{ padding: '12px 16px', margin: 0 }}>
                        No saved reviewed geometry is loaded for this page yet. Switch to the <b>2D Geometry Review</b> tab to review and save elements.
                      </p>
                    )}
                    {graph && graph.edges.length === 0 && (
                      <p className="no-route-result" style={{ padding: '12px 16px', margin: 0 }}>
                        This saved graph has no reviewed passage connections. Review and save real doors or openings before routes or occupant movement can appear.
                      </p>
                    )}
                  </div>
                </div>

                {/* Right: Simulation & Routing Dock */}
                <div className="sim-dashboard-controls">
                  {!graph ? (
                    <div className="sim-dock-card empty-graph-prompt">
                      <Layers3 size={28}/>
                      <h4>Evacuation Graph Required</h4>
                      <p>The 3D routing and simulation dashboard requires an evacuation graph built from reviewed passages.</p>
                      <button type="button" className="floorplan-review-primary" onClick={() => setActiveTab('review')}>
                        Switch to 2D Review
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Card 1: Route & Reachable Exits */}
                      <div className="sim-dock-card">
                        <div className="dock-card-header">
                          <span className="dock-kicker">EVACUATION ROUTING</span>
                          <h4>Reachable Exit Paths</h4>
                        </div>
                        <div className="dock-form-group">
                          <label>
                            SELECT START AREA
                            <select value={startNodeId} onChange={(event) => setStartNodeId(event.target.value)}>
                              {graphSelectableNodes.map((node) => (
                                <option key={node.id} value={node.id}>{node.label}</option>
                              ))}
                            </select>
                          </label>
                        </div>

                        {routeSummary?.nearest_exit && nearestValidation?.valid ? (
                          <div className="dock-route-summary">
                            <div className="dock-route-highlight">
                              <span className="highlight-tag">VERIFIED NEAREST EXIT</span>
                              <strong>{routeSummary.nearest_exit.exit_label}</strong>
                              <div className="highlight-metric">
                                <span>Path Distance:</span>
                                <b>{routeSummary.path_length?.toFixed(3)} plan units</b>
                              </div>
                              <div className="dock-route-chain">
                                {routeSummary.nearest_exit.path_node_ids.map((id, index) => (
                                  <span key={id}>
                                    {nodeMap.get(id)?.label ?? id}
                                    {index < routeSummary.nearest_exit!.path_node_ids.length - 1 ? ' → ' : ''}
                                  </span>
                                ))}
                              </div>
                            </div>

                            {routeSummary.alternate_exits.length > 0 && (
                              <div className="dock-alternate-exits">
                                <span className="alternate-tag">ALTERNATE REACHABLE EXITS</span>
                                {routeSummary.alternate_exits.map((route) => (
                                  <div key={route.exit_id} className="alternate-exit-row">
                                    <span>{route.exit_label}</span>
                                    <small>{route.path_length.toFixed(3)} units</small>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="no-route-result">
                            {routeSummary
                              ? `Unreachable from ${graph.nodes.find((node) => node.id === startNodeId)?.label ?? 'selected area'}: ${nearestValidation?.reason ?? 'The backend found no path to an explicitly labeled exit.'}`
                              : 'Route calculation pending…'}
                          </p>
                        )}
                      </div>

                      {/* Card 2: Hazard / Fire Propagation */}
                      <div className="sim-dock-card">
                        <div className="dock-card-header">
                          <span className="dock-kicker">HAZARD PROPAGATION</span>
                          <h4>Fire &amp; Smoke Simulation</h4>
                          <span className={`fire-simulation-state${firePlaying ? ' active' : ''}`}>
                            <i/>{firePlaying ? `PROPAGATING · T+${fireTime}s` : graph.fire ? `PAUSED · T+${fireTime}s` : 'READY'}
                          </span>
                        </div>

                        <div className="dock-form-group">
                          <label>
                            INCIDENT ORIGIN
                            <select value={fireNodeId} onChange={(event) => setFireNodeId(event.target.value)}>
                              {graphSelectableNodes.map((node) => (
                                <option key={node.id} value={node.id}>{node.label}</option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <div className="dock-btn-row">
                          <button
                            type="button"
                            className="propagation-play"
                            disabled={firePlaying || !fireNodeId || !startNodeId}
                            onClick={() => { setGraphError(''); setFirePlaying(true) }}
                          >
                            <Play size={13}/> {fireTime > 0 ? 'Resume' : 'Start propagation'}
                          </button>
                          <button
                            type="button"
                            className="propagation-pause"
                            disabled={!firePlaying}
                            onClick={() => setFirePlaying(false)}
                          >
                            <Pause size={13}/> Pause
                          </button>
                          <button
                            type="button"
                            className="propagation-reset"
                            onClick={resetFire}
                            disabled={!graph.fire}
                          >
                            <RotateCcw size={12}/> Reset
                          </button>
                        </div>

                        <div className="propagation-time-row">
                          <span>0s</span>
                          <input
                            type="range"
                            min="0"
                            max="600"
                            step="5"
                            value={fireTime}
                            onChange={(event) => {
                              const value = Number(event.target.value)
                              setFirePlaying(false)
                              setFireTime(value)
                              if (selectedDocument && fireNodeId && startNodeId) {
                                advanceFirePropagation(buildingId, selectedDocument.id, pageNumber, fireNodeId, startNodeId, value)
                                  .then((result) => {
                                    setGraphResponse(result)
                                    setRouteSummary(result.routes ?? null)
                                  })
                                  .catch((requestError) => setGraphError(requestError instanceof Error ? requestError.message : 'Could not update propagation.'))
                              }
                            }}
                          />
                          <span>600s</span>
                          <strong>{fireTime}s</strong>
                        </div>

                        <div className="graph-status-legend">
                          <span className="safe"><i/>Safe {graph.nodes.filter((node) => node.status === 'safe').length}</span>
                          <span className="warning"><i/>Warning {graph.nodes.filter((node) => node.status === 'warning').length}</span>
                          <span className="dangerous"><i/>Dangerous {graph.nodes.filter((node) => node.status === 'dangerous').length}</span>
                          <span className="blocked"><i/>Blocked {graph.nodes.filter((node) => node.status === 'blocked').length}</span>
                        </div>
                      </div>

                      {/* Card 3: Occupant Simulation */}
                      <div className="sim-dock-card">
                        <div className="dock-card-header">
                          <span className="dock-kicker">AGENT-BASED EVACUATION</span>
                          <h4>Occupant Movement</h4>
                        </div>

                        <div className="dock-occupant-counter-pills">
                          <span className="count-pill evacuated">
                            <b>{occupants.filter((person) => person.status === 'evacuated').length}</b> Evacuated
                          </span>
                          <span className="count-pill moving">
                            <b>{occupants.filter((person) => person.status === 'moving').length}</b> In Transit
                          </span>
                          <span className="count-pill trapped">
                            <b>{occupants.filter((person) => person.status === 'trapped').length}</b> Unreachable
                          </span>
                        </div>

                        <div className="dock-form-grid">
                          <label>
                            OCCUPANTS
                            <input
                              type="number"
                              min="1"
                              max="500"
                              value={occupantCount}
                              onChange={(event) => setOccupantCount(Math.max(1, Math.min(500, Number(event.target.value))))}
                            />
                          </label>
                          <label>
                            ASSIGNED ROOM
                            <select
                              value={occupantRoomId}
                              onChange={(event) => {
                                setOccupantsPlaying(false)
                                setOccupants([])
                                setOccupantClock(0)
                                setOccupantRoomId(event.target.value)
                              }}
                            >
                              {occupantRooms.map((room) => (
                                <option key={room.id} value={room.id}>{room.label}</option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <div className="dock-form-group">
                          <label>
                            DESTINATION EXIT
                            <select
                              value={occupantRoute?.exit_id ?? ''}
                              disabled={!occupantAvailableRoutes.length || occupantRouteLoading}
                              onChange={(event) => {
                                setOccupantExitId(event.target.value)
                                setOccupantsPlaying(false)
                                setOccupants([])
                                setOccupantClock(0)
                              }}
                            >
                              {occupantAvailableRoutes.map((route) => (
                                <option key={route.exit_id} value={route.exit_id}>
                                  {route.exit_label}{route.exit_id === occupantAvailableRoutes[0]?.exit_id ? ' · Shortest' : ''}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <div className="dock-btn-row">
                          <button
                            type="button"
                            className="dock-primary-btn"
                            disabled={!occupantRoomId || !graph || occupantRouteLoading || Boolean(occupantRouteError)}
                            onClick={() => {
                              const generated = createGraphOccupants(graph!, occupantRoomId, occupantCount, occupantRoute)
                              setOccupants(generated)
                              setOccupantClock(0)
                              setOccupantsPlaying(playbackTransition(false, 'play', generated))
                            }}
                          >
                            <Play size={12}/> Generate &amp; run
                          </button>
                          <button
                            type="button"
                            disabled={!occupants.some((person) => person.status === 'moving')}
                            onClick={() => setOccupantsPlaying((playing) => playbackTransition(playing, playing ? 'pause' : 'play', occupants))}
                          >
                            {occupantsPlaying ? <><Pause size={12}/> Pause</> : <><Play size={12}/> Play</>}
                          </button>
                          <button
                            type="button"
                            disabled={!occupants.length || !graph || occupantRouteLoading || Boolean(occupantRouteError)}
                            onClick={() => {
                              setOccupants(createGraphOccupants(graph!, occupantRoomId, occupantCount, occupantRoute))
                              setOccupantClock(0)
                              setOccupantsPlaying(false)
                            }}
                          >
                            Reset
                          </button>
                          <button
                            type="button"
                            disabled={!occupants.length}
                            onClick={() => {
                              setOccupants([])
                              setOccupantClock(0)
                              setOccupantsPlaying(false)
                            }}
                          >
                            Clear
                          </button>
                        </div>

                        {occupantRouteError && <p className="analysis-error" role="alert">Route request failed: {occupantRouteError}</p>}
                        {occupantRouteLoading && <p className="analysis-progress">Requesting reviewed graph route for this room…</p>}
                        {!occupantRouteError && !occupantRouteLoading && occupantRoomId && !occupantRouteSummary && (
                          <p className="no-route-result" role="status">Unreachable: the backend returned no route data for this room.</p>
                        )}
                        {!occupantRouteError && occupantRoomId && occupantRouteSummary && !occupantRouteValidation?.valid && (
                          <p className="no-route-result" role="status">
                            Unreachable: {blockedOccupantConnections ? `hazard blocks ${blockedOccupantConnections}.` : occupantRouteValidation?.reason ?? 'No path to a labeled exit.'}
                          </p>
                        )}
                        {occupantRouteValidation?.valid && occupantRoute && (
                          <p className="occupant-destination-note">
                            Validated route: {occupantRooms.find((room) => room.id === occupantRoomId)?.label} → {occupantRoute.exit_label} ({occupantRoute.path_length.toFixed(3)} units).
                          </p>
                        )}

                        {/* Collapsible Occupant List to Prevent Visual Overwhelm */}
                        {occupants.length > 0 && (
                          <details className="dock-occupant-details">
                            <summary>
                              <span>Occupants Detail Table</span>
                              <span>{occupants.length} occupants ({occupantClock.toFixed(1)}s)</span>
                            </summary>
                            <div className="graph-occupant-table-wrap">
                              <table className="graph-occupant-table">
                                <thead>
                                  <tr>
                                    <th>ID</th>
                                    <th>Room</th>
                                    <th>Location</th>
                                    <th>Destination</th>
                                    <th>Route</th>
                                    <th>Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {occupants.map((person) => (
                                    <tr key={person.id}>
                                      <td>{person.id}</td>
                                      <td>{person.assignedRoom}</td>
                                      <td>{person.currentLocation}</td>
                                      <td>{person.destinationExit ?? 'None'}</td>
                                      <td>{person.route.map((id) => occupantNodeMap.get(id)?.label ?? id).join(' → ')}</td>
                                      <td>
                                        <span className={`occupant-status ${person.status}`}>{person.status}</span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        )}
                      </div>

                      {/* Card 4: Connectivity Diagnostics */}
                      {graph.diagnostics && (
                        <details className="sim-dock-card dock-diagnostics-details">
                          <summary>
                            <b>Topology Diagnostics</b>
                            <span>{graph.diagnostics.component_count ?? 0} components</span>
                          </summary>
                          <div className="dock-diagnostics-content">
                            {(graph.diagnostics.rooms_without_passages ?? []).length > 0 && (
                              <p>Rooms without passage: {(graph.diagnostics.rooms_without_passages ?? []).map((room) => room.label).join(', ')}.</p>
                            )}
                            {(graph.diagnostics.unreachable_exits ?? []).length > 0 && (
                              <p>Exits without room access: {(graph.diagnostics.unreachable_exits ?? []).map((exit) => exit.label).join(', ')}.</p>
                            )}
                            {(graph.diagnostics.missing_passage_connections ?? []).length > 0 && (
                              <div>
                                <small>Suggested passage checks:</small>
                                {(graph.diagnostics.missing_passage_connections ?? []).slice(0, 4).map((item) => (
                                  <p key={`${item.from_id}-${item.to_id}`} style={{ margin: '4px 0' }}>
                                    • {item.from_label} ↔ {item.to_label} (gap {item.bbox_gap.toFixed(3)})
                                  </p>
                                ))}
                              </div>
                            )}
                          </div>
                        </details>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      <p className="building-source-note">Floor count and list come from uploaded documents. Plan detections are computer-vision candidates and need human review.</p>
    </div>
  </main>
}

function nodeCenter(node: EvacuationNode): [number, number] {
  if (!node.bbox) return [0, 0]
  return [node.bbox.x + node.bbox.width / 2, node.bbox.y + node.bbox.height / 2]
}

export default BuildingWorkspacePage
