import type { CountryFeature, TimezoneFeature, UsSearchData } from "./geo";
import {
  buildPanelTable,
  resolveGeoIndex,
  type GeoIndex,
  type PanelTableData,
} from "./panelData";
import {
  computeAllZoneLateness,
  type PeakLatenessRange,
  type UserWorkHours,
  type ZoneLateness,
} from "./workHours";
import { yieldToMain } from "./yieldToMain";

export interface AppWarmupResult {
  geoIndex: GeoIndex;
  scores: Map<string, ZoneLateness>;
  panelTable: PanelTableData;
}

export async function runAppWarmup(
  countries: CountryFeature[],
  timezones: TimezoneFeature[],
  tzids: string[],
  userTz: string,
  peakLateRange: PeakLatenessRange,
  userWorkHours: UserWorkHours,
  citiesByTimezone: Map<string, string[]>,
  usSearch: UsSearchData | null,
): Promise<AppWarmupResult> {
  const geoIndex = await resolveGeoIndex(countries, timezones);
  await yieldToMain();

  const scores = computeAllZoneLateness(
    userTz,
    tzids,
    peakLateRange,
    userWorkHours,
  );
  await yieldToMain();

  const panelTable = buildPanelTable(
    geoIndex,
    scores,
    userTz,
    userWorkHours,
    citiesByTimezone,
    usSearch,
  );

  return { geoIndex, scores, panelTable };
}
