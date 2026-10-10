export interface HealthResponse {
  status: string
}

export interface SimulationRequest {
  incident_type: string
  floor: number
  occupant_count: number
  fire_location: string
}

export interface ZoneResult {
  zone: string
  estimated_occupants: number
  status: string
  risk_level: string
}

export interface SimulationResponse {
  evacuation_time_seconds: number
  people_saved: number
  people_trapped: number
  congestion_zones: string[]
  safe_exits: string[]
  zones: ZoneResult[]
  risk_score: number
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000')
  .replace(/\/$/, '')

export interface FloorDocument {
  id: string
  floor_number: number
  filename: string
  content_type: string
  size_bytes: number
  url: string
  uploaded_at: string
}

export interface BuildingFloor {
  floor_number: number
  documents: FloorDocument[]
}

export interface BuildingRecord {
  id: string
  name: string
  number_of_floors: number
  created_at: string
  floors: BuildingFloor[]
}

export interface PlanDetection {
  id: string
  kind?: string
  type?: string
  label?: string
  confidence: number
  label_confidence?: number
  bbox?: { x: number; y: number; width: number; height: number }
  points?: { x: number; y: number }[]
  polygon?: { x: number; y: number }[]
  uncertainty?: string[]
  label_is_readable?: boolean
  review_status?: 'candidate' | 'confirmed' | 'rejected'
}

export type ReviewedPlanElement = { id: string; type: 'room' | 'wall' | 'unknown' | 'corridor' | 'door' | 'opening' | 'stairs' | 'exit'; label: string; bbox: { x: number; y: number; width: number; height: number }; polygon?: { x: number; y: number }[]; confidence?: number }

export interface FloorPlanSource { image_width: number; image_height: number; image_data_url: string; page_count?: number; page_number?: number }

export interface FloorPlanAnalysis {
  document_id: string
  model?: string
  page_number: number
  page_count?: number
  image_width: number
  image_height: number
  outer_walls: PlanDetection[]
  rooms: PlanDetection[]
  corridors: PlanDetection[]
  doors: PlanDetection[]
  openings?: PlanDetection[]
  stairs: PlanDetection[]
  exits: PlanDetection[]
  preview_data_url: string
  source_crop?: { x: number; y: number; width: number; height: number }
  geometric_candidates?: PlanDetection[]
  candidates?: PlanDetection[]
  outline?: { x: number; y: number }[]
  outline_confidence?: number
  elements?: ReviewedPlanElement[]
  validated?: boolean
  warnings?: string[]
  method: string
  review_notice: string
  analyzed_at?: string
}

export interface EvacuationNode {
  id: string
  type: 'room' | 'corridor' | 'door' | 'opening' | 'stairs' | 'exit'
  label: string
  bbox?: { x: number; y: number; width: number; height: number }
  confidence: number
  status: 'unverified' | 'safe' | 'warning' | 'dangerous' | 'blocked'
  risk?: number
  smoke_level?: number
  fire_level?: number
}

export interface EvacuationEdge {
  from: string
  to: string
  length: number
  confidence: number
  relation: string
  blocked: boolean
  risk?: number
}

export interface EvacuationGraph {
  nodes: EvacuationNode[]
  edges: EvacuationEdge[]
  adjacency: Record<string, string[]>
  fire?: { node_id: string; elapsed_seconds: number; intensity: number; smoke_density: number }
  diagnostics?: {
    node_count: number
    edge_count: number
    component_count?: number
    connected_components?: string[][]
    rooms_without_passages?: { id: string; label: string }[]
    unreachable_rooms?: { id: string; label: string }[]
    unreachable_exits?: { id: string; label: string }[]
    invalid_passages?: { id: string; label: string; reason: string }[]
    missing_passage_connections?: { from_id: string; from_label: string; to_id: string; to_label: string; bbox_gap: number; reason: string }[]
    excluded_elements?: { id?: string; type: string; reason: string }[]
  }
}

export interface EvacuationRoute {
  exit_id: string
  exit_label: string
  path_node_ids: string[]
  path_length: number
}

export interface EvacuationRoutes {
  start_node_id: string
  nearest_exit: EvacuationRoute | null
  alternate_exits: EvacuationRoute[]
  blocked_paths: string[]
  blocked_edges: { from: string; to: string; risk: number }[]
  path_length: number | null
}

export interface EvacuationGraphResponse {
  graph: EvacuationGraph
  routes?: EvacuationRoutes | null
  diagnostics?: {
    node_count: number
    edge_count: number
    unreachable_rooms: { id: string; label: string }[]
    disconnected_nodes: { id: string; type: string; label: string }[]
    unreachable_exits: { id: string; label: string }[]
    routes_to_labelled_exits: { room_id: string; room_label: string; nearest_exit: EvacuationRoute | null; alternate_exits: EvacuationRoute[] }[]
    safety_claim: false
    warnings: string[]
  }
  updated_at?: string | null
}

export function buildingDocumentUrl(buildingId: string, documentId: string) {
  return `${API_BASE_URL}/buildings/${encodeURIComponent(buildingId)}/documents/${encodeURIComponent(documentId)}`
}

export async function getFloorPlanSource(buildingId: string, documentId: string, page = 1): Promise<FloorPlanSource> {
  const response = await fetch(`${API_BASE_URL}/buildings/${encodeURIComponent(buildingId)}/documents/${encodeURIComponent(documentId)}/source?page=${page}`, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(await readApiError(response))
  return response.json() as Promise<FloorPlanSource>
}

export async function analyzeFloorPlan(buildingId: string, documentId: string, page = 1): Promise<FloorPlanAnalysis> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), 185_000)
  try {
    const response = await fetch(`${API_BASE_URL}/buildings/${encodeURIComponent(buildingId)}/documents/${encodeURIComponent(documentId)}/analyze?page=${page}`, { method: 'POST', headers: { Accept: 'application/json' }, signal: controller.signal })
    if (!response.ok) throw new Error(await readApiError(response))
    return await response.json() as FloorPlanAnalysis
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Floor-plan analysis timed out after three minutes. Check the backend logs and retry.')
    }
    if (error instanceof TypeError) {
      throw new Error(`Could not reach the Exodus backend at ${API_BASE_URL}. Check that FastAPI is running and retry.`)
    }
    throw error
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

export async function initializeManualReview(buildingId: string, documentId: string, page = 1): Promise<FloorPlanAnalysis> {
  const response = await fetch(`${API_BASE_URL}/buildings/${encodeURIComponent(buildingId)}/documents/${encodeURIComponent(documentId)}/initialize-manual-review?page=${page}`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(await readApiError(response))
  return await response.json() as FloorPlanAnalysis
}

export async function saveFloorPlanReview(buildingId: string, documentId: string, page: number, elements: ReviewedPlanElement[], rejectedCandidateIds: string[] = []): Promise<{ validated: boolean; elements: ReviewedPlanElement[]; candidates: PlanDetection[]; warning?: string | null }> {
  const response = await fetch(`${API_BASE_URL}/buildings/${encodeURIComponent(buildingId)}/documents/${encodeURIComponent(documentId)}/review?page=${page}`, { method: 'PUT', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ elements, rejected_candidate_ids: rejectedCandidateIds }) })
  if (!response.ok) throw new Error(await readApiError(response))
  return response.json() as Promise<{ validated: boolean; elements: ReviewedPlanElement[]; candidates: PlanDetection[]; warning?: string | null }>
}

export async function getFloorPlanAnalysis(buildingId: string, documentId: string, page = 1): Promise<FloorPlanAnalysis> {
  const response = await fetch(`${API_BASE_URL}/buildings/${encodeURIComponent(buildingId)}/documents/${encodeURIComponent(documentId)}/analysis?page=${page}`, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(await readApiError(response))
  return response.json() as Promise<FloorPlanAnalysis>
}

async function graphRequest(url: string, init?: RequestInit): Promise<EvacuationGraphResponse> {
  const response = await fetch(url, { ...init, headers: { Accept: 'application/json', ...(init?.headers ?? {}) } })
  if (!response.ok) throw new Error(await readApiError(response))
  return response.json() as Promise<EvacuationGraphResponse>
}

const planEndpoint = (buildingId: string, documentId: string, page: number, suffix: string) => `${API_BASE_URL}/buildings/${encodeURIComponent(buildingId)}/documents/${encodeURIComponent(documentId)}/${suffix}?page=${page}`

export function createEvacuationGraph(buildingId: string, documentId: string, page = 1) {
  return graphRequest(planEndpoint(buildingId, documentId, page, 'graph'), { method: 'POST' })
}

export function getEvacuationGraph(buildingId: string, documentId: string, page = 1) {
  return graphRequest(planEndpoint(buildingId, documentId, page, 'graph'))
}

export function getEvacuationRoute(buildingId: string, documentId: string, startNodeId: string, page = 1) {
  return graphRequest(planEndpoint(buildingId, documentId, page, 'route'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start_node_id: startNodeId }) })
}

export function advanceFirePropagation(buildingId: string, documentId: string, page: number, fireNodeId: string, startNodeId: string, elapsedSeconds: number, intensity = 1, smokeDensity = 1) {
  return graphRequest(planEndpoint(buildingId, documentId, page, 'fire'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fire_node_id: fireNodeId, start_node_id: startNodeId, elapsed_seconds: elapsedSeconds, intensity, smoke_density: smokeDensity }) })
}

export async function getBuildings(): Promise<BuildingRecord[]> {
  const response = await fetch(`${API_BASE_URL}/buildings`, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(await readApiError(response))
  return response.json() as Promise<BuildingRecord[]>
}

export async function getBuilding(buildingId: string): Promise<BuildingRecord> {
  const response = await fetch(`${API_BASE_URL}/buildings/${encodeURIComponent(buildingId)}`, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(await readApiError(response))
  return response.json() as Promise<BuildingRecord>
}

export async function createBuilding(name: string): Promise<BuildingRecord> {
  const response = await fetch(`${API_BASE_URL}/buildings`, {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  })
  if (!response.ok) throw new Error(await readApiError(response))
  return response.json() as Promise<BuildingRecord>
}

export async function uploadBuildingDocuments(buildingId: string, entries: { file: File; floorNumber: number }[]): Promise<BuildingRecord> {
  const form = new FormData()
  entries.forEach(({ file, floorNumber }) => {
    form.append('files', file)
    form.append('floor_numbers', String(floorNumber))
  })
  const response = await fetch(`${API_BASE_URL}/buildings/${encodeURIComponent(buildingId)}/upload`, {
    method: 'POST', headers: { Accept: 'application/json' }, body: form,
  })
  if (!response.ok) throw new Error(await readApiError(response))
  return response.json() as Promise<BuildingRecord>
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json()
    if (typeof payload === 'object' && payload !== null && 'detail' in payload) {
      const detail = payload.detail
      if (typeof detail === 'string') return detail
      if (Array.isArray(detail)) {
        return detail.map((item) => typeof item === 'object' && item !== null && 'msg' in item ? String(item.msg) : String(item)).join('; ')
      }
    }
  } catch {
    // Fall back to the HTTP status when the error response isn't JSON.
  }
  return `Request failed with HTTP ${response.status}`
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/health`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })

  if (!response.ok) throw new Error(await readApiError(response))
  return response.json() as Promise<HealthResponse>
}

export async function runSimulation(input: SimulationRequest): Promise<SimulationResponse> {
  const response = await fetch(`${API_BASE_URL}/simulate`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!response.ok) throw new Error(await readApiError(response))
  return response.json() as Promise<SimulationResponse>
}
