import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { FloorPlanAnalysis, FloorPlanSource, PlanDetection, ReviewedPlanElement } from '../services/api'
import { passageReviewPreview } from '../data/passageReviewPreview'

const kinds: ReviewedPlanElement['type'][] = ['room', 'wall', 'unknown', 'corridor', 'door', 'opening', 'stairs', 'exit']
const kindClass = (kind: string) => `plan-review-${kind}`
function polygonBox(points: { x: number; y: number }[]): ReviewedPlanElement['bbox'] {
  const xs = points.map((point) => point.x), ys = points.map((point) => point.y)
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, width: Math.max(.002, Math.max(...xs) - x), height: Math.max(.002, Math.max(...ys) - y) }
}


export function FloorPlanReview({ source, analysis, analyzing, saving, onAnalyze, onManualInit, onSave, onDirtyChange, graphOverlay }: {
  source: FloorPlanSource
  analysis: FloorPlanAnalysis | null
  analyzing: boolean
  saving: boolean
  onAnalyze: () => void
  onManualInit?: () => void
  onSave: (elements: ReviewedPlanElement[], rejectedCandidateIds: string[]) => void
  onDirtyChange?: (dirty: boolean) => void
  graphOverlay?: ReactNode
}) {
  const [elements, setElements] = useState<ReviewedPlanElement[]>(analysis?.elements ?? [])
  const [handled, setHandled] = useState<Set<string>>(new Set((analysis?.candidates ?? []).filter((item) => item.review_status === 'rejected' || item.review_status === 'confirmed').map((item) => item.id)))
  const [kind, setKind] = useState<ReviewedPlanElement['type']>('room')
  const [label, setLabel] = useState('')
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<ReviewedPlanElement['bbox'] | null>(null)
  useEffect(() => { setElements(analysis?.elements ?? []); setHandled(new Set((analysis?.candidates ?? []).filter((item) => item.review_status === 'rejected' || item.review_status === 'confirmed').map((item) => item.id))) }, [analysis])
  useEffect(() => { onDirtyChange?.(JSON.stringify(elements) !== JSON.stringify(analysis?.elements ?? [])) }, [elements, analysis, onDirtyChange])

  const handleElementPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (event.type === 'pointerdown') {
      event.currentTarget.setPointerCapture(event.pointerId)
      dragStart.current = { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }
      setDraft({ ...dragStart.current, width: 0, height: 0 })
    } else if (dragStart.current) {
      const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
      const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
      setDraft({ x: Math.min(dragStart.current.x, x), y: Math.min(dragStart.current.y, y), width: Math.abs(x - dragStart.current.x), height: Math.abs(y - dragStart.current.y) })
    }
  }
  const finishElement = () => { if (draft?.width && draft.height) setDraft(draft); else setDraft(null); dragStart.current = null }
  const updateElement = (id: string, patch: Partial<ReviewedPlanElement>) => setElements((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  const updateCoordinate = (item: ReviewedPlanElement, coordinate: 'x' | 'y' | 'width' | 'height', value: number) => {
    const bbox = { ...item.bbox, [coordinate]: Math.max(0, Math.min(1, value)) }
    if (coordinate === 'x') bbox.width = Math.min(bbox.width, 1 - bbox.x)
    if (coordinate === 'y') bbox.height = Math.min(bbox.height, 1 - bbox.y)
    if (coordinate === 'width') bbox.width = Math.min(bbox.width, 1 - bbox.x)
    if (coordinate === 'height') bbox.height = Math.min(bbox.height, 1 - bbox.y)
    updateElement(item.id, { bbox, polygon: undefined })
  }
  const acceptCandidate = (item: PlanDetection) => {
    const polygon = item.polygon ?? item.points
    const candidateType = item.kind ?? item.type ?? 'unknown'
    if (!polygon?.length || !kinds.includes(candidateType as ReviewedPlanElement['type'])) return
    const type = candidateType as ReviewedPlanElement['type']
    setElements((items) => [...items, { id: item.id, type, label: item.label ?? (type === 'exit' ? '' : type), bbox: polygonBox(polygon), polygon }])
    setHandled((previous) => new Set(previous).add(item.id))
  }
  const reviewPassage = (passage: Pick<ReviewedPlanElement, 'id' | 'label' | 'bbox'>) => {
    return { passage, ...passageReviewPreview(elements, passage.bbox) }
  }
  const passageReviews = elements.filter((item) => item.type === 'door' || item.type === 'opening').map(reviewPassage)
  const draftPassageReview = draft && (kind === 'door' || kind === 'opening') ? reviewPassage({ id: 'draft-passage', label: label.trim() || `Draft ${kind}`, bbox: draft }) : null
  const addElement = () => {
    if (!draft || draft.width < .004 || draft.height < .004 || !label.trim()) return
    setElements((items) => [...items, { id: `manual-${crypto.randomUUID()}`, type: kind, label: label.trim(), bbox: { x: draft.x, y: draft.y, width: draft.width, height: draft.height } }])
    setLabel('')
    setDraft(null)
  }
  const renderOverlay = () => <>
    {analysis?.outline && analysis.outline.length > 2 && <polygon className="plan-review-outline" points={analysis.outline.map((point) => `${point.x},${point.y}`).join(' ')}><title>Candidate complete plan outline · {Math.round((analysis.outline_confidence ?? 0) * 100)}% confidence</title></polygon>}
    {analysis?.candidates?.filter((item) => !handled.has(item.id)).map((item) => {
      const points = item.polygon ?? item.points
      return points && <polygon key={item.id} className="plan-review-candidate" points={points.map((point) => `${point.x},${point.y}`).join(' ')}><title>{item.kind ?? item.type ?? 'Unknown'} candidate · {Math.round(item.confidence * 100)}% confidence{item.uncertainty?.length ? ` · ${item.uncertainty.join('; ')}` : ''}</title></polygon>
    })}
    {elements.map((item) => item.polygon?.length ? <polygon key={item.id} className={kindClass(item.type)} points={item.polygon.map((point) => `${point.x},${point.y}`).join(' ')}><title>{item.label} · {item.type} · reviewed</title></polygon> : <rect key={item.id} className={kindClass(item.type)} x={item.bbox.x} y={item.bbox.y} width={item.bbox.width} height={item.bbox.height}><title>{item.label} · {item.type} · reviewed</title></rect>)}
    {draft && <rect className="plan-review-draft" x={draft.x} y={draft.y} width={draft.width} height={draft.height}/>}
  </>
  return <section className="floorplan-source-review" aria-label="Full floor plan source and manual review">
    <div className="floorplan-review-grid">
      <article><div className="floorplan-review-image-heading"><strong>Original uploaded page</strong><span>{source.image_width} × {source.image_height}</span></div>
        <div className="floorplan-review-image"><img src={source.image_data_url} alt="Complete original uploaded image or rasterized PDF page"/></div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className="floorplan-review-primary" disabled={analyzing} onClick={onAnalyze}>{analyzing ? 'Analyzing full plan…' : 'Analyze with Gemini AI'}</button>
          {onManualInit && (
            <button type="button" className="floorplan-review-secondary" disabled={analyzing} onClick={onManualInit} style={{ background: '#1e293b', color: '#e2e8f0', border: '1px solid #475569', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontWeight: 500 }}>
              Start manual review (without AI)
            </button>
          )}
        </div>
      </article>
      <article><div className="floorplan-review-image-heading"><strong>Full plan with review overlay</strong><span>{analysis ? `${analysis.image_width} × ${analysis.image_height}` : 'Not processed'}</span></div>
        {analysis ? <div className="floorplan-review-image annotation-selectable" onPointerDown={handleElementPointer} onPointerMove={handleElementPointer} onPointerUp={finishElement} onPointerCancel={finishElement}>
          <img src={analysis.preview_data_url} alt="Complete uploaded floor plan with candidate overlays"/><svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-label="Full-image detection overlay">{renderOverlay()}{graphOverlay}</svg>
        </div> : (
          <div className="floorplan-review-empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <p style={{ margin: 0 }}>Analyze the complete uploaded source to review Gemini candidates, or start manual review directly.</p>
            {onManualInit && (
              <button type="button" className="floorplan-review-primary" style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', borderRadius: 6, border: 'none', cursor: 'pointer' }} onClick={onManualInit}>
                Start Manual Review (Without AI)
              </button>
            )}
          </div>
        )}
        {analysis && <p className="floorplan-review-help">Green is the proposed drawing outline. Colored polygons are candidates; drag on the image to add a manually reviewed region.</p>}
      </article>
    </div>
    {analysis && <div className="floorplan-review-editor">
      <p className="analysis-review-note">{analysis.review_notice}</p>
      {(analysis.warnings ?? []).map((warning, index) => <p className="floorplan-review-warning" key={`${index}-${warning}`}>{warning}</p>)}
      <div className="floorplan-review-candidates"><strong>Gemini candidates · review each before use</strong>
        {(analysis.candidates ?? []).filter((item) => !handled.has(item.id)).map((item) => <div className="floorplan-review-element" key={item.id}><span>{item.kind ?? item.type ?? 'unknown'} · geometry {Math.round(item.confidence * 100)}%{item.label ? ` · ${item.label} (${Math.round((item.label_confidence ?? 0) * 100)}% label)` : ' · no readable label'}{item.uncertainty?.length ? ` · ${item.uncertainty.join('; ')}` : ''}</span><button type="button" onClick={() => acceptCandidate(item)}>Accept / edit</button><button type="button" onClick={() => setHandled((previous) => new Set(previous).add(item.id))}>Reject</button></div>)}
        {!(analysis.candidates?.some((item) => !handled.has(item.id))) && <p className="floorplan-review-help">No pending candidates. Draw additional elements manually if needed.</p>}
      </div>
      <p className="floorplan-review-help passage-workflow-hint">Passage workflow: choose “door” or “opening”, draw over a visible doorway on the original plan, check the two connected region names, then add and save. Review and save every doorway or corridor connection along the route; a nearby room is never connected automatically.</p>
      <div className="floorplan-review-toolbar"><label>Mark as<select value={kind} onChange={(event) => setKind(event.target.value as ReviewedPlanElement['type'])}>{kinds.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>Room / feature name<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder={kind === 'exit' ? 'Copy an explicit label from the plan' : `Name this ${kind}`}/></label><button type="button" disabled={!draft || !label.trim() || Boolean(draftPassageReview && !draftPassageReview.valid)} onClick={addElement}>Add reviewed element</button><button type="button" className="floorplan-review-primary" disabled={saving || elements.some((item) => !item.label.trim()) || passageReviews.some((item) => !item.valid)} onClick={() => onSave(elements, (analysis.candidates ?? []).filter((item) => handled.has(item.id) && !elements.some((element) => element.id === item.id)).map((item) => item.id))}>{saving ? 'Saving…' : 'Save reviewed geometry'}</button></div>
      {draftPassageReview && <div className="floorplan-review-candidates" aria-live="polite"><strong>Passage preview · not yet saved</strong><p className={draftPassageReview.valid ? 'floorplan-passage-valid' : 'floorplan-review-warning'}>{draftPassageReview.valid ? `Connects ${draftPassageReview.regions.map((region) => region.label).join(' ↔ ')}. Add it, then save reviewed geometry.` : draftPassageReview.reason}</p></div>}
      <p className="floorplan-review-help">Edit labels and coordinates below, or remove a reviewed feature and redraw it. Exits must have a label copied from the plan; Exodus does not invent exit names.</p>
      {passageReviews.length > 0 && <div className="floorplan-review-candidates" aria-live="polite"><strong>Saved passage connection checks · source-image coordinates</strong>{passageReviews.map(({ passage, regions, valid, reason }) => <p className={valid ? 'floorplan-passage-valid' : 'floorplan-review-warning'} key={passage.id}><b>{passage.label}</b>: {valid ? `connects ${regions.map((region) => region.label || region.id).join(' ↔ ')}` : reason}</p>)}</div>}
      <div className="floorplan-review-counts">Human-reviewed plan counts: {kinds.map((item) => `${item} ${elements.filter((feature) => feature.type === item).length}`).join(' · ')} · AI candidates are not included.</div>
      <div className="floorplan-review-elements">
        {elements.map((item) => <div className="floorplan-review-element" key={item.id}>
          <select aria-label="Feature type" value={item.type} onChange={(event) => updateElement(item.id, { type: event.target.value as ReviewedPlanElement['type'] })}>{kinds.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select>
          <input aria-label="Feature label" value={item.label} onChange={(event) => updateElement(item.id, { label: event.target.value })}/>
          {(['x', 'y', 'width', 'height'] as const).map((coordinate) => <input key={coordinate} aria-label={`${coordinate} coordinate`} type="number" min="0" max="1" step="0.005" value={item.bbox[coordinate]} onChange={(event) => updateCoordinate(item, coordinate, Number(event.target.value))}/>)}
          <button type="button" onClick={() => setElements((items) => items.filter((current) => current.id !== item.id))}>Remove</button>
        </div>)}
      </div>
      {analysis.validated && <p className="floorplan-validated-note">Reviewed geometry is available for graph generation. Routes are estimates until the complete geometry and connections are independently validated.</p>}
      {!analysis.validated && <p className="floorplan-review-warning">Routes remain disabled until you manually confirm at least one room and one explicitly labeled exit.</p>}
    </div>}
  </section>
}
