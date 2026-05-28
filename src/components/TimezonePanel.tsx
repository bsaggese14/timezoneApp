import { useCallback, useMemo, useState } from "react";
import { SearchableSelect } from "./SearchableSelect";
import { interpolateReds } from "d3-scale-chromatic";
import type {
  CountryFeature,
  TimezoneFeature,
  UsSearchData,
} from "../lib/geo";
import {
  US_COUNTRY_NAME,
  countryTimezonePairs,
  primaryCountryByTimezone,
} from "../lib/geo";
import {
  getPeakLatenessHourOptions,
  getWorkHoursColumnPresets,
  isPrimaryWorkHoursColumn,
  scoreToFill,
  textColorForBackground,
  workHoursRangesInZone,
  workHoursSignature,
  workStartLabel,
  type PeakLatenessRange,
  type UserWorkHours,
  type WorkHoursRange,
  type ZoneLateness,
} from "../lib/workHours";

interface TimezonePanelProps {
  userTz: string;
  timezoneOptions: string[];
  onTimezoneChange: (tz: string) => void;
  peakLateRange: PeakLatenessRange;
  onPeakLateRangeChange: (range: PeakLatenessRange) => void;
  userWorkHours: UserWorkHours;
  onUserWorkHoursChange: (hours: UserWorkHours) => void;
  countries: CountryFeature[];
  timezones: TimezoneFeature[];
  citiesByTimezone: Map<string, string[]>;
  usSearch: UsSearchData | null;
  scores: Map<string, ZoneLateness>;
  loading?: boolean;
  error?: string | null;
  hoveredTzids: string[] | null;
  onHoverTzids: (tzids: string[] | null) => void;
  selectedTzids: string[] | null;
  onSelectTzids: (tzids: string[] | null) => void;
  countrySearch: string;
  onCountrySearchChange: (value: string) => void;
  onResetMapView: () => void;
}

interface CountryRow {
  countryName: string;
  tzid: string;
  cities: string[];
  lateness: ZoneLateness | null;
  workHours: WorkHoursRange[];
  fill: string;
  sameWorkHours: boolean;
}

interface HourGroup {
  key: string;
  countryName: string;
  tzids: string[];
  lateness: ZoneLateness | null;
  workHours: WorkHoursRange[];
  fill: string;
  sameWorkHours: boolean;
  includesUserTz: boolean;
}

const PEAK_LATENESS_OPTIONS = getPeakLatenessHourOptions();

function keywordMatchScore(keyword: string, query: string): number {
  const ql = query.trim().toLowerCase();
  if (!ql) return 0;
  const kl = keyword.toLowerCase();
  const tzScore = keyword.includes("/") ? 700 : 800;
  const tzPrefixScore = keyword.includes("/") ? 650 : 750;

  // Full phrase (e.g. query "new york" ↔ keyword "New York")
  if (kl === ql) return tzScore;
  if (
    kl.startsWith(ql) &&
    (kl.length === ql.length || !/\w/.test(kl.charAt(ql.length)))
  ) {
    return tzPrefixScore;
  }

  const segments = kl.split(/[/\s,_-]+/);
  let best = 0;
  for (const seg of segments) {
    if (seg === ql) {
      best = Math.max(best, tzScore);
    } else if (
      seg.startsWith(ql) &&
      (seg.length === ql.length || !/\w/.test(seg.charAt(ql.length)))
    ) {
      best = Math.max(best, 500);
    }
  }
  return best;
}

function resolveUsState(
  query: string,
  usSearch: UsSearchData,
): string | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) {
    return usSearch.abbrevToState.get(upper) ?? null;
  }
  for (const state of usSearch.stateToTimezones.keys()) {
    if (keywordMatchScore(state, query) > 0) return state;
  }
  return null;
}

function usStateTimezones(
  query: string,
  usSearch: UsSearchData,
): string[] | null {
  const state = resolveUsState(query, usSearch);
  if (!state) return null;
  return usSearch.stateToTimezones.get(state) ?? null;
}

function rowMatchesPlaceSearch(
  row: CountryRow,
  query: string,
  primaryCountryByTz: Map<string, string | null>,
  usSearch: UsSearchData | null,
): boolean {
  const ql = query.trim().toLowerCase();
  if (!ql) return true;
  if (row.countryName.toLowerCase().includes(ql)) return true;

  if (
    usSearch &&
    row.countryName === usSearch.country &&
    usSearch.country === US_COUNTRY_NAME
  ) {
    const stateTzids = usStateTimezones(query, usSearch);
    if (stateTzids?.includes(row.tzid)) return true;
  }

  if (keywordMatchScore(row.tzid, query) > 0) return true;
  if (primaryCountryByTz.get(row.tzid) !== row.countryName) return false;
  return row.cities.some((city) => keywordMatchScore(city, query) > 0);
}

function countrySearchScore(
  country: string,
  query: string,
  keywords: Set<string>,
  usSearch: UsSearchData | null,
): number {
  const ql = query.trim().toLowerCase();
  if (!ql) return 0;
  const cl = country.toLowerCase();
  if (cl === ql) return 1000;
  if (cl.startsWith(ql)) return 900;

  let best = 0;
  for (const kw of keywords) {
    if (kw === country) continue;
    best = Math.max(best, keywordMatchScore(kw, query));
  }

  if (
    usSearch &&
    country === usSearch.country &&
    usStateTimezones(query, usSearch)
  ) {
    best = Math.max(best, 850);
  }

  return best;
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

function compareCountryTimezoneRows(
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

export function TimezonePanel({
  userTz,
  timezoneOptions,
  onTimezoneChange,
  peakLateRange,
  onPeakLateRangeChange,
  userWorkHours,
  onUserWorkHoursChange,
  countries,
  timezones,
  citiesByTimezone,
  usSearch,
  scores,
  loading,
  error,
  hoveredTzids,
  onHoverTzids,
  selectedTzids,
  onSelectTzids,
  countrySearch,
  onCountrySearchChange,
  onResetMapView,
}: TimezonePanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const colorRed = useMemo(() => interpolateReds, []);
  const workHoursColumns = useMemo(
    () => getWorkHoursColumnPresets(userWorkHours),
    [userWorkHours],
  );
  const workStart = workStartLabel(userWorkHours);

  const pairs = useMemo(
    () => countryTimezonePairs(countries, timezones),
    [countries, timezones],
  );

  const primaryCountryByTz = useMemo(
    () => primaryCountryByTimezone(countries, timezones),
    [countries, timezones],
  );

  const rows = useMemo((): CountryRow[] => {
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
  }, [
    pairs,
    scores,
    userTz,
    userWorkHours,
    colorRed,
    primaryCountryByTz,
    citiesByTimezone,
  ]);

  const hourGroups = useMemo((): HourGroup[] => {
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
  }, [rows, userTz, primaryCountryByTz]);

  const filteredGroups = useMemo(() => {
    if (!countrySearch.trim()) return hourGroups;
    return hourGroups.filter((group) => group.countryName === countrySearch);
  }, [hourGroups, countrySearch]);

  const hoveredSet = useMemo(
    () => (hoveredTzids ? new Set(hoveredTzids) : null),
    [hoveredTzids],
  );
  const selectedSet = useMemo(
    () => (selectedTzids ? new Set(selectedTzids) : null),
    [selectedTzids],
  );

  const countrySearchIndex = useMemo(() => {
    const keywordsByCountry = new Map<string, Set<string>>();
    for (const row of rows) {
      const terms =
        keywordsByCountry.get(row.countryName) ?? new Set<string>();
      terms.add(row.countryName);
      // Cities/timezones belong to the zone's primary country (e.g. Lima → Peru).
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
  }, [rows, primaryCountryByTz, usSearch]);

  const countryFilterOptions = useMemo(
    () => [...countrySearchIndex.keys()].sort((a, b) => a.localeCompare(b)),
    [countrySearchIndex],
  );

  const scoreCountryOption = useMemo(() => {
    return (country: string, query: string) => {
      if (country === "") return 0;
      const keywords = countrySearchIndex.get(country);
      if (!keywords) return 0;
      return countrySearchScore(country, query, keywords, usSearch);
    };
  }, [countrySearchIndex, usSearch]);

  const matchCountryOption = useMemo(() => {
    return (country: string, query: string) =>
      scoreCountryOption(country, query) > 0;
  }, [scoreCountryOption]);

  const handleCountryFilterSelect = useCallback(
    (country: string, context?: { query: string }) => {
      onCountrySearchChange(country);
      if (!country) {
        onSelectTzids(null);
        return;
      }
      const searchQuery = context?.query?.trim() ?? "";
      let matchingRows = rows.filter((row) => row.countryName === country);
      if (searchQuery) {
        const narrowed = matchingRows.filter((row) =>
          rowMatchesPlaceSearch(row, searchQuery, primaryCountryByTz, usSearch),
        );
        if (narrowed.length > 0) matchingRows = narrowed;
      }
      const tzids = [...new Set(matchingRows.map((row) => row.tzid))];
      if (tzids.length > 0) onSelectTzids(tzids);
    },
    [onCountrySearchChange, onSelectTzids, rows, primaryCountryByTz, usSearch],
  );

  const showCountryList = countries.length > 0 && timezones.length > 0;

  return (
    <div className="sidebar-shell">
      <aside
        className={`sidebar${collapsed ? " sidebar--collapsed" : ""}`}
        aria-label="Timezone settings and list"
        aria-hidden={collapsed}
      >
        <header className="panel-header">
          <h1>Timezone Work Map</h1>
        </header>

        <div className="sidebar-content">
          <div className="panel-body">
            <p className="panel-subtitle">
              See how late your {workStart} start feels in each timezone
            </p>

            <label className="field-label" htmlFor="user-tz-search">
              Your timezone
            </label>
            <SearchableSelect
              id="user-tz-search"
              value={userTz}
              options={timezoneOptions}
              placeholder="Search timezones…"
              disabled={loading}
              onChange={onTimezoneChange}
            />

            <div className="work-hours-section">
              <span className="field-label">
                Your work hours (today, DST-aware)
              </span>
              <div className="peak-lateness-range">
                <label
                  className="peak-lateness-range-field"
                  htmlFor="work-hours-start"
                >
                  Start
                </label>
                <select
                  id="work-hours-start"
                  className="peak-lateness-select"
                  value={userWorkHours.startHour}
                  disabled={loading}
                  onChange={(e) =>
                    onUserWorkHoursChange({
                      ...userWorkHours,
                      startHour: Number(e.target.value),
                    })
                  }
                >
                  {PEAK_LATENESS_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <label
                  className="peak-lateness-range-field"
                  htmlFor="work-hours-end"
                >
                  End
                </label>
                <select
                  id="work-hours-end"
                  className="peak-lateness-select"
                  value={userWorkHours.endHour}
                  disabled={loading}
                  onChange={(e) =>
                    onUserWorkHoursChange({
                      ...userWorkHours,
                      endHour: Number(e.target.value),
                    })
                  }
                >
                  {PEAK_LATENESS_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <span className="field-label">Work avoidance range</span>
            <div className="peak-lateness-range">
              <label
                className="peak-lateness-range-field"
                htmlFor="peak-lateness-start"
              >
                From
              </label>
              <select
                id="peak-lateness-start"
                className="peak-lateness-select"
                value={peakLateRange.startHour}
                disabled={loading}
                onChange={(e) =>
                  onPeakLateRangeChange({
                    ...peakLateRange,
                    startHour: Number(e.target.value),
                  })
                }
              >
                {PEAK_LATENESS_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <label
                className="peak-lateness-range-field"
                htmlFor="peak-lateness-end"
              >
                To
              </label>
              <select
                id="peak-lateness-end"
                className="peak-lateness-select"
                value={peakLateRange.endHour}
                disabled={loading}
                onChange={(e) =>
                  onPeakLateRangeChange({
                    ...peakLateRange,
                    endHour: Number(e.target.value),
                  })
                }
              >
                {PEAK_LATENESS_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {error && <p className="panel-error">{error}</p>}
            {loading && <p className="panel-loading">Loading map data…</p>}

            <div className="legend" aria-hidden="true">
              <span className="legend-label">Less late</span>
              <div className="legend-bar" />
              <span className="legend-label">More late</span>
            </div>
            <p className="legend-caption">
              Darkest red = work start falls inside your work avoidance range;
              lighter toward {workStart} before and after on the clock
            </p>
          </div>

          {showCountryList && (
            <div className="country-list-body">
              <div className="country-list-search">
                <label className="field-label" htmlFor="country-search">
                  Search places or timezones
                </label>
                <SearchableSelect
                  id="country-search"
                  value={countrySearch}
                  options={countryFilterOptions}
                  placeholder="Search countries, states, cities, or timezones…"
                  emptyLabel="All countries"
                  disabled={loading}
                  maxResults={100}
                  matchOption={matchCountryOption}
                  scoreOption={scoreCountryOption}
                  clearable
                  onClear={onResetMapView}
                  onChange={handleCountryFilterSelect}
                />
              </div>
              <div className="country-list-scroll">
                <div className="country-list-row country-list-head" role="row">
                  <span
                    className="country-list-name country-list-col-head"
                    role="columnheader"
                  />
                  {workHoursColumns.map(({ label }) => (
                    <span
                      key={label}
                      className={`country-list-cell country-list-cell--hours country-list-col-head${isPrimaryWorkHoursColumn(label, userWorkHours) ? " country-list-cell--primary" : ""}`}
                      role="columnheader"
                    >
                      {label}
                    </span>
                  ))}
                </div>
                <ul className="country-list" role="rowgroup">
                  {filteredGroups.map(
                    ({
                      key,
                      countryName,
                      tzids,
                      lateness,
                      workHours,
                      fill,
                      sameWorkHours,
                      includesUserTz,
                    }) => {
                      const highlighted =
                        hoveredSet != null &&
                        tzids.some((tzid) => hoveredSet.has(tzid));
                      const selected =
                        selectedSet != null &&
                        tzids.some((tzid) => selectedSet.has(tzid));
                      return (
                        <li
                          key={key}
                          className={`country-list-row country-list-item${sameWorkHours ? " country-list-item--same-hours" : ""}${includesUserTz ? " country-list-item--user-tz" : ""}${highlighted || selected ? " country-list-item--highlighted" : ""}`}
                          style={
                            sameWorkHours
                              ? undefined
                              : { borderLeftColor: fill }
                          }
                          role="row"
                          onMouseEnter={() => onHoverTzids(tzids)}
                          onMouseLeave={() => onHoverTzids(null)}
                          onClick={() => onSelectTzids(tzids)}
                        >
                          <div className="country-list-name" role="rowheader">
                            <strong>{countryName}</strong>
                            <span className="country-list-tzid">
                              {tzids.length > 1 ? tzids.join(" · ") : tzids[0]}
                            </span>
                          </div>
                          {lateness ? (
                            workHours.map(({ label, localRange }) => {
                              const isPrimary = isPrimaryWorkHoursColumn(
                                label,
                                userWorkHours,
                              );
                              const primaryBg = sameWorkHours
                                ? "#cbd5e0"
                                : fill;
                              return (
                                <span
                                  key={label}
                                  className={`country-list-cell country-list-cell--hours${isPrimary ? " country-list-cell--primary" : ""}`}
                                  style={
                                    isPrimary
                                      ? {
                                          backgroundColor: primaryBg,
                                          color:
                                            textColorForBackground(primaryBg),
                                        }
                                      : undefined
                                  }
                                  role="cell"
                                >
                                  {localRange}
                                </span>
                              );
                            })
                          ) : (
                            <span
                              className="country-list-cell country-list-cell--muted"
                              role="cell"
                            >
                              No data
                            </span>
                          )}
                        </li>
                      );
                    },
                  )}
                </ul>
              </div>
            </div>
          )}
        </div>
      </aside>
      <button
        type="button"
        className="sidebar-toggle"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Open sidebar" : "Close sidebar"}
        onClick={() => setCollapsed((c) => !c)}
      >
        {collapsed ? "▸" : "◂"}
      </button>
    </div>
  );
}
