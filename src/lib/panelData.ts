import { interpolateReds } from "d3-scale-chromatic";
import {
  countryTimezonePairs,
  loadGeoIndex,
  primaryCountryByTimezone,
  type CountryFeature,
  type GeoIndexData,
  type TimezoneFeature,
  type UsSearchData,
} from "./geo";
import {
  scoreToFill,
  workHoursRangesInZone,
  workHoursSignature,
  type UserWorkHours,
  type WorkHoursRange,
  type ZoneLateness,
} from "./workHours";

export interface CountryTimezonePair {
  countryName: string;
  tzid: string;
}

export interface CountryRow {
  countryName: string;
  tzid: string;
  cities: string[];
  lateness: ZoneLateness | null;
  workHours: WorkHoursRange[];
  fill: string;
  sameWorkHours: boolean;
}

export interface HourGroup {
  key: string;
  countryName: string;
  tzids: string[];
  lateness: ZoneLateness | null;
  workHours: WorkHoursRange[];
  fill: string;
  sameWorkHours: boolean;
  includesUserTz: boolean;
}

export interface GeoIndex {
  pairs: CountryTimezonePair[];
  primaryCountryByTz: Map<string, string | null>;
}

export interface PanelTableData {
  rows: CountryRow[];
  hourGroups: HourGroup[];
  countrySearchIndex: Map<string, Set<string>>;
}

export function buildGeoIndex(
  countries: CountryFeature[],
  timezones: TimezoneFeature[],
): GeoIndex {
  return {
    pairs: countryTimezonePairs(countries, timezones),
    primaryCountryByTz: primaryCountryByTimezone(countries, timezones),
  };
}

export async function resolveGeoIndex(
  countries: CountryFeature[],
  timezones: TimezoneFeature[],
): Promise<GeoIndex> {
  const cached: GeoIndexData | null = await loadGeoIndex();
  if (cached) return cached;
  return buildGeoIndex(countries, timezones);
}

function listSortTier(row: CountryRow, userTz: string): number {
  if (row.tzid === userTz) return 0;
  return 1;
}

function rowLatenessScore(row: CountryRow): number {
  return row.lateness?.score ?? -1;
}

function isUserTimezonePrimaryCountry(
  row: CountryRow,
  userTz: string,
  primaryCountryByTz: Map<string, string | null>,
): boolean {
  const userPrimary = primaryCountryByTz.get(userTz);
  return userPrimary != null && row.countryName === userPrimary;
}

export function compareCountryTimezoneRows(
  a: CountryRow,
  b: CountryRow,
  userTz: string,
  primaryCountryByTz: Map<string, string | null>,
): number {
  const tierA = listSortTier(a, userTz);
  const tierB = listSortTier(b, userTz);
  if (tierA !== tierB) return tierA - tierB;

  const aUserCountry = isUserTimezonePrimaryCountry(
    a,
    userTz,
    primaryCountryByTz,
  );
  const bUserCountry = isUserTimezonePrimaryCountry(
    b,
    userTz,
    primaryCountryByTz,
  );
  if (aUserCountry !== bUserCountry) return aUserCountry ? -1 : 1;

  if (tierA === 0) {
    if (a.tzid !== b.tzid) return a.tzid.localeCompare(b.tzid);
    return a.countryName.localeCompare(b.countryName);
  }

  const scoreA = rowLatenessScore(a);
  const scoreB = rowLatenessScore(b);
  if (scoreA !== scoreB) return scoreA - scoreB;
  if (a.tzid !== b.tzid) return a.tzid.localeCompare(b.tzid);
  return a.countryName.localeCompare(b.countryName);
}

function compareHourGroups(
  a: HourGroup,
  b: HourGroup,
  userTz: string,
  primaryCountryByTz: Map<string, string | null>,
): number {
  const repA: CountryRow = {
    countryName: a.countryName,
    tzid: a.tzids[0] ?? "",
    cities: [],
    lateness: a.lateness,
    workHours: a.workHours,
    fill: a.fill,
    sameWorkHours: a.sameWorkHours,
  };
  const repB: CountryRow = {
    countryName: b.countryName,
    tzid: b.tzids[0] ?? "",
    cities: [],
    lateness: b.lateness,
    workHours: b.workHours,
    fill: b.fill,
    sameWorkHours: b.sameWorkHours,
  };
  return compareCountryTimezoneRows(repA, repB, userTz, primaryCountryByTz);
}

export function buildCountryRows(
  pairs: CountryTimezonePair[],
  scores: Map<string, ZoneLateness>,
  userTz: string,
  userWorkHours: UserWorkHours,
  citiesByTimezone: Map<string, string[]>,
  primaryCountryByTz: Map<string, string | null>,
): CountryRow[] {
  const colorRed = interpolateReds;
  const built = pairs.map(({ countryName, tzid }) => {
    const lateness = scores.get(tzid) ?? null;
    const workHours = workHoursRangesInZone(userTz, tzid, userWorkHours);
    const score = lateness?.score ?? 0;
    const fill =
      lateness != null
        ? scoreToFill(score, colorRed, lateness.sameWorkHours)
        : "#e2e8f0";

    return {
      countryName,
      tzid,
      cities: citiesByTimezone.get(tzid) ?? [],
      lateness,
      workHours,
      fill,
      sameWorkHours: lateness?.sameWorkHours ?? false,
    };
  });

  return built.sort((a, b) =>
    compareCountryTimezoneRows(a, b, userTz, primaryCountryByTz),
  );
}

export function buildHourGroups(
  rows: CountryRow[],
  userTz: string,
  primaryCountryByTz: Map<string, string | null>,
): HourGroup[] {
  const byKey = new Map<string, HourGroup>();

  for (const row of rows) {
    const key = `${row.countryName}\0${workHoursSignature(row.workHours)}`;
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        countryName: row.countryName,
        tzids: [],
        lateness: row.lateness,
        workHours: row.workHours,
        fill: row.fill,
        sameWorkHours: row.sameWorkHours,
        includesUserTz: false,
      };
      byKey.set(key, group);
    }

    if (!group.tzids.includes(row.tzid)) {
      group.tzids.push(row.tzid);
    }
    if (row.tzid === userTz) group.includesUserTz = true;
  }

  const groups = [...byKey.values()];
  for (const group of groups) {
    group.tzids.sort((a, b) => a.localeCompare(b));
  }

  return groups.sort((a, b) =>
    compareHourGroups(a, b, userTz, primaryCountryByTz),
  );
}

export function buildCountrySearchIndex(
  rows: CountryRow[],
  primaryCountryByTz: Map<string, string | null>,
  usSearch: UsSearchData | null,
): Map<string, Set<string>> {
  const keywordsByCountry = new Map<string, Set<string>>();
  for (const row of rows) {
    const terms = keywordsByCountry.get(row.countryName) ?? new Set<string>();
    terms.add(row.countryName);
    if (primaryCountryByTz.get(row.tzid) === row.countryName) {
      terms.add(row.tzid);
      for (const city of row.cities) {
        if (city.trim()) terms.add(city);
      }
    }
    keywordsByCountry.set(row.countryName, terms);
  }

  if (usSearch) {
    const usTerms = keywordsByCountry.get(usSearch.country) ?? new Set();
    for (const state of usSearch.stateToTimezones.keys()) {
      usTerms.add(state);
    }
    for (const abbrev of usSearch.abbrevToState.keys()) {
      usTerms.add(abbrev);
    }
    keywordsByCountry.set(usSearch.country, usTerms);
  }

  return keywordsByCountry;
}

export function buildPanelTable(
  geoIndex: GeoIndex,
  scores: Map<string, ZoneLateness>,
  userTz: string,
  userWorkHours: UserWorkHours,
  citiesByTimezone: Map<string, string[]>,
  usSearch: UsSearchData | null,
): PanelTableData {
  const rows = buildCountryRows(
    geoIndex.pairs,
    scores,
    userTz,
    userWorkHours,
    citiesByTimezone,
    geoIndex.primaryCountryByTz,
  );
  return {
    rows,
    hourGroups: buildHourGroups(rows, userTz, geoIndex.primaryCountryByTz),
    countrySearchIndex: buildCountrySearchIndex(
      rows,
      geoIndex.primaryCountryByTz,
      usSearch,
    ),
  };
}
