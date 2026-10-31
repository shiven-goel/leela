// Leela's nap window: age-based starting ranges, blended with the baby's own logged wake windows.
// Pure function of synced data, so every phone in the family shows the same answer.
import type { Child, Family, LeelaEvent } from './types'
import { sleepKind, sleepState } from './counting'
import { atLocalTime, dayStart, minuteOfDay } from './time'

export interface WakeWindowRange {
  label: string
  maxAgeDays: number
  minMin: number
  maxMin: number
  naps: string
}

// Starting ranges adapted from published guidance; editable per child in settings.wakeWindows.
export const WAKE_WINDOWS: WakeWindowRange[] = [
  { label: '0–2 months', maxAgeDays: 91, minMin: 45, maxMin: 90, naps: '4–6' },
  { label: '3–4 months', maxAgeDays: 152, minMin: 60, maxMin: 120, naps: '3–4' },
  { label: '5–7 months', maxAgeDays: 244, minMin: 120, maxMin: 180, naps: '3' },
  { label: '8–10 months', maxAgeDays: 335, minMin: 180, maxMin: 210, naps: '2–3' },
  { label: '11–18 months', maxAgeDays: 579, minMin: 180, maxMin: 240, naps: '2' },
  { label: '19–36 months', maxAgeDays: 1127, minMin: 300, maxMin: 360, naps: '1' },
]

export type NapEstimate =
  | { kind: 'nap' | 'bedtime'; start: number; end: number; basis: string }
  | { kind: 'newborn'; range: WakeWindowRange }

const DAY = 86_400_000
const MIN = 60_000

export function ageInDays(child: Pick<Child, 'birth_date' | 'due_date'>, now: number): number | null {
  if (!child.birth_date) return null
  const birth = Date.parse(`${child.birth_date}T00:00:00Z`)
  let age = (now - birth) / DAY
  // Corrected age for babies born early, used until 24 months.
  if (child.due_date) {
    const due = Date.parse(`${child.due_date}T00:00:00Z`)
    if (due > birth && age < 730) age = (now - due) / DAY
  }
  return Math.floor(age)
}

export function rangeForAge(days: number, overrides?: unknown): WakeWindowRange {
  const base = WAKE_WINDOWS.find((r) => days < r.maxAgeDays) ?? WAKE_WINDOWS[WAKE_WINDOWS.length - 1]
  if (overrides && typeof overrides === 'object') {
    const o = (overrides as Record<string, { minMin?: number; maxMin?: number }>)[base.label]
    if (o && typeof o.minMin === 'number' && typeof o.maxMin === 'number' && o.maxMin >= o.minMin) {
      return { ...base, minMin: o.minMin, maxMin: o.maxMin }
    }
  }
  return base
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function estimateNextSleep(
  events: LeelaEvent[],
  child: Child,
  family: Family,
  nowRaw: number,
): NapEstimate | null {
  const now = nowRaw
  const age = ageInDays(child, now)
  if (age === null || age < 0) return null
  const range = rangeForAge(age, child.settings?.wakeWindows)
  if (age < 56) return { kind: 'newborn', range }

  const state = sleepState(events, child.id, now)
  if (state.asleep || state.since === null) return null

  // In the small hours there is no nap to predict; after the evening starts, it's bedtime.
  const minute = minuteOfDay(now, family.timezone)
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number)
    return (h || 0) * 60 + (m || 0)
  }
  const nightStartMin = toMin(family.night_start)
  const nightEndMin = toMin(family.night_end)
  if (nightStartMin > nightEndMin && minute < nightEndMin) return null
  const evening = minute >= nightStartMin

  const sleeps = events
    .filter((e) => !e.deleted_at && e.type === 'sleep' && e.child_id === child.id && e.ended_at)
    .sort((a, b) => a.started_at.localeCompare(b.started_at))

  // The baby's own wake windows over the last 14 days, by their position in the day.
  const byPosition: number[][] = [[], [], [], []]
  const all: number[] = []
  const days = new Set<string>()
  const since14 = now - 14 * DAY
  let napsSinceNight = 0
  for (let i = 1; i < sleeps.length; i++) {
    const prev = sleeps[i - 1]
    const next = sleeps[i]
    if (sleepKind(prev, family) === 'night') napsSinceNight = 0
    const prevEnd = Date.parse(prev.ended_at!)
    const gapMin = (Date.parse(next.started_at) - prevEnd) / MIN
    if (prevEnd >= since14 && gapMin >= 20 && gapMin <= 8 * 60) {
      byPosition[Math.min(napsSinceNight, 3)].push(gapMin)
      all.push(gapMin)
      days.add(dayStart(next.started_at, family.timezone).toISOString())
    }
    if (sleepKind(next, family) === 'nap') napsSinceNight++
  }

  // Which window of the day are we in? Count naps since the morning wake.
  let lastNightEnd = dayStart(now, family.timezone).getTime()
  for (const e of sleeps) {
    if (sleepKind(e, family) === 'night') lastNightEnd = Math.max(lastNightEnd, Date.parse(e.ended_at!))
  }
  const napsToday = sleeps.filter(
    (e) => Date.parse(e.started_at) >= lastNightEnd && sleepKind(e, family) === 'nap',
  ).length
  const pos = Math.min(napsToday, 3)

  // Earlier windows of the day are shorter; the one before bed is longest.
  const share = [0.25, 0.5, 0.7, 0.85][pos]
  const fromDefault = range.minMin + (range.maxMin - range.minMin) * share

  const samples = byPosition[pos].length >= 3 ? byPosition[pos] : all.length >= 5 ? all : []
  let est = fromDefault
  let basis = `typical for ${range.label}`
  if (samples.length) {
    const weight = Math.min(1, days.size / 7) * 0.7
    est = fromDefault * (1 - weight) + median(samples) * weight
    basis = `based on ${days.size} ${days.size === 1 ? 'day' : 'days'} of logs`
  }

  // A short last nap usually means a shorter next window.
  const last = state.event
  if (last && sleepKind(last, family) === 'nap') {
    const napMin = (Date.parse(last.ended_at!) - Date.parse(last.started_at)) / MIN
    if (napMin < 40) est -= 15
  }

  est = Math.max(range.minMin - 30, Math.min(range.maxMin + 30, est))
  const center = state.since + est * MIN
  const nightStart = atLocalTime(now, family.night_start, family.timezone).getTime()
  const kind: 'nap' | 'bedtime' = evening || center >= nightStart - 45 * MIN ? 'bedtime' : 'nap'
  return { kind, start: center - 15 * MIN, end: center + 15 * MIN, basis }
}
