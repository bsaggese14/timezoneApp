import { DateTime } from "luxon";

export interface UserWorkHours {
  startHour: number;
  endHour: number;
}

export const DEFAULT_USER_WORK_HOURS: UserWorkHours = {
  startHour: 9,
  endHour: 17,
};

export function formatWorkHoursLabel(startHour: number, endHour: number): string {
  const startDisplay = startHour % 12 || 12;
  const endDisplay = endHour % 12 || 12;
  return `${startDisplay}–${endDisplay}`;
}

/** Table/tooltip columns: ±1 h around the user's selected work window. */
export function getWorkHoursColumnPresets(
  workHours: UserWorkHours,
): { label: string; startHour: number; endHour: number }[] {
  return [-1, 0, 1].map((offset) => {
    const startHour = (workHours.startHour + offset + 24) % 24;
    const endHour = (workHours.endHour + offset + 24) % 24;
    return {
      startHour,
      endHour,
      label: formatWorkHoursLabel(startHour, endHour),
    };
  });
}

export function isPrimaryWorkHoursColumn(
  label: string,
  workHours: UserWorkHours,
): boolean {
  return label === formatWorkHoursLabel(workHours.startHour, workHours.endHour);
}

/** @deprecated Use DEFAULT_PEAK_LATENESS_RANGE */
export const DEFAULT_PEAK_LATENESS_HOUR = 0;

export interface PeakLatenessRange {
  /** Inclusive start hour (0–23). */
  startHour: number;
  /** Inclusive end hour (0–23); may be before startHour to wrap past midnight. */
  endHour: number;
}

export const DEFAULT_PEAK_LATENESS_RANGE: PeakLatenessRange = {
  startHour: DEFAULT_PEAK_LATENESS_HOUR,
  endHour: DEFAULT_PEAK_LATENESS_HOUR,
};

export function getPeakLatenessHourOptions(): { value: number; label: string }[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    value: hour,
    label: DateTime.fromObject({ hour, minute: 0 }).toFormat("h:mm a"),
  }));
}

/** Hours forward on a 24h clock from `fromHour` to `toHour`. */
function hoursAhead(fromHour: number, toHour: number): number {
  return (toHour - fromHour + 24) % 24;
}

export function isInPeakLatenessRange(
  hour: number,
  range: PeakLatenessRange,
): boolean {
  const h = ((hour % 24) + 24) % 24;
  const { startHour, endHour } = range;
  if (startHour <= endHour) {
    return h >= startHour && h < endHour + 1;
  }
  return h >= startHour || h < endHour + 1;
}

/**
 * Darkness from local work-start hour only.
 * 0 at selected start (9:00), ramp up to peak range, max inside range,
 * then ramp down back to selected start.
 */
export function latenessWeight(
  localStartHourFraction: number,
  peakRange: PeakLatenessRange,
  selectedStartHour: number = DEFAULT_USER_WORK_HOURS.startHour,
): number {
  if (isInPeakLatenessRange(localStartHourFraction, peakRange)) return 1;

  const toPeakStart = hoursAhead(selectedStartHour, peakRange.startHour);
  const aheadFromStart = hoursAhead(selectedStartHour, localStartHourFraction);

  if (toPeakStart > 0 && aheadFromStart < toPeakStart) {
    return aheadFromStart / toPeakStart;
  }

  const rampDownLength = hoursAhead(peakRange.endHour, selectedStartHour);
  const aheadFromPeakEnd = hoursAhead(peakRange.endHour, localStartHourFraction);

  if (rampDownLength > 0 && aheadFromPeakEnd > 0 && aheadFromPeakEnd < rampDownLength) {
    return Math.max(0, 1 - aheadFromPeakEnd / rampDownLength);
  }

  return 0;
}

export interface ZoneLateness {
  score: number;
  /** Local time when the user's work day starts in this zone. */
  workStartLocal: string;
  /** True when work starts at 9:00 locally in this zone. */
  sameWorkHours: boolean;
}

function isSameWorkStart(
  startLocal: DateTime,
  userStartHour: number,
): boolean {
  return startLocal.hour === userStartHour && startLocal.minute === 0;
}

function formatTime(dt: DateTime): string {
  return dt.toFormat("h:mm a");
}

/** Omits :00 minutes for on-the-hour times (e.g. "9 AM" vs "9:00 AM"). */
function formatTimeCompact(dt: DateTime): string {
  return dt.minute === 0 ? dt.toFormat("h a") : dt.toFormat("h:mm a");
}

export interface WorkHoursRange {
  label: string;
  localRange: string;
}

/** Stable key for grouping zones with identical preset columns. */
export function workHoursSignature(workHours: WorkHoursRange[]): string {
  return workHours.map((w) => w.localRange).join("\0");
}

/** User's local work window (startHour–endHour in userTz) as a range in targetTz. */
export function workHoursRangesInZone(
  userTz: string,
  targetTz: string,
  userWorkHours: UserWorkHours = DEFAULT_USER_WORK_HOURS,
  anchorDate?: string,
): WorkHoursRange[] {
  const base = anchorDate
    ? DateTime.fromISO(anchorDate, { zone: userTz })
    : DateTime.now().setZone(userTz);

  return getWorkHoursColumnPresets(userWorkHours).map(({ label, startHour, endHour }) => {
    const start = base.set({
      hour: startHour,
      minute: 0,
      second: 0,
      millisecond: 0,
    });
    const end = base.set({
      hour: endHour,
      minute: 0,
      second: 0,
      millisecond: 0,
    });
    const startLocal = formatTimeCompact(start.setZone(targetTz));
    const endLocal = formatTimeCompact(end.setZone(targetTz));
    return { label, localRange: `${startLocal} – ${endLocal}` };
  });
}

/**
 * Lateness 0–1 from local work-start hour: ramp up/down around peakLateRange.
 */
export function computeZoneLateness(
  userTz: string,
  targetTz: string,
  peakLateRange: PeakLatenessRange = DEFAULT_PEAK_LATENESS_RANGE,
  userWorkHours: UserWorkHours = DEFAULT_USER_WORK_HOURS,
  anchorDate?: string,
): ZoneLateness {
  const base = anchorDate
    ? DateTime.fromISO(anchorDate, { zone: userTz })
    : DateTime.now().setZone(userTz);

  const workStart = base.set({
    hour: userWorkHours.startHour,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
  const startLocal = workStart.setZone(targetTz);

  if (userTz === targetTz) {
    return {
      score: 0,
      sameWorkHours: true,
      workStartLocal: formatTime(startLocal),
    };
  }

  const hourFraction = startLocal.hour + startLocal.minute / 60;
  const score = latenessWeight(
    hourFraction,
    peakLateRange,
    userWorkHours.startHour,
  );

  return {
    score,
    sameWorkHours: isSameWorkStart(startLocal, userWorkHours.startHour),
    workStartLocal: formatTime(startLocal),
  };
}

export function computeAllZoneLateness(
  userTz: string,
  tzids: string[],
  peakLateRange: PeakLatenessRange = DEFAULT_PEAK_LATENESS_RANGE,
  userWorkHours: UserWorkHours = DEFAULT_USER_WORK_HOURS,
  anchorDate?: string,
): Map<string, ZoneLateness> {
  const anchor =
    anchorDate ?? DateTime.now().setZone(userTz).toISODate() ?? undefined;
  const now = DateTime.now();
  const map = new Map<string, ZoneLateness>();
  for (const tzid of tzids) {
    if (!now.setZone(tzid).isValid) continue;
    map.set(
      tzid,
      computeZoneLateness(userTz, tzid, peakLateRange, userWorkHours, anchor),
    );
  }
  return map;
}

export function normalizePeakLatenessRange(
  range: PeakLatenessRange,
): PeakLatenessRange {
  const startHour = Math.floor(range.startHour) % 24;
  const endHour = Math.floor(range.endHour) % 24;
  return {
    startHour: startHour < 0 ? startHour + 24 : startHour,
    endHour: endHour < 0 ? endHour + 24 : endHour,
  };
}

export function normalizeUserWorkHours(hours: UserWorkHours): UserWorkHours {
  const startHour = Math.floor(hours.startHour) % 24;
  const endHour = Math.floor(hours.endHour) % 24;
  return {
    startHour: startHour < 0 ? startHour + 24 : startHour,
    endHour: endHour < 0 ? endHour + 24 : endHour,
  };
}

export function formatHourLabel(hour: number): string {
  return DateTime.fromObject({ hour, minute: 0 }).toFormat("h:mm a");
}

export function scoreToFill(
  score: number,
  interpolateRed: (t: number) => string,
  sameWorkHours: boolean,
): string {
  if (sameWorkHours) return "#ffffff";
  return interpolateRed(0.08 + 0.92 * Math.min(1, Math.max(0, score)));
}

function parseRgb(color: string): { r: number; g: number; b: number } | null {
  const hex = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color.trim());
  if (hex) {
    return {
      r: Number.parseInt(hex[1], 16),
      g: Number.parseInt(hex[2], 16),
      b: Number.parseInt(hex[3], 16),
    };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(color.trim());
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  }
  return null;
}

function relativeLuminance(r: number, g: number, b: number): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Dark fills need light text for readable contrast in table cells. */
export function textColorForBackground(
  background: string,
  darkText = "#2d3748",
  lightText = "#ffffff",
): string {
  const rgb = parseRgb(background);
  if (!rgb) return darkText;
  return relativeLuminance(rgb.r, rgb.g, rgb.b) < 0.45 ? lightText : darkText;
}

export function workStartLabel(workHours: UserWorkHours): string {
  return formatHourLabel(workHours.startHour);
}

export function workEndLabel(workHours: UserWorkHours): string {
  return formatHourLabel(workHours.endHour);
}
