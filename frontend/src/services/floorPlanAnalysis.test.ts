import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyzeFloorPlan } from './api'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('floor-plan analysis request errors', () => {
  it('turns a disconnected backend into an actionable message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(analyzeFloorPlan('building', 'document')).rejects.toThrow(/Could not reach the Exodus backend.*Check that FastAPI is running/)
  })

  it('preserves actionable FastAPI errors from Gemini analysis', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Gemini authentication failed. Check GEMINI_API_KEY.' }), { status: 502, headers: { 'Content-Type': 'application/json' } })))
    await expect(analyzeFloorPlan('building', 'document')).rejects.toThrow('Gemini authentication failed. Check GEMINI_API_KEY.')
  })

  it('shows the backend quota explanation rather than a generic fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Gemini quota is exhausted. Check the project quota or billing, then retry.' }), { status: 429, headers: { 'Content-Type': 'application/json' } })))
    await expect(analyzeFloorPlan('building', 'document')).rejects.toThrow('Gemini quota is exhausted. Check the project quota or billing, then retry.')
  })

  it('aborts a request that exceeds the frontend analysis limit', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })))
    const request = analyzeFloorPlan('building', 'document')
    const rejected = expect(request).rejects.toThrow('Floor-plan analysis timed out after three minutes.')
    await vi.advanceTimersByTimeAsync(185_000)
    await rejected
  })
})
