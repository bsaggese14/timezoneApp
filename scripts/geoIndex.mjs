/**
 * Build country↔timezone index (run during npm run data:build).
 */
import { geoBounds, geoCentroid, geoContains } from 'd3-geo'
import polylabel from 'polylabel'

function getPolygons(geometry) {
  if (geometry.type === 'Polygon') return [geometry.coordinates]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates
  return []
}

function largestPolygonCoords(geometry) {
  const polys = getPolygons(geometry)
  if (polys.length === 0) return null
  let best = polys[0]
  let bestLen = best[0]?.length ?? 0
  for (let i = 1; i < polys.length; i++) {
    const len = polys[i][0]?.length ?? 0
    if (len > bestLen) {
      bestLen = len
      best = polys[i]
    }
  }
  return best
}

function getCountryLabelPoint(feature) {
  try {
    const coords = largestPolygonCoords(feature.geometry)
    if (!coords) return null
    const p = polylabel(coords, 0.25)
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null
    return [p[0], p[1]]
  } catch {
    return null
  }
}

function boundsOverlap(a, b) {
  return (
    a[0][0] <= b[1][0] &&
    a[1][0] >= b[0][0] &&
    a[0][1] <= b[1][1] &&
    a[1][1] >= b[0][1]
  )
}

function buildCountryMeta(countries) {
  return countries.map((feature) => ({
    feature,
    name: feature.properties.name,
    bounds: geoBounds(feature),
    label: getCountryLabelPoint(feature),
  }))
}

function timezoneOverlapsCountry(tz, meta) {
  if (!boundsOverlap(meta.bounds, tz.bounds)) return false
  if (meta.label && geoContains(tz.feature, meta.label)) return true
  if (geoContains(meta.feature, tz.center)) return true
  try {
    if (geoContains(tz.feature, meta.centroid)) return true
  } catch {
    /* invalid */
  }
  return false
}

function buildTimezoneMeta(timezones) {
  return timezones.map((feature) => {
    let center
    let centroid
    try {
      center = geoCentroid(feature)
      centroid = center
    } catch {
      center = [0, 0]
      centroid = center
    }
    return {
      feature,
      tzid: feature.properties.tzid,
      bounds: geoBounds(feature),
      center,
      centroid,
    }
  })
}

export function buildGeoIndexJson(countries, timezones) {
  const countryMeta = buildCountryMeta(countries)
  const timezoneMeta = buildTimezoneMeta(timezones)

  const pairs = []
  for (const country of countryMeta) {
    const matched = []
    for (const tz of timezoneMeta) {
      if (timezoneOverlapsCountry(tz, country)) {
        matched.push(tz.tzid)
      }
    }
    matched.sort()
    for (const tzid of matched) {
      pairs.push({ countryName: country.name, tzid })
    }
  }

  const primaryCountryByTz = {}
  for (const tz of timezoneMeta) {
    let found = null
    for (const country of countryMeta) {
      if (!boundsOverlap(country.bounds, tz.bounds)) continue
      if (geoContains(country.feature, tz.center)) {
        found = country.name
        break
      }
    }
    primaryCountryByTz[tz.tzid] = found
  }

  return { pairs, primaryCountryByTz }
}
