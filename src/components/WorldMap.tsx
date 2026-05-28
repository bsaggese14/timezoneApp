import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  onMapPainted?: () => void;
  /** Defer expensive country labels until the app is interactive. */
  labelsEnabled?: boolean;
}

const ZOOM_PADDING = 48;
const ZOOM_ANIMATION_MS = 600;
/** How much of the fit-to-bounds zoom to apply (0.5 ≈ half as close). */
const ZOOM_INTENSITY = 0.5;

function scheduleIdleWork(callback: () => void, timeoutMs: number): number {
  if (typeof requestIdleCallback === "function") {
    return requestIdleCallback(callback, { timeout: timeoutMs });
  }
  return window.setTimeout(callback, 1);
}

function cancelIdleWork(id: number): void {
  if (typeof cancelIdleCallback === "function") {
    cancelIdleCallback(id);
    return;
  }
  window.clearTimeout(id);
}

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
  onMapPainted,
  labelsEnabled = false,
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [showCountryLabels, setShowCountryLabels] = useState(false);
  const [hoverTooltipsEnabled, setHoverTooltipsEnabled] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches,
  );

  const projectionGeo = useMemo((): GeoPermissibleObjects => {
    return { type: "FeatureCollection", features: timezones };
  }, [timezones]);

  const mapProjection = useMapProjection(size.width, size.height, projectionGeo);
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

  const timezoneGeometries = useMemo(() => {
    if (!mapProjection) return [];
    const { pathGenerator } = mapProjection;
    return timezones.map((f) => ({
      tzid: f.properties.tzid,
      d: pathGenerator(f) ?? "",
    }));
  }, [timezones, mapProjection]);

  const timezonePaths = useMemo(() => {
    return timezoneGeometries.map(({ tzid, d }) => {
      const lateness = scores.get(tzid);
      const score = lateness?.score ?? 0;
      return {
        tzid,
        d,
        fill: scoreToFill(score, colorRed, lateness?.sameWorkHours ?? false),
      };
    });
  }, [timezoneGeometries, scores, colorRed]);

  const countryPaths = useMemo(() => {
    if (!mapProjection) return [];
    const { pathGenerator } = mapProjection;
    return countries.map((f) => ({
      id: f.properties.name,
      d: pathGenerator(f) ?? "",
    }));
  }, [countries, mapProjection]);

  useEffect(() => {
    if (!labelsEnabled || !mapProjection) return;
    const id = scheduleIdleWork(() => setShowCountryLabels(true), 3000);
    return () => {
      cancelIdleWork(id);
      setShowCountryLabels(false);
    };
  }, [labelsEnabled, mapProjection, countries, timezones]);

  const countryLabels = useMemo(() => {
    if (!showCountryLabels || !mapProjection) return [];
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
  }, [countries, mapProjection, showCountryLabels]);

  useLayoutEffect(() => {
    if (
      !onMapPainted ||
      size.width <= 0 ||
      size.height <= 0 ||
      timezoneGeometries.length === 0
    ) {
      return;
    }
    const frame = requestAnimationFrame(() => onMapPainted());
    return () => cancelAnimationFrame(frame);
  }, [onMapPainted, size.width, size.height, timezoneGeometries.length]);

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
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const onChange = () => setHoverTooltipsEnabled(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

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
      .on("start", () => {
        setTooltip(null);
      })
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

  const updateTooltip = useCallback(
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

  const onTzClick = useCallback(
    (e: React.MouseEvent, tzid: string) => {
      onSelectTzids([tzid]);
      updateTooltip(e, tzid);

      const lngLat = lngLatFromMouseEvent(e);
      if (!lngLat) return;

      const countryName = countryAtPoint(countries, lngLat);
      if (countryName) onCountrySearchChange(countryName);
    },
    [
      countries,
      lngLatFromMouseEvent,
      onCountrySearchChange,
      onSelectTzids,
      updateTooltip,
    ],
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
                  onMouseMove={
                    hoverTooltipsEnabled
                      ? (e) => updateTooltip(e, tzid)
                      : undefined
                  }
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
      <MapTooltip tooltip={tooltip} onDismiss={() => setTooltip(null)} />
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
