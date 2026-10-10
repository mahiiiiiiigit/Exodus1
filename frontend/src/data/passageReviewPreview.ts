import type { ReviewedPlanElement } from '../services/api'

export type PassageBox = ReviewedPlanElement['bbox']

function geometricallyTouches(first: PassageBox, second: PassageBox): boolean {
  const overlapX = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x)
  const overlapY = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y)
  if (overlapX > 1e-7 && overlapY > 1e-7) return true
  const sharedVerticalEdge = Math.min(Math.abs(first.x + first.width - second.x), Math.abs(second.x + second.width - first.x)) <= 1e-7
  const sharedHorizontalEdge = Math.min(Math.abs(first.y + first.height - second.y), Math.abs(second.y + second.height - first.y)) <= 1e-7
  return (sharedVerticalEdge && overlapY > 1e-7) || (sharedHorizontalEdge && overlapX > 1e-7)
}

/** Immediate editor preview of the same exact-two-region bbox contact rule enforced by the backend. */
export function passageReviewPreview(elements: ReviewedPlanElement[], box: PassageBox) {
  const regions = elements.filter((item) => ['room', 'corridor', 'stairs', 'exit'].includes(item.type) && geometricallyTouches(box, item.bbox))
  const valid = regions.length === 2 && regions.every((region) => Boolean(region.label.trim()))
  const reason = !regions.length
    ? 'No navigable region intersects this passage.'
    : regions.length !== 2
      ? `Intersects ${regions.length} navigable regions (${regions.map((region) => region.label || region.id).join(', ')}); exactly two are required.`
      : regions.some((region) => !region.label.trim()) ? 'A connected region is missing its reviewed label.' : null
  return { regions, valid, reason }
}
