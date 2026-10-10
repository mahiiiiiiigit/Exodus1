import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowUpFromLine, Building2, FileImage, FileText, Plus, Trash2 } from 'lucide-react'
import { createBuilding, getBuildings, uploadBuildingDocuments, type BuildingRecord } from '../services/api'
import './building-pages.css'

interface DocumentEntry { id: number; file: File | null; floorNumber: number }
const acceptedTypes = '.pdf,.png,.jpg,.jpeg'
const formatSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

function UploadBuildingPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [documents, setDocuments] = useState<DocumentEntry[]>([{ id: 1, file: null, floorNumber: 1 }])
  const [savedBuildings, setSavedBuildings] = useState<BuildingRecord[]>([])
  const [buildingId, setBuildingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [nextId, setNextId] = useState(2)

  useEffect(() => {
    getBuildings().then(setSavedBuildings).catch(() => setSavedBuildings([]))
  }, [])

  const updateDocument = (id: number, update: Partial<DocumentEntry>) => setDocuments((items) => items.map((item) => item.id === id ? { ...item, ...update } : item))
  const addDocument = () => { setDocuments((items) => [...items, { id: nextId, file: null, floorNumber: items.length + 1 }]); setNextId((id) => id + 1) }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    const validDocuments = documents.filter((entry): entry is DocumentEntry & { file: File } => entry.file !== null)
    if (!buildingId && !name.trim()) { setError('Enter a building name.'); return }
    if (!validDocuments.length) { setError('Choose at least one PDF, PNG, or JPG floor plan.'); return }
    setLoading(true)
    try {
      let id = buildingId
      if (!id) {
        const created = await createBuilding(name.trim())
        id = created.id
        setBuildingId(id)
      }
      const building = await uploadBuildingDocuments(id, validDocuments.map(({ file, floorNumber }) => ({ file, floorNumber })))
      navigate(`/buildings/${building.id}`)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Could not upload the floor plans.')
    } finally {
      setLoading(false)
    }
  }

  return <main className="building-pages">
    <header className="building-pages-header"><Link to="/simulator" className="building-back"><ArrowLeft size={16}/> Simulator</Link><span className="building-pages-brand"><span>EX</span> EXODUS · BUILDING WORKSPACE</span></header>
    <div className="building-pages-content">
      <div className="building-page-heading"><span className="building-page-icon"><Building2 size={19}/></span><div><span className="building-page-kicker">BUILDING SETUP</span><h1>Upload floor plans</h1><p>Create a building workspace from your actual floor documents.</p></div></div>
      <div className="building-upload-layout">
        <form className="building-upload-card" onSubmit={submit}>
          <label className="building-field-label" htmlFor="building-name">Building name</label>
          <input id="building-name" className="building-name-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. North Tower" required disabled={Boolean(buildingId)}/>
          <div className="building-docs-heading"><div><strong>Floor documents</strong><small>Upload one or more PDF, PNG, or JPG plans. Assign each document a floor number.</small></div><button type="button" className="building-add-document" onClick={addDocument}><Plus size={14}/> Add document</button></div>
          <div className="building-document-rows">{documents.map((entry) => <div className="building-document-row" key={entry.id}>
            <label className={`building-file-picker${entry.file ? ' has-file' : ''}`}>
              <input type="file" accept={acceptedTypes} onChange={(event) => updateDocument(entry.id, { file: event.target.files?.[0] ?? null })}/>
              {entry.file?.type === 'application/pdf' || entry.file?.name.toLowerCase().endsWith('.pdf') ? <FileText size={17}/> : <FileImage size={17}/>}
              <span>{entry.file ? <><strong>{entry.file.name}</strong><small>{formatSize(entry.file.size)}</small></> : <><strong>Select floor plan</strong><small>PDF, PNG, JPG · up to 50 MB</small></>}</span>
            </label>
            <label className="building-floor-number">FLOOR<input aria-label="Floor number" type="number" min="0" value={entry.floorNumber} onChange={(event) => updateDocument(entry.id, { floorNumber: Number(event.target.value) })}/></label>
            {documents.length > 1 && <button type="button" className="building-remove-document" aria-label="Remove document row" onClick={() => setDocuments((items) => items.filter((item) => item.id !== entry.id))}><Trash2 size={15}/></button>}
          </div>)}</div>
          {error && <p className="building-form-error" role="alert">{error}</p>}
          <div className="building-submit-row"><span><i/> Files are stored with this building workspace.</span><button type="submit" disabled={loading}>{loading ? 'Uploading…' : <><ArrowUpFromLine size={15}/> Create workspace</>}</button></div>
        </form>
        <aside className="building-upload-aside"><span className="building-aside-label">WHAT HAPPENS NEXT</span><div className="building-aside-step"><b>01</b><span><strong>Documents are stored</strong><small>Original files remain available in the workspace.</small></span></div><div className="building-aside-step"><b>02</b><span><strong>Floor list is generated</strong><small>Floor count comes from the floor numbers you assign.</small></span></div><div className="building-aside-step"><b>03</b><span><strong>Review your building</strong><small>Open the workspace to access each uploaded plan.</small></span></div></aside>
      </div>
      {savedBuildings.length > 0 && <section className="saved-building-list"><div><span className="building-page-kicker">EXISTING WORKSPACES</span><h2>Buildings</h2></div>{savedBuildings.map((building) => <Link key={building.id} to={`/buildings/${building.id}`}><Building2 size={16}/><strong>{building.name}</strong><span>{building.number_of_floors} {building.number_of_floors === 1 ? 'floor' : 'floors'}</span></Link>)}</section>}
    </div>
  </main>
}

export default UploadBuildingPage
