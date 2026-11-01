// What the charts draw: the marks in each day's column, and day-by-day totals. Built on the same
// counting functions as Today and History, so a chart never disagrees with the numbers.
import { TYPES } from './config'
import { eventEndMs, nursingSeconds, sleepKind, totalsFor, type Totals } from './counting'
import { addDaysTz, atLocalTime, dayStart } from './time'
import type { Child, EventType, Family, LeelaEvent, TimerSegment } from './types'
import { WHO } from './whoData'

const MIN = 60_000
const DAY = 86_400_000

/** The colour classes of the week chart. Everything that isn't sleep, a feed or a diaper is grey,
 * and health entries get their own marker shape, so no two classes rely on hues that look alike. */
export type MarkKind = 'night' | 'nap' | 'feed' | 'diaper' | 'health' | 'other'
export type Filter = 'sleep' | 'feed' | 'diaper' | 'health' | 'other'

export const MARK_FILTER: Record<MarkKind, Filter> = { night: 'sleep', nap: 'sleep', feed: 'feed', diaper: 'diaper', health: 'health', other: 'other' }

export interface Mark {
  id: string
  kind: MarkKind
  type: EventType
  start: number
  end: number
  /** Logged with a length (sleep, a timed feed, an activity), rather than at a moment. */
  timed: boolean
}

export interface Column {
  /** Local midnight of the column's date. */
  day: number
  from: number
  to: number
  marks: Mark[]
}

const KIND: Partial<Record<EventType, MarkKind>> = {
  nursing: 'feed',
  bottle: 'feed',
  solids: 'feed',
  diaper: 'diaper',
  potty: 'diaper',
  temperature: 'health',
  medicine: 'health',
  symptom: 'health',
  activity: 'other',
  pump: 'other',
  milestone: 'other',
  contraction: 'other',
}

function belongs(e: LeelaEvent, childId: string, userId: string | null): boolean {
  if (e.deleted_at) return false
  if (TYPES[e.type]?.familyLevel) return e.created_by === userId
  return e.child_id === childId
}

/** When an entry ends, for drawing: timers run to now, breastfeeds last as long as their sides. */
function endOf(e: LeelaEvent, segments: TimerSegment[], now: number): number {
  const start = Date.parse(e.started_at)
  if (e.type === 'nursing' && !e.ended_at && !e.timer_state) {
    const s = nursingSeconds(e, segments, now)
    return start + (s.left + s.right) * 1000
  }
  return eventEndMs(e, now)
}

/** Marks that fall in [from, to), clipped to it. */
export function marksBetween(
  events: LeelaEvent[],
  segments: TimerSegment[],
  childId: string,
  userId: string | null,
  family: Pick<Family, 'timezone' | 'night_start' | 'night_end'>,
  from: number,
  to: number,
  now: number,
): Mark[] {
  const out: Mark[] = []
  for (const e of events) {
    if (!belongs(e, childId, userId)) continue
    const kind: MarkKind | undefined = e.type === 'sleep' ? (sleepKind(e, family) === 'night' ? 'night' : 'nap') : KIND[e.type]
    if (!kind) continue
    const start = Date.parse(e.started_at)
    const end = Math.max(start, endOf(e, segments, now))
    if (end < from || start >= to) continue
    if (start < from && end <= from) continue
    out.push({ id: e.id, kind, type: e.type, start: Math.max(start, from), end: Math.min(end, to), timed: end - start >= MIN })
  }
  // Sleep first, so feeds and diapers draw on top of it.
  const order: Record<MarkKind, number> = { night: 0, nap: 1, other: 2, feed: 3, diaper: 4, health: 5 }
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.start - b.start)
}

/** Seven (or `count`) columns ending on `lastDay`, each running from `startHHMM` to the same time next day. */
export function weekColumns(
  events: LeelaEvent[],
  segments: TimerSegment[],
  childId: string,
  userId: string | null,
  family: Pick<Family, 'timezone' | 'night_start' | 'night_end'>,
  lastDay: number,
  count: number,
  startHHMM: string,
  now: number,
): Column[] {
  const tz = family.timezone
  const cols: Column[] = []
  for (let i = count - 1; i >= 0; i--) {
    const day = addDaysTz(lastDay, -i, tz).getTime()
    const from = atLocalTime(day, startHHMM, tz).getTime()
    const to = atLocalTime(addDaysTz(day, 1, tz).getTime(), startHHMM, tz).getTime()
    cols.push({ day, from, to, marks: marksBetween(events, segments, childId, userId, family, from, to, now) })
  }
  return cols
}

// ---------------------------------------------------------------------------- day-by-day totals
export interface DayStats {
  day: number
  totals: Totals
  /** Breastfeeding minutes, by side. */
  leftMin: number
  rightMin: number
  otherMin: number
  activityMin: number
  activityByKind: Record<string, number>
  pottyWins: number
  pottyAccidents: number
  newFoods: string[]
}

export function lastDays(now: number, count: number, tz: string): number[] {
  const today = dayStart(now, tz).getTime()
  return Array.from({ length: count }, (_, i) => addDaysTz(today, i - count + 1, tz).getTime())
}

export function dailyStats(
  events: LeelaEvent[],
  segments: TimerSegment[],
  childId: string,
  family: Pick<Family, 'timezone' | 'night_start' | 'night_end'>,
  days: number[],
  now: number,
): DayStats[] {
  const tz = family.timezone
  return days.map((day) => {
    const next = addDaysTz(day, 1, tz).getTime()
    const totals = totalsFor(events, segments, childId, day, next, family, now)
    const s: DayStats = {
      day,
      totals,
      leftMin: Math.round(totals.nursingLeftS / 60),
      rightMin: Math.round(totals.nursingRightS / 60),
      otherMin: Math.round(totals.nursingOtherS / 60),
      activityMin: 0,
      activityByKind: {},
      pottyWins: 0,
      pottyAccidents: 0,
      newFoods: [],
    }
    for (const e of events) {
      if (e.deleted_at || e.child_id !== childId) continue
      const t = Date.parse(e.started_at)
      if (t < day || t >= next) continue
      if (e.type === 'activity') {
        const m = Math.round((eventEndMs(e, now) - t) / MIN)
        if (m > 0) {
          s.activityMin += m
          const k = String(e.data.kind ?? e.data.label ?? 'other')
          s.activityByKind[k] = (s.activityByKind[k] ?? 0) + m
        }
      } else if (e.type === 'potty') {
        if (e.data.outcome === 'accident') s.pottyAccidents += 1
        else s.pottyWins += 1
      } else if (e.type === 'solids') {
        for (const f of e.data.foods ?? []) if (f.first) s.newFoods.push(f.name)
      }
    }
    return s
  })
}

// ---------------------------------------------------------------------------- growth against WHO standards
export type GrowthKind = 'weight' | 'length' | 'head'

/** The standard WHO chart lines. */
export const CENTILES = [
  { p: 3, z: -1.8808 },
  { p: 15, z: -1.0364 },
  { p: 50, z: 0 },
  { p: 85, z: 1.0364 },
  { p: 97, z: 1.8808 },
] as const

export function lmsAt(kind: GrowthKind, sex: Child['sex'], months: number): [number, number, number] | null {
  if (!sex || months < 0 || months > 60) return null
  const t = WHO[kind][sex]
  const i = Math.min(59, Math.floor(months))
  const f = months - i
  const a = t[i]
  const b = t[i + 1]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

export function valueAtZ([L, M, S]: [number, number, number], z: number): number {
  return L === 0 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L)
}

export function zOf([L, M, S]: [number, number, number], x: number): number {
  return L === 0 ? Math.log(x / M) / S : (Math.pow(x / M, L) - 1) / (L * S)
}

/** Share of children below z, as a percentile (0–100). */
export function percentileOf(z: number): number {
  // Abramowitz and Stegun 7.1.26, accurate to about 1e-7.
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2))
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2)
  return 50 * (1 + Math.sign(z) * y)
}

export const ageMonths = (birthOrDue: string, at: number) => (at - Date.parse(`${birthOrDue}T00:00:00Z`)) / (DAY * 30.4375)

export interface GrowthPoint {
  id: string
  at: number
  months: number
  value: number
  percentile?: number
}

/** Measurements of one kind, oldest first, with their WHO percentile when the sex and age allow. */
export function growthPoints(events: LeelaEvent[], child: Child, kind: GrowthKind): GrowthPoint[] {
  const field = kind === 'weight' ? 'weight_kg' : kind === 'length' ? 'length_cm' : 'head_cm'
  const born = child.birth_date
  if (!born) return []
  // Corrected age for babies born early, used until 24 months, as for wake windows.
  const ref = child.due_date && child.due_date > born ? child.due_date : born
  const out: GrowthPoint[] = []
  for (const e of events) {
    if (e.deleted_at || e.type !== 'growth' || e.child_id !== child.id) continue
    const v = e.data[field]
    if (typeof v !== 'number' || !(v > 0)) continue
    const at = Date.parse(e.started_at)
    const corrected = ageMonths(ref, at)
    const months = corrected < 24 ? corrected : ageMonths(born, at)
    if (months < 0) continue
    const lms = lmsAt(kind, child.sex, months)
    out.push({ id: e.id, at, months, value: v, percentile: lms ? percentileOf(zOf(lms, v)) : undefined })
  }
  return out.sort((a, b) => a.at - b.at)
}
