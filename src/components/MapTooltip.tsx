import { interpolateReds } from "d3-scale-chromatic";
import {
  isPrimaryWorkHoursColumn,
  scoreToFill,
  textColorForBackground,
} from "../lib/workHours";
import type {
  UserWorkHours,
  WorkHoursRange,
  ZoneLateness,
} from "../lib/workHours";

export interface TooltipState {
  x: number;
  y: number;
  countryName: string | null;
  tzid: string;
  lateness: ZoneLateness;
  workHours: WorkHoursRange[];
  userWorkHours: UserWorkHours;
}

interface MapTooltipProps {
  tooltip: TooltipState | null;
  onDismiss?: () => void;
}

export function MapTooltip({ tooltip, onDismiss }: MapTooltipProps) {
  if (!tooltip) return null;

  const { countryName, tzid, lateness, workHours, userWorkHours } = tooltip;
  const pct = Math.round(lateness.score * 100);
  const fill = scoreToFill(
    lateness.score,
    interpolateReds,
    lateness.sameWorkHours,
  );
  const primaryBg = lateness.sameWorkHours ? "#cbd5e0" : fill;

  return (
    <div className="map-tooltip" role="tooltip">
      <div className="map-tooltip-header">
        <div className="map-tooltip-heading">
          {countryName && (
            <div className="map-tooltip-country">{countryName}</div>
          )}
          <div className="map-tooltip-tzid">{tzid}</div>
        </div>
        {onDismiss && (
          <button
            type="button"
            className="map-tooltip-close"
            aria-label="Close timezone details"
            onClick={onDismiss}
          >
            ×
          </button>
        )}
      </div>
      <div>Work start here: {lateness.workStartLocal}</div>
      <div>Lateness: {pct}%</div>
      <ul className="map-tooltip-hours">
        {workHours.map(({ label, localRange }) => {
          const isPrimary = isPrimaryWorkHoursColumn(label, userWorkHours);
          return (
            <li key={label}>
              {label}:{" "}
              {isPrimary ? (
                <span
                  className="map-tooltip-hours-primary"
                  style={{
                    backgroundColor: primaryBg,
                    color: textColorForBackground(primaryBg),
                  }}
                >
                  {localRange}
                </span>
              ) : (
                localRange
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
