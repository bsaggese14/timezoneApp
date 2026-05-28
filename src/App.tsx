import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapLoadingOverlay } from "./components/MapLoadingOverlay";
import { WorldMap } from "./components/WorldMap";
import { TimezonePanel } from "./components/TimezonePanel";
import { runAppWarmup } from "./lib/appWarmup";
import {
  detectUserTimezone,
  loadCountries,
  loadTimezoneCities,
  loadTimezoneIndex,
  loadTimezones,
  loadUsSearch,
  timezoneFromQuery,
  type CountryFeature,
  type TimezoneFeature,
  type UsSearchData,
} from "./lib/geo";
import type { GeoIndex, PanelTableData } from "./lib/panelData";
import { buildPanelTable } from "./lib/panelData";
import { yieldToMain } from "./lib/yieldToMain";
import {
  computeAllZoneLateness,
  DEFAULT_PEAK_LATENESS_RANGE,
  DEFAULT_USER_WORK_HOURS,
  normalizePeakLatenessRange,
  normalizeUserWorkHours,
  type PeakLatenessRange,
  type UserWorkHours,
  type ZoneLateness,
} from "./lib/workHours";
import "./styles/global.css";

const PEAK_LATENESS_STORAGE_KEY = "timezoneApp.peakLateRange";
const PEAK_LATENESS_LEGACY_KEY = "timezoneApp.peakLateHour";
const USER_WORK_HOURS_STORAGE_KEY = "timezoneApp.userWorkHours";

function isValidHour(h: unknown): h is number {
  return typeof h === "number" && Number.isInteger(h) && h >= 0 && h < 24;
}

function readStoredPeakLateRange(): PeakLatenessRange {
  try {
    const raw = localStorage.getItem(PEAK_LATENESS_STORAGE_KEY);
    if (raw != null) {
      const parsed = JSON.parse(raw) as PeakLatenessRange;
      if (isValidHour(parsed.startHour) && isValidHour(parsed.endHour)) {
        return normalizePeakLatenessRange(parsed);
      }
    }

    const legacy = localStorage.getItem(PEAK_LATENESS_LEGACY_KEY);
    if (legacy != null) {
      const hour = Number(legacy);
      if (isValidHour(hour)) {
        return { startHour: hour, endHour: hour };
      }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_PEAK_LATENESS_RANGE;
}

function readStoredUserWorkHours(): UserWorkHours {
  try {
    const raw = localStorage.getItem(USER_WORK_HOURS_STORAGE_KEY);
    if (raw != null) {
      const parsed = JSON.parse(raw) as UserWorkHours;
      if (isValidHour(parsed.startHour) && isValidHour(parsed.endHour)) {
        return normalizeUserWorkHours(parsed);
      }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_USER_WORK_HOURS;
}

function App() {
  const [countries, setCountries] = useState<CountryFeature[]>([]);
  const [timezones, setTimezones] = useState<TimezoneFeature[]>([]);
  const [timezoneOptions, setTimezoneOptions] = useState<string[]>([]);
  const [citiesByTimezone, setCitiesByTimezone] = useState<
    Map<string, string[]>
  >(() => new Map());
  const [usSearch, setUsSearch] = useState<UsSearchData | null>(null);
  const [geoIndex, setGeoIndex] = useState<GeoIndex | null>(null);
  const [panelTable, setPanelTable] = useState<PanelTableData | null>(null);
  const skipPanelRebuildRef = useRef(false);
  const [userTz, setUserTz] = useState(
    () => timezoneFromQuery() ?? detectUserTimezone(),
  );
  const [peakLateRange, setPeakLateRange] = useState(readStoredPeakLateRange);
  const [userWorkHours, setUserWorkHours] = useState(readStoredUserWorkHours);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState("Loading map data…");
  const [mapPainted, setMapPainted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredTzids, setHoveredTzids] = useState<string[] | null>(null);
  const [selectedTzids, setSelectedTzids] = useState<string[] | null>(null);
  const [resetViewNonce, setResetViewNonce] = useState(0);
  const [countrySearch, setCountrySearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setMapPainted(false);
        setError(null);
        setGeoIndex(null);
        setLoadingMessage("Loading map data…");

        const [c, t, index, cities, us] = await Promise.all([
          loadCountries(),
          loadTimezones(),
          loadTimezoneIndex(),
          loadTimezoneCities(),
          loadUsSearch(),
        ]);
        if (cancelled) return;

        setLoadingMessage("Preparing map…");
        const tzids = t.map((f) => f.properties.tzid);
        const merged = [
          ...new Set([...index, ...tzids]),
        ].sort();

        let resolvedUserTz = userTz;
        if (!merged.includes(userTz) && merged.length > 0) {
          resolvedUserTz = merged.includes("UTC") ? "UTC" : merged[0];
        }

        const warmup = await runAppWarmup(
          c,
          t,
          tzids,
          resolvedUserTz,
          peakLateRange,
          userWorkHours,
          cities,
          us,
        );
        if (cancelled) return;

        setCountries(c);
        setTimezones(t);
        setCitiesByTimezone(cities);
        setUsSearch(us);
        setTimezoneOptions(merged);
        setUserTz(resolvedUserTz);
        setGeoIndex(warmup.geoIndex);
        skipPanelRebuildRef.current = true;
        setPanelTable(warmup.panelTable);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load map data");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setMapPainted(false);
  }, [countries, timezones]);

  const tzidsOnMap = useMemo(
    () => timezones.map((f) => f.properties.tzid),
    [timezones],
  );

  const scores = useMemo((): Map<string, ZoneLateness> => {
    if (!geoIndex || tzidsOnMap.length === 0) return new Map();
    return computeAllZoneLateness(
      userTz,
      tzidsOnMap,
      peakLateRange,
      userWorkHours,
    );
  }, [geoIndex, tzidsOnMap, userTz, peakLateRange, userWorkHours]);

  useEffect(() => {
    if (!geoIndex) return;
    if (skipPanelRebuildRef.current) {
      skipPanelRebuildRef.current = false;
      return;
    }
    let cancelled = false;
    (async () => {
      await yieldToMain();
      if (cancelled) return;
      setPanelTable(
        buildPanelTable(
          geoIndex,
          scores,
          userTz,
          userWorkHours,
          citiesByTimezone,
          usSearch,
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [
    geoIndex,
    scores,
    userTz,
    userWorkHours,
    citiesByTimezone,
    usSearch,
  ]);

  const onMapPainted = useCallback(() => {
    setMapPainted(true);
  }, []);

  const appReady =
    !loading &&
    !error &&
    geoIndex != null &&
    panelTable != null &&
    mapPainted &&
    countries.length > 0 &&
    timezones.length > 0;

  const onPeakLateRangeChange = useCallback((range: PeakLatenessRange) => {
    const normalized = normalizePeakLatenessRange(range);
    setPeakLateRange(normalized);
    try {
      localStorage.setItem(
        PEAK_LATENESS_STORAGE_KEY,
        JSON.stringify(normalized),
      );
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  const onUserWorkHoursChange = useCallback((hours: UserWorkHours) => {
    const normalized = normalizeUserWorkHours(hours);
    setUserWorkHours(normalized);
    try {
      localStorage.setItem(
        USER_WORK_HOURS_STORAGE_KEY,
        JSON.stringify(normalized),
      );
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  const onTimezoneChange = useCallback((tz: string) => {
    setUserTz(tz);
    const url = new URL(window.location.href);
    url.searchParams.set("tz", tz);
    window.history.replaceState({}, "", url);
  }, []);

  const onResetMapView = useCallback(() => {
    setSelectedTzids(null);
    setCountrySearch("");
    setResetViewNonce((n) => n + 1);
  }, []);

  const mapReady = !loading && !error && geoIndex != null && countries.length > 0;

  return (
    <div className={`app${appReady ? "" : " app--blocked"}`}>
      {!appReady && !error && (
        <MapLoadingOverlay message={loadingMessage} />
      )}
      <TimezonePanel
        userTz={userTz}
        timezoneOptions={timezoneOptions}
        onTimezoneChange={onTimezoneChange}
        peakLateRange={peakLateRange}
        onPeakLateRangeChange={onPeakLateRangeChange}
        userWorkHours={userWorkHours}
        onUserWorkHoursChange={onUserWorkHoursChange}
        countries={countries}
        timezones={timezones}
        geoIndex={geoIndex}
        panelTable={panelTable}
        usSearch={usSearch}
        loading={loading}
        error={error}
        appReady={appReady}
        hoveredTzids={hoveredTzids}
        onHoverTzids={setHoveredTzids}
        selectedTzids={selectedTzids}
        onSelectTzids={setSelectedTzids}
        countrySearch={countrySearch}
        onCountrySearchChange={setCountrySearch}
        onResetMapView={onResetMapView}
      />
      <main className="app-main">
        {mapReady && (
          <WorldMap
            countries={countries}
            timezones={timezones}
            scores={scores}
            userTz={userTz}
            userWorkHours={userWorkHours}
            hoveredTzids={hoveredTzids}
            onHoverTzids={setHoveredTzids}
            selectedTzids={selectedTzids}
            onSelectTzids={setSelectedTzids}
            resetViewNonce={resetViewNonce}
            onResetMapView={onResetMapView}
            onCountrySearchChange={setCountrySearch}
            onMapPainted={onMapPainted}
            labelsEnabled={appReady}
          />
        )}
        {!loading && error && (
          <div className="map-fallback">
            <p>
              Run <code>npm run data:build</code> to download map data.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
