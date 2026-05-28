import { useMemo } from 'react'
import {
  computeAllZoneLateness,
  type PeakLatenessRange,
  type UserWorkHours,
  type ZoneLateness,
} from '../lib/workHours'

export function useTimezoneScores(
  userTz: string,
  tzids: string[],
  peakLateRange: PeakLatenessRange,
  userWorkHours: UserWorkHours,
): Map<string, ZoneLateness> {
  return useMemo(
    () => computeAllZoneLateness(userTz, tzids, peakLateRange, userWorkHours),
    [userTz, tzids, peakLateRange, userWorkHours],
  )
}
