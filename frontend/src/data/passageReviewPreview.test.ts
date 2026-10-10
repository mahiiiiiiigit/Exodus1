import { describe, expect, it } from 'vitest'
import { passageReviewPreview } from './passageReviewPreview'
import type { ReviewedPlanElement } from '../services/api'

const elements: ReviewedPlanElement[] = [
  { id: 'reception', type: 'room', label: 'Reception', bbox: { x: .1, y: .1, width: .2, height: .2 } },
  { id: 'hall', type: 'corridor', label: 'Main corridor', bbox: { x: .29, y: .1, width: .2, height: .2 } },
  { id: 'stair', type: 'stairs', label: 'Stair A', bbox: { x: .49, y: .1, width: .2, height: .2 } },
]

describe('passage review preview', () => {
  it('shows the two connected region names for a valid passage', () => {
    const result = passageReviewPreview(elements, { x: .28, y: .15, width: .03, height: .05 })
    expect(result.valid).toBe(true)
    expect(result.regions.map((region) => region.label)).toEqual(['Reception', 'Main corridor'])
  })
  it('rejects passages intersecting more or fewer than two regions with a reason', () => {
    const tooWide = passageReviewPreview(elements, { x: .28, y: .15, width: .22, height: .05 })
    expect(tooWide.valid).toBe(false)
    expect(tooWide.reason).toContain('exactly two are required')
    const missing = passageReviewPreview(elements, { x: .8, y: .8, width: .02, height: .02 })
    expect(missing.valid).toBe(false)
    expect(missing.reason).toBe('No navigable region intersects this passage.')
  })
})
