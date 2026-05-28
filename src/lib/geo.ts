import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import type { Topology, Objects } from "topojson-specification";
import { feature } from "topojson-client";
import { geoArea, geoBounds, geoCentroid, geoContains } from "d3-geo";
import polylabel from "polylabel";
import { rewindFeature } from "./rewindGeo";

export interface CountryProperties {
  name: string;
}

export interface TimezoneProperties {
  tzid: string;
}

export type CountryFeature = Feature<Geometry, CountryProperties>;
export type TimezoneFeature = Feature<Geometry, TimezoneProperties>;

export async function loadCountries(): Promise<CountryFeature[]> {
  const res = await fetch("/data/countries-110m.json");
  if (!res.ok) throw new Error("Failed to load countries");
  const topology = (await res.json()) as Topology<Objects>;
  const countries = feature(
    topology,
    topology.objects.countries,
  ) as unknown as FeatureCollection<Geometry, CountryProperties>;
  return countries.features.filter((f) => f.properties?.name);
}

export async function loadTimezones(): Promise<TimezoneFeature[]> {
  const res = await fetch("/data/timezones.simplified.geojson");
  if (!res.ok) throw new Error("Failed to load timezones");
  const collection = (await res.json()) as FeatureCollection<
    Geometry,
    TimezoneProperties
  >;
  return collection.features.map((f) => rewindFeature(f));
}

export async function loadTimezoneIndex(): Promise<string[]> {
  const res = await fetch("/data/timezone-index.json");
  if (!res.ok) throw new Error("Failed to load timezone index");
  return res.json();
}

/** Major cities per IANA timezone (built from city-timezones). */
export type TimezoneCities = Record<string, string[]>;

export async function loadTimezoneCities(): Promise<Map<string, string[]>> {
  const res = await fetch("/data/timezone-cities.json");
  if (!res.ok) throw new Error("Failed to load timezone cities");
  const data = (await res.json()) as TimezoneCities;
  return new Map(Object.entries(data));
}

export const US_COUNTRY_NAME = "United States of America";

export interface UsSearchData {
  country: string;
  stateToTimezones: Map<string, string[]>;
  abbrevToState: Map<string, string>;
}

export async function loadUsSearch(): Promise<UsSearchData | null> {
  const res = await fetch("/data/us-search.json");
  if (!res.ok) return null;
  const data = (await res.json()) as {
    country: string;
    stateToTimezones: Record<string, string[]>;
    stateAbbreviations: Record<string, string>;
  };
  return {
    country: data.country,
    stateToTimezones: new Map(Object.entries(data.stateToTimezones)),
    abbrevToState: new Map(Object.entries(data.stateAbbreviations)),
  };
}

type PolygonCoords = Position[][];

function getPolygons(geometry: Geometry): PolygonCoords[] {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function largestPolygonCoords(geometry: Geometry): PolygonCoords | null {
  const polys = getPolygons(geometry);
  if (polys.length === 0) return null;

  let best = polys[0];
  let bestArea = geoArea({ type: "Polygon", coordinates: best });
  for (let i = 1; i < polys.length; i++) {
    const area = geoArea({ type: "Polygon", coordinates: polys[i] });
    if (area > bestArea) {
      bestArea = area;
      best = polys[i];
    }
  }
  return best;
}

/** Main landmass polygon (largest part), used for label sizing and placement. */
export function getCountryMainLandFeature(
  f: CountryFeature,
): CountryFeature | null {
  const coords = largestPolygonCoords(f.geometry);
  if (!coords) return null;
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: coords },
    properties: f.properties,
  };
}

export interface CountryTimezonePair {
  countryName: string;
  tzid: string;
}

export interface GeoIndexData {
  pairs: CountryTimezonePair[];
  primaryCountryByTz: Map<string, string | null>;
}

type GeoBounds = [[number, number], [number, number]];

interface CountryMeta {
  feature: CountryFeature;
  name: string;
  bounds: GeoBounds;
  label: [number, number] | null;
}

interface TimezoneMeta {
  feature: TimezoneFeature;
  tzid: string;
  bounds: GeoBounds;
  center: [number, number];
}

function buildCountryMeta(countries: CountryFeature[]): CountryMeta[] {
  return countries.map((feature) => ({
    feature,
    name: feature.properties.name,
    bounds: geoBounds(feature),
    label: getCountryLabelPoint(feature),
  }));
}

function buildTimezoneMeta(timezones: TimezoneFeature[]): TimezoneMeta[] {
  return timezones.map((feature) => {
    let center: [number, number] = [0, 0];
    try {
      center = geoCentroid(feature) as [number, number];
    } catch {
      /* invalid geometry */
    }
    return {
      feature,
      tzid: feature.properties.tzid,
      bounds: geoBounds(feature),
      center,
    };
  });
}

function timezoneOverlapsCountryFast(
  tz: TimezoneMeta,
  country: CountryMeta,
): boolean {
  if (!boundsOverlap(country.bounds, tz.bounds)) return false;
  if (country.label && geoContains(tz.feature, country.label)) return true;
  if (geoContains(country.feature, tz.center)) return true;
  try {
    if (geoContains(tz.feature, geoCentroid(country.feature))) return true;
  } catch {
    /* invalid geometry */
  }
  return false;
}

export async function loadGeoIndex(): Promise<GeoIndexData | null> {
  const res = await fetch("/data/geo-index.json");
  if (!res.ok) return null;
  const data = (await res.json()) as {
    pairs: CountryTimezonePair[];
    primaryCountryByTz: Record<string, string | null>;
  };
  return {
    pairs: data.pairs,
    primaryCountryByTz: new Map(Object.entries(data.primaryCountryByTz)),
  };
}

function boundsOverlap(a: GeoBounds, b: GeoBounds): boolean {
  return (
    a[0][0] <= b[1][0] &&
    a[1][0] >= b[0][0] &&
    a[0][1] <= b[1][1] &&
    a[1][1] >= b[0][1]
  );
}

/** Country whose land contains the timezone centroid (fast path). */
export function primaryCountryForTimezone(
  tz: TimezoneFeature,
  countries: CountryFeature[],
  countryMeta?: CountryMeta[],
  tzMeta?: TimezoneMeta,
): string | null {
  const meta =
    tzMeta ??
    ({
      feature: tz,
      tzid: tz.properties.tzid,
      bounds: geoBounds(tz),
      center: geoCentroid(tz) as [number, number],
    } satisfies TimezoneMeta);
  const countriesList = countryMeta ?? buildCountryMeta(countries);

  for (const country of countriesList) {
    if (!boundsOverlap(country.bounds, meta.bounds)) continue;
    if (geoContains(country.feature, meta.center)) return country.name;
  }
  return null;
}

export function primaryCountryByTimezone(
  countries: CountryFeature[],
  timezones: TimezoneFeature[],
): Map<string, string | null> {
  const countryMeta = buildCountryMeta(countries);
  const timezoneMeta = buildTimezoneMeta(timezones);
  const map = new Map<string, string | null>();
  for (const tz of timezoneMeta) {
    map.set(
      tz.tzid,
      primaryCountryForTimezone(tz.feature, countries, countryMeta, tz),
    );
  }
  return map;
}

/** One row per country–timezone overlap on the map. */
export function countryTimezonePairs(
  countries: CountryFeature[],
  timezones: TimezoneFeature[],
): CountryTimezonePair[] {
  const countryMeta = buildCountryMeta(countries);
  const timezoneMeta = buildTimezoneMeta(timezones);
  const pairs: CountryTimezonePair[] = [];

  for (const country of countryMeta) {
    const matched: string[] = [];
    for (const tz of timezoneMeta) {
      if (timezoneOverlapsCountryFast(tz, country)) {
        matched.push(tz.tzid);
      }
    }
    matched.sort();
    for (const tzid of matched) {
      pairs.push({ countryName: country.name, tzid });
    }
  }

  return pairs;
}

/** Country whose geometry contains the point; smallest match wins when several overlap. */
export function countryAtPoint(
  countries: CountryFeature[],
  point: [number, number],
): string | null {
  let best: CountryFeature | null = null;
  let bestArea = Infinity;
  for (const country of countries) {
    if (!geoContains(country, point)) continue;
    const area = geoArea(country);
    if (area < bestArea) {
      bestArea = area;
      best = country;
    }
  }
  return best?.properties.name ?? null;
}

/** Timezone polygon containing the country's label point, if any. */
export function timezoneAtCountryLabel(
  country: CountryFeature,
  timezones: TimezoneFeature[],
): string | null {
  const point = getCountryLabelPoint(country);
  if (!point) return null;
  for (const tz of timezones) {
    if (geoContains(tz, point)) return tz.properties.tzid;
  }
  return null;
}

/** Interior point of the country's main landmass (largest polygon). */

export function getCountryLabelPoint(
  f: CountryFeature,
): [number, number] | null {
  try {
    const coords = largestPolygonCoords(f.geometry);
    if (!coords) return null;

    const p = polylabel(coords, 0.25);
    const lon = p[0];
    const lat = p[1];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return [lon, lat];
  } catch {
    return null;
  }
}

export function detectUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export function timezoneFromQuery(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("tz");
}
