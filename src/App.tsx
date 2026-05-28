import { useCallback, useEffect, useMemo, useState } from "react";
import { WorldMap } from "./components/WorldMap";
import { TimezonePanel } from "./components/TimezonePanel";
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
import { useTimezoneScores } from "./hooks/useTimezoneScores";
import {
  DEFAULT_PEAK_LATENESS_RANGE,
  DEFAULT_USER_WORK_HOURS,
  normalizePeakLatenessRange,
  normalizeUserWorkHours,
  type PeakLatenessRange,
  type UserWorkHours,
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
  const [userTz, setUserTz] = useState(
    () => timezoneFromQuery() ?? detectUserTimezone(),
  );
  const [peakLateRange, setPeakLateRange] = useState(readStoredPeakLateRange);
  const [userWorkHours, setUserWorkHours] = useState(readStoredUserWorkHours);
  const [loading, setLoading] = useState(true);
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
        setError(null);
        const [c, t, index, cities, us] = await Promise.all([
          loadCountries(),
          loadTimezones(),
          loadTimezoneIndex(),
          loadTimezoneCities(),
          loadUsSearch(),
        ]);
        if (cancelled) return;
        setCountries(c);
        setTimezones(t);
        setCitiesByTimezone(cities);
        setUsSearch(us);
        const merged = [
          ...new Set([...index, ...t.map((f) => f.properties.tzid)]),
        ].sort();
        setTimezoneOptions(merged);
        if (!merged.includes(userTz) && merged.length > 0) {
          setUserTz(merged.includes("UTC") ? "UTC" : merged[0]);
        }
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

  const tzidsOnMap = useMemo(
    () => timezones.map((f) => f.properties.tzid),
    [timezones],
  );

  const scores = useTimezoneScores(
    userTz,
    tzidsOnMap,
    peakLateRange,
    userWorkHours,
  );

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

  return (
    <div className="app">
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
        citiesByTimezone={citiesByTimezone}
        usSearch={usSearch}
        scores={scores}
        loading={loading}
        error={error}
        hoveredTzids={hoveredTzids}
        onHoverTzids={setHoveredTzids}
        selectedTzids={selectedTzids}
        onSelectTzids={setSelectedTzids}
        countrySearch={countrySearch}
        onCountrySearchChange={setCountrySearch}
        onResetMapView={onResetMapView}
      />
      <main className="app-main">
        {!loading && !error && countries.length > 0 && timezones.length > 0 && (
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
