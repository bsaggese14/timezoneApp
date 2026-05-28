import { geoContains, type GeoProjection } from 'd3-geo'
import { countryLabelCandidates } from './countryLabelText'
import type { CountryFeature } from './geo'

/** Conservative width estimate for font-weight 500 labels. */
const CHAR_WIDTH_EM = 0.64
const LINE_HEIGHT_EM = 1.1
const MIN_FONT_SIZE = 0.35
const MAX_FONT_SIZE = 9

export interface CountryLabelLayout {
  x: number
  y: number
  fontSize: number
  displayName: string
}

function labelHalfExtents(fontSize: number, name: string): { halfW: number; halfH: number } {
  return {
    halfW: (fontSize * name.length * CHAR_WIDTH_EM) / 2,
    halfH: (fontSize * LINE_HEIGHT_EM) / 2,
  }
}

/** Sample the label bounding box densely so edge overflow is caught. */
function labelSamplePoints(
  x: number,
  y: number,
  fontSize: number,
  name: string,
): [number, number][] {
  const { halfW, halfH } = labelHalfExtents(fontSize, name)
  const pts: [number, number][] = [[x, y]]

  const along = 10
  for (let i = 0; i <= along; i++) {
    const t = i / along
    const px = x - halfW + t * 2 * halfW
    pts.push([px, y], [px, y - halfH], [px, y + halfH])
  }

  const vertical = 4
  for (let i = 1; i < vertical; i++) {
    const t = i / vertical
    const py = y - halfH + t * 2 * halfH
    pts.push([x - halfW, py], [x + halfW, py])
  }

  return pts
}

function labelFitsInCountry(
  feature: CountryFeature,
  projection: GeoProjection,
  x: number,
  y: number,
  fontSize: number,
  name: string,
): boolean {
  const invert = projection.invert
  if (!invert) return false

  for (const [px, py] of labelSamplePoints(x, y, fontSize, name)) {
    const geo = invert.call(projection, [px, py])
    if (!geo || !geoContains(feature, geo)) return false
  }
  return true
}

function maxFontSizeFromBounds(
  boundsWidth: number,
  boundsHeight: number,
  nameLength: number,
): number {
  return Math.min(
    MAX_FONT_SIZE,
    boundsHeight * 0.26,
    (boundsWidth * 0.68) / (nameLength * CHAR_WIDTH_EM),
  )
}

function largestFittingFontSize(
  feature: CountryFeature,
  projection: GeoProjection,
  x: number,
  y: number,
  name: string,
  upperBound: number,
): number {
  const cap = Math.max(MIN_FONT_SIZE, upperBound)
  if (labelFitsInCountry(feature, projection, x, y, cap, name)) return cap

  let low = MIN_FONT_SIZE
  let high = cap
  let best = 0

  while (high - low > 0.04) {
    const mid = (low + high) / 2
    if (labelFitsInCountry(feature, projection, x, y, mid, name)) {
      best = mid
      low = mid
    } else {
      high = mid
    }
  }

  return best
}

const POSITION_GRID = [-0.4, -0.25, -0.1, 0, 0.1, 0.25, 0.4]

function bestLayoutForName(
  feature: CountryFeature,
  projection: GeoProjection,
  anchorX: number,
  anchorY: number,
  displayName: string,
  boundsWidth: number,
  boundsHeight: number,
): CountryLabelLayout | null {
  const sizeCap = maxFontSizeFromBounds(
    boundsWidth,
    boundsHeight,
    displayName.length,
  )

  let best: CountryLabelLayout | null = null

  for (const dx of POSITION_GRID) {
    for (const dy of POSITION_GRID) {
      const x = anchorX + dx * boundsWidth
      const y = anchorY + dy * boundsHeight
      const fontSize = largestFittingFontSize(
        feature,
        projection,
        x,
        y,
        displayName,
        sizeCap,
      )
      if (fontSize < MIN_FONT_SIZE) continue

      if (!best || fontSize > best.fontSize) {
        best = { x, y, fontSize, displayName }
      }
    }
  }

  return best
}

/**
 * Prefer the full country name at the largest fitting size. Shorter labels
 * are used only when the full name cannot fit inside the country at any position.
 */
export function fitCountryLabelLayout(
  feature: CountryFeature,
  projection: GeoProjection,
  anchorX: number,
  anchorY: number,
  fullName: string,
  boundsWidth: number,
  boundsHeight: number,
): CountryLabelLayout {
  const candidates = countryLabelCandidates(fullName)

  for (const displayName of candidates) {
    const layout = bestLayoutForName(
      feature,
      projection,
      anchorX,
      anchorY,
      displayName,
      boundsWidth,
      boundsHeight,
    )
    if (layout) return layout
  }

  return {
    x: anchorX,
    y: anchorY,
    fontSize: MIN_FONT_SIZE,
    displayName: candidates[candidates.length - 1] ?? fullName,
  }
}
