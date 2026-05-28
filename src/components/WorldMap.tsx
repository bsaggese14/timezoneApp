import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { easeCubicInOut } from "d3-ease";
import { select } from "d3-selection";
import "d3-transition";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { interpolateReds } from "d3-scale-chromatic";
import type { GeoPermissibleObjects } from "d3-geo";
import { useMapProjection } from "../hooks/useMapProjection";
import { scoreToFill, workHoursRangesInZone } from "../lib/workHours";
import type { UserWorkHours, ZoneLateness } from "../lib/workHours";
import { fitCountryLabelLayout } from "../lib/countryLabelFit";
import {
  countryAtPoint,
  getCountryLabelPoint,
  getCountryMainLandFeature,
  type CountryFeature,
  type TimezoneFeature,
} from "../lib/geo";
import { MapTooltip, type TooltipState } from "./MapTooltip";

interface WorldMapProps {
  countries: CountryFeature[];
  timezones: TimezoneFeature[];
  scores: Map<string, ZoneLateness>;
  userTz: string;
  userWorkHours: UserWorkHours;
  hoveredTzids: string[] | null;
  onHoverTzids: (tzids: string[] | null) => void;
  selectedTzids: string[] | null;
  onSelectTzids: (tzids: string[] | null) => void;
  resetViewNonce: number;
  onResetMapView: () => void;
  onCountrySearchChange: (value: string) => void;
}

const ZOOM_PADDING = 48;
const ZOOM_ANIMATION_MS = 600;
/** How much of the fit-to-bounds zoom to apply (0.5 ≈ half as close). */
const ZOOM_INTENSITY = 0.5;

function applyAnimatedTransform(
  svg: SVGSVGElement,
  behavior: ZoomBehavior<SVGSVGElement, unknown>,
  transform: ZoomTransform,
) {
  select(svg)
    .transition()
    .duration(ZOOM_ANIMATION_MS)
    .ease(easeCubicInOut)
    .call(behavior.transform, transform);
}

export function WorldMap({
  countries,
  timezones,
  scores,
  userTz,
  userWorkHours,
  hoveredTzids,
  onHoverTzids,
  selectedTzids,
  onSelectTzids,
  resetViewNonce,
  onResetMapView,
  onCountrySearchChange,
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const combinedGeo = useMemo((): GeoPermissibleObjects => {
    return {
      type: "FeatureCollection",
      features: [...timezones, ...countries],
    };
  }, [countries, timezones]);

  const mapProjection = useMapProjection(size.width, size.height, combinedGeo);
  const colorRed = useMemo(() => interpolateReds, []);

  const timezoneById = useMemo(() => {
    const map = new Map<string, TimezoneFeature>();
    for (const f of timezones) map.set(f.properties.tzid, f);
    return map;
  }, [timezones]);

  const highlightedTzids = useMemo(() => {
    const set = new Set<string>();
    for (const tzid of hoveredTzids ?? []) set.add(tzid);
    for (const tzid of selectedTzids ?? []) set.add(tzid);
    return set;
  }, [hoveredTzids, selectedTzids]);

  const timezonePaths = useMemo(() => {
    if (!mapProjection) return [];
    const { pathGenerator } = mapProjection;
    return timezones.map((f) => {
      const tzid = f.properties.tzid;
      const lateness = scores.get(tzid);
      const score = lateness?.score ?? 0;
      return {
        tzid,
        d: pathGenerator(f) ?? "",
        fill: scoreToFill(score, colorRed, lateness?.sameWorkHours ?? false),
      };
    });
  }, [timezones, scores, mapProjection, colorRed]);

  const countryPaths = useMemo(() => {
    if (!mapProjection) return [];
    const { pathGenerator } = mapProjection;
    return countries.map((f) => ({
      id: f.properties.name,
      d: pathGenerator(f) ?? "",
    }));
  }, [countries, mapProjection]);

  const countryLabels = useMemo(() => {
    if (!mapProjection) return [];
    const { projection, pathGenerator } = mapProjection;
    return countries
      .map((f) => {
        const point = getCountryLabelPoint(f);
        if (!point) return null;
        const projected = projection(point);
        if (!projected) return null;

        const mainLand = getCountryMainLandFeature(f) ?? f;
        const [[x0, y0], [x1, y1]] = pathGenerator.bounds(mainLand);
        const w = x1 - x0;
        const h = y1 - y0;
        if (!Number.isFinite(w) || !Number.isFinite(h) || w < 0.5 || h < 0.5) {
          return null;
        }

        const name = f.properties.name;
        const layout = fitCountryLabelLayout(
          mainLand,
          projection,
          projected[0],
          projected[1],
          name,
          w,
          h,
        );

        const { x, y, fontSize, displayName } = layout;

        return {
          name,
          displayName,
          x,
          y,
          fontSize,
          strokeWidth: Math.max(0.3, fontSize * 0.16),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [countries, mapProjection]);

  const graticulePath = useMemo(() => {
    if (!mapProjection) return "";
    return mapProjection.pathGenerator(mapProjection.graticule) ?? "";
  }, [mapProjection]);

  const zoomToTimezones = useCallback(
    (tzids: string[]) => {
      const svg = svgRef.current;
      const behavior = zoomRef.current;
      if (!svg || !behavior || !mapProjection) return;

      const features = tzids
        .map((tzid) => timezoneById.get(tzid))
        .filter((f): f is TimezoneFeature => f != null);
      if (features.length === 0) return;

      const { width, height } = size;
      if (width <= 0 || height <= 0) return;

      const { pathGenerator } = mapProjection;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const feature of features) {
        const [[fx0, fy0], [fx1, fy1]] = pathGenerator.bounds(feature);
        x0 = Math.min(x0, fx0);
        y0 = Math.min(y0, fy0);
        x1 = Math.max(x1, fx1);
        y1 = Math.max(y1, fy1);
      }

      const dx = x1 - x0;
      const dy = y1 - y0;
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx < 1 && dy < 1)) {
        return;
      }

      const innerW = width - ZOOM_PADDING * 2;
      const innerH = height - ZOOM_PADDING * 2;
      const fitScale = Math.min(
        12,
        Math.max(1, 0.92 / Math.max(dx / innerW, dy / innerH)),
      );
      const scale = 1 + (fitScale - 1) * ZOOM_INTENSITY;
      const x = (x0 + x1) / 2;
      const y = (y0 + y1) / 2;
      const transform = zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-x, -y);

      applyAnimatedTransform(svg, behavior, transform);
    },
    [mapProjection, size, timezoneById],
  );

  const resetZoom = useCallback(() => {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    if (!svg || !behavior) return;

    applyAnimatedTransform(svg, behavior, zoomIdentity);
  }, []);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      requestAnimationFrame(() => setSize({ width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // D3 zoom
  useEffect(() => {
    const svg = svgRef.current;
    const g = gRef.current;
    if (!svg || !g) return;

    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 12])
      .on("zoom", (event) => {
        select(g).attr("transform", event.transform.toString());
      });

    zoomRef.current = zoomBehavior;
    const sel = select(svg).call(zoomBehavior);
    sel.on("dblclick.zoom", null);

    return () => {
      zoomRef.current = null;
      sel.on(".zoom", null);
    };
  }, [size.width, size.height]);

  useEffect(() => {
    if (selectedTzids && selectedTzids.length > 0) {
      zoomToTimezones(selectedTzids);
    }
  }, [selectedTzids, zoomToTimezones]);

  useEffect(() => {
    if (resetViewNonce > 0) resetZoom();
  }, [resetViewNonce, resetZoom]);

  const lngLatFromMouseEvent = useCallback(
    (e: React.MouseEvent): [number, number] | null => {
      const g = gRef.current;
      const svg = svgRef.current;
      const projection = mapProjection?.projection;
      if (!g || !svg || !projection) return null;

      const svgPt = svg.createSVGPoint();
      svgPt.x = e.clientX;
      svgPt.y = e.clientY;
      const ctm = g.getScreenCTM();
      if (!ctm) return null;

      const local = svgPt.matrixTransform(ctm.inverse());
      const invert = projection.invert;
      if (!invert) return null;
      const lngLat = invert.call(projection, [local.x, local.y]);
      return lngLat ?? null;
    },
    [mapProjection],
  );

  const onTzClick = useCallback(
    (e: React.MouseEvent, tzid: string) => {
      onSelectTzids([tzid]);

      const lngLat = lngLatFromMouseEvent(e);
      if (!lngLat) return;

      const countryName = countryAtPoint(countries, lngLat);
      if (countryName) onCountrySearchChange(countryName);
    },
    [countries, lngLatFromMouseEvent, onCountrySearchChange, onSelectTzids],
  );

  const onTzMouseMove = useCallback(
    (e: React.MouseEvent, tzid: string) => {
      const lateness = scores.get(tzid);
      if (!lateness) return;

      const lngLat = lngLatFromMouseEvent(e);
      const countryName = lngLat ? countryAtPoint(countries, lngLat) : null;

      setTooltip({
        x: e.clientX,
        y: e.clientY,
        countryName,
        tzid,
        lateness,
        workHours: workHoursRangesInZone(userTz, tzid, userWorkHours),
        userWorkHours,
      });
    },
    [countries, lngLatFromMouseEvent, scores, userTz, userWorkHours],
  );

  const isDimmed = highlightedTzids.size > 0;

  return (
    <div ref={containerRef} className="world-map-container">
      <svg
        ref={svgRef}
        className="world-map"
        width={size.width}
        height={size.height}
        role="img"
        aria-label="World map colored by how late your work start is in each timezone"
      >
        <rect
          className="ocean"
          width={size.width}
          height={size.height}
          fill="#c8dce8"
        />
        <g ref={gRef}>
          {graticulePath && (
            <path d={graticulePath} className="graticule" fill="none" />
          )}
          <g className="timezone-fills">
            {timezonePaths.map(({ tzid, d, fill }) => {
              const highlighted = highlightedTzids.has(tzid);
              const dimmed = isDimmed && !highlighted;
              return (
                <path
                  key={tzid}
                  data-tzid={tzid}
                  d={d}
                  fill={fill}
                  stroke="none"
                  className={`tz-fill${highlighted ? " tz-fill--highlighted" : ""}${dimmed ? " tz-fill--dimmed" : ""}`}
                  onMouseEnter={() => onHoverTzids([tzid])}
                  onMouseLeave={() => {
                    onHoverTzids(null);
                    setTooltip(null);
                  }}
                  onMouseMove={(e) => onTzMouseMove(e, tzid)}
                  onClick={(e) => onTzClick(e, tzid)}
                />
              );
            })}
          </g>
          <g className="timezone-lines">
            {timezonePaths.map(({ tzid, d }) => {
              const highlighted = highlightedTzids.has(tzid);
              return (
                <path
                  key={`line-${tzid}`}
                  d={d}
                  fill="none"
                  stroke={highlighted ? "#2b6cb0" : "#4a5568"}
                  strokeWidth={highlighted ? 1 : 0.35}
                  strokeOpacity={highlighted ? 0.95 : 0.55}
                  pointerEvents="none"
                />
              );
            })}
          </g>
          <g className="countries">
            {countryPaths.map(({ id, d }) => (
              <path
                key={id}
                d={d}
                fill="none"
                stroke="#1a202c"
                strokeWidth={0.6}
                pointerEvents="none"
              />
            ))}
          </g>
          <g className="country-labels" pointerEvents="none">
            {countryLabels.map(({ name, displayName, x, y, fontSize, strokeWidth }) => (
              <text
                key={name}
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="country-label"
                fontSize={fontSize}
                strokeWidth={strokeWidth}
              >
                {displayName}
              </text>
            ))}
          </g>
        </g>
      </svg>
      <MapTooltip tooltip={tooltip} />
      <button
        type="button"
        className="map-reset-view"
        onClick={onResetMapView}
        aria-label="Reset map view"
      >
        Reset view
      </button>
    </div>
  );
}
