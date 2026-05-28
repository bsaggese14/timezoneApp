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

type GeoBounds = [[number, number], [number, number]];

function boundsOverlap(a: GeoBounds, b: GeoBounds): boolean {
  return (
    a[0][0] <= b[1][0] &&
    a[1][0] >= b[0][0] &&
    a[0][1] <= b[1][1] &&
    a[1][1] >= b[0][1]
  );
}

function sampleRingPoints(ring: Position[], maxSamples: number): Position[] {
  if (ring.length <= maxSamples) return ring;
  const step = Math.max(1, Math.floor(ring.length / maxSamples));
  const out: Position[] = [];
  for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
  return out;
}

function timezoneOverlapsCountry(
  tz: TimezoneFeature,
  country: CountryFeature,
): boolean {
  const label = getCountryLabelPoint(country);
  if (label && geoContains(tz, label)) return true;

  try {
    const tzCenter = geoCentroid(tz);
    if (geoContains(country, tzCenter)) return true;
  } catch {
    /* invalid geometry */
  }

  for (const poly of getPolygons(country.geometry)) {
    const ring = poly[0];
    if (!ring) continue;
    for (const p of sampleRingPoints(ring, 16)) {
      if (geoContains(tz, p as [number, number])) return true;
    }
  }

  for (const poly of getPolygons(tz.geometry)) {
    const ring = poly[0];
    if (!ring) continue;
    for (const p of sampleRingPoints(ring, 8)) {
      if (geoContains(country, p as [number, number])) return true;
    }
  }

  return false;
}

/** Country whose land contains the timezone centroid, else largest sampled overlap. */
export function primaryCountryForTimezone(
  tz: TimezoneFeature,
  countries: CountryFeature[],
): string | null {
  try {
    const center = geoCentroid(tz);
    for (const country of countries) {
      if (geoContains(country, center)) return country.properties.name;
    }
  } catch {
    /* invalid geometry */
  }

  let bestCountry: string | null = null;
  let bestCount = 0;

  for (const country of countries) {
    if (!timezoneOverlapsCountry(tz, country)) continue;

    let count = 0;
    for (const poly of getPolygons(tz.geometry)) {
      const ring = poly[0];
      if (!ring) continue;
      for (const p of sampleRingPoints(ring, 24)) {
        if (geoContains(country, p as [number, number])) count++;
      }
    }

    if (count > bestCount) {
      bestCount = count;
      bestCountry = country.properties.name;
    }
  }

  return bestCountry;
}

export function primaryCountryByTimezone(
  countries: CountryFeature[],
  timezones: TimezoneFeature[],
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const tz of timezones) {
    map.set(tz.properties.tzid, primaryCountryForTimezone(tz, countries));
  }
  return map;
}

/** One row per country–timezone overlap on the map. */
export function countryTimezonePairs(
  countries: CountryFeature[],
  timezones: TimezoneFeature[],
): CountryTimezonePair[] {
  const pairs: CountryTimezonePair[] = [];
  const tzBoundsCache = new Map<TimezoneFeature, GeoBounds>();

  for (const country of countries) {
    const countryBounds = geoBounds(country);
    const matched: string[] = [];

    for (const tz of timezones) {
      let tzBounds = tzBoundsCache.get(tz);
      if (!tzBounds) {
        tzBounds = geoBounds(tz);
        tzBoundsCache.set(tz, tzBounds);
      }
      if (!boundsOverlap(countryBounds, tzBounds)) continue;
      if (timezoneOverlapsCountry(tz, country)) {
        matched.push(tz.properties.tzid);
      }
    }

    matched.sort();
    for (const tzid of matched) {
      pairs.push({ countryName: country.properties.name, tzid });
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
