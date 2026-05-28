import { geoArea } from 'd3-geo'
import type { Feature, Geometry, Position } from 'geojson'

const SPHERE_AREA = 4 * Math.PI

function rewindRing(ring: Position[]): Position[] {
  const ringFeature = { type: 'Polygon' as const, coordinates: [ring] }
  return geoArea(ringFeature) > SPHERE_AREA / 2 ? ring.slice().reverse() : ring
}

/** Fix inverted polygon winding so d3-geo does not treat zones as covering the whole globe. */
export function rewindFeature<G extends Geometry, P>(
  feature: Feature<G, P>,
): Feature<G, P> {
  const { geometry } = feature
  if (geometry.type === 'Polygon') {
    return {
      ...feature,
      geometry: {
        type: 'Polygon',
        coordinates: geometry.coordinates.map(rewindRing),
      } as G,
    }
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      ...feature,
      geometry: {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map((polygon) =>
          polygon.map(rewindRing),
        ),
      } as G,
    }
  }
  return feature
}
