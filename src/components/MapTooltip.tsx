import {
  isPrimaryWorkHoursColumn,
  scoreToFill,
  textColorForBackground,
} from '../lib/workHours'
import type { UserWorkHours, ZoneLateness, WorkHoursRange } from '../lib/workHours'
import { interpolateReds } from 'd3-scale-chromatic'

export interface TooltipState {
  x: number
  y: number
  countryName: string | null
  tzid: string
  lateness: ZoneLateness
  workHours: WorkHoursRange[]
  userWorkHours: UserWorkHours
}

interface MapTooltipProps {
  tooltip: TooltipState | null
}

export function MapTooltip({ tooltip }: MapTooltipProps) {
  if (!tooltip) return null

  const { countryName, tzid, lateness, workHours, userWorkHours } = tooltip
  const pct = Math.round(lateness.score * 100)
  const fill = scoreToFill(lateness.score, interpolateReds, lateness.sameWorkHours)
  const primaryBg = lateness.sameWorkHours ? '#cbd5e0' : fill

  return (
    <div
      className="map-tooltip"
      style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}
      role="tooltip"
    >
      {countryName && (
        <div className="map-tooltip-country">{countryName}</div>
      )}
      <div className="map-tooltip-tzid">{tzid}</div>
      <div>Work start here: {lateness.workStartLocal}</div>
      <div>Lateness: {pct}%</div>
      <ul className="map-tooltip-hours">
        {workHours.map(({ label, localRange }) => {
          const isPrimary = isPrimaryWorkHoursColumn(label, userWorkHours)
          return (
            <li key={label}>
              {label}:{' '}
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
          )
        })}
      </ul>
    </div>
  )
}
