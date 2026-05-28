import { useMemo } from 'react'
import { geoNaturalEarth1, geoPath, geoGraticule10 } from 'd3-geo'
import type { GeoPermissibleObjects } from 'd3-geo'

export function useMapProjection(
  width: number,
  height: number,
  geoObjects: GeoPermissibleObjects | null,
) {
  return useMemo(() => {
    if (width <= 0 || height <= 0) return null

    const projection = geoNaturalEarth1()
      .fitExtent(
        [
          [12, 12],
          [width - 12, height - 12],
        ],
        geoObjects ?? { type: 'Sphere' },
      )

    const pathGenerator = geoPath().projection(projection)
    const graticule = geoGraticule10()

    return { projection, pathGenerator, graticule }
  }, [width, height, geoObjects])
}
