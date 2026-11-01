// Sweet spot: when the baby is likely ready to sleep next, how the rest of the day may go, when
// they'll likely wake, and when the next feed is likely.
//
// Like Huckleberry's SweetSpot, it starts from wake windows that are typical for the baby's age
// and leans towards the baby's own pattern once about five days of sleep are logged, staying
// inside the normal range for that age. It's a pure function of the synced data, so every phone in
// the family shows the same answer.

import { sleepKind } from './counting'
import { addDaysTz, atLocalTime, minuteOfDay } from './time'
import type { Child, Family, LeelaEvent } from './types'

const MIN = 60_000
const H = 60 * MIN
const DAY = 24 * H

type Fam = Pick<Family, 'timezone' | 'night_start' | 'night_end'>

// ---------------------------------------------------------------------------- age guide
export interface AgeGuide {
  /** Upper bound of the band, in days of age (corrected for babies born early). */
  until: number
  label: string
  /** Minutes awake between sleeps: shortest in the morning, longest before bed. */
  wake: [number, number]
  naps: [number, number]
  defaultNaps: number
  napMin: number
  /** Hours of daytime sleep. */
  daySleep: [number, number]
}

// Adapted from published guidance (Huckleberry's wake-window and nap charts).
export const AGE_GUIDE: AgeGuide[] = [
  { until: 28, label: 'newborns', wake: [30, 60], naps: [4, 6], defaultNaps: 5, napMin: 50, daySleep: [5, 8] },
  { until: 56, label: '1 month', wake: [45, 90], naps: [4, 6], defaultNaps: 5, napMin: 60, daySleep: [5, 7] },
  { until: 91, label: '2 months', wake: [60, 105], naps: [4, 5], defaultNaps: 4, napMin: 70, daySleep: [5, 6] },
  { until: 122, label: '3 months', wake: [60, 120], naps: [4, 5], defaultNaps: 4, napMin: 60, daySleep: [4, 5] },
  { until: 183, label: '4–5 months', wake: [90, 150], naps: [3, 4], defaultNaps: 3, napMin: 60, daySleep: [3, 4.5] },
  { until: 213, label: '6 months', wake: [120, 180], naps: [3, 3], defaultNaps: 3, napMin: 60, daySleep: [2.5, 3.5] },
  { until: 274, label: '7–8 months', wake: [150, 210], naps: [2, 3], defaultNaps: 3, napMin: 70, daySleep: [2, 3.5] },
  { until: 304, label: '9 months', wake: [150, 210], naps: [2, 2], defaultNaps: 2, napMin: 75, daySleep: [2, 3] },
  { until: 396, label: '10–12 months', wake: [180, 240], naps: [2, 2], defaultNaps: 2, napMin: 75, daySleep: [2, 3] },
  { until: 457, label: '13–14 months', wake: [180, 270], naps: [1, 2], defaultNaps: 2, napMin: 90, daySleep: [2, 3] },
  { until: 579, label: '15–18 months', wake: [240, 330], naps: [1, 2], defaultNaps: 1, napMin: 120, daySleep: [2, 3] },
  { until: 730, label: '19–24 months', wake: [300, 360], naps: [1, 1], defaultNaps: 1, napMin: 120, daySleep: [1.5, 2.5] },
  { until: 1096, label: '2 years', wake: [315, 390], naps: [1, 1], defaultNaps: 1, napMin: 100, daySleep: [1, 2] },
  { until: 1461, label: '3 years', wake: [360, 420], naps: [0, 1], defaultNaps: 1, napMin: 75, daySleep: [0, 1.5] },
  { until: Infinity, label: '4 years and up', wake: [360, 480], naps: [0, 1], defaultNaps: 0, napMin: 60, daySleep: [0, 1] },
]

/** Below this age (8 weeks) sleep is too irregular to forecast; Leela shows the newborn guide. */
export const NEWBORN_DAYS = 56

export function ageInDays(child: Pick<Child, 'birth_date' | 'due_date'>, now: number): number | null {
  if (!child.birth_date) return null
  const birth = Date.parse(`${child.birth_date}T00:00:00Z`)
  if (Number.isNaN(birth)) return null
  let age = (now - birth) / DAY
  // Corrected age for babies born early, used until 24 months.
  if (child.due_date) {
    const due = Date.parse(`${child.due_date}T00:00:00Z`)
    if (due > birth && age < 730) age = (now - due) / DAY
  }
  return Math.floor(age)
}

export function guideFor(days: number): AgeGuide {
  return AGE_GUIDE.find((g) => days < g.until) ?? AGE_GUIDE[AGE_GUIDE.length - 1]
}

// ---------------------------------------------------------------------------- settings
/** Shared by the family, saved on the baby (children.settings.sweetspot). */
export interface SweetSpotSettings {
  /** Naps a day; unset means worked out from the logs. */
  naps?: number
  /** Target bedtime, "HH:MM"; unset means worked out from the logs. */
  bedtime?: string
  /** Minutes added to every wake window (negative for shorter). */
  adjust?: number
  /** The family's own wake windows, in minutes. */
  custom?: { first: number; middle: number; last: number }
}

const isHhmm = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

export function readSettings(settings: Record<string, unknown> | null | undefined): SweetSpotSettings {
  const raw = settings?.sweetspot
  if (!raw || typeof raw !== 'object') return {}
  const s = raw as Record<string, unknown>
  const out: SweetSpotSettings = {}
  if (isNum(s.naps, 0, 6)) out.naps = Math.round(s.naps)
  if (isHhmm(s.bedtime)) out.bedtime = s.bedtime
  if (isNum(s.adjust, -90, 90)) out.adjust = Math.round(s.adjust)
  const c = s.custom as Record<string, unknown> | undefined
  if (c && isNum(c.first, 15, 600) && isNum(c.middle, 15, 600) && isNum(c.last, 15, 600)) {
    out.custom = { first: c.first, middle: c.middle, last: c.last }
  }
  return out
}

// ---------------------------------------------------------------------------- results
export interface SleepWindow {
  kind: 'nap' | 'bedtime'
  /** The window, rounded to 5 minutes. */
  start: number
  end: number
  center: number
  /** Which nap of the day this is, from 1. */
  napNumber?: number
  /** Expected length of the nap, in minutes. */
  lengthMin?: number
  /** A short nap to bridge the gap to bedtime. */
  short?: boolean
}

export interface FeedForecast {
  /** When the next feed is likely. */
  at: number
  /** Start of the last feed. */
  last: number
  /** Typical gap between feeds, in minutes. */
  everyMin: number
  basis: 'logs' | 'age'
}

export interface Pattern {
  /** Days in the last week with enough sleep logged to learn from. */
  days: number
  /** How much the baby's own pattern counts, 0 to 0.85. */
  weight: number
  /** The baby's own typical wake windows, in minutes. */
  first?: number
  middle?: number
  last?: number
  napMin?: number
  naps?: number
  /** Minutes after midnight, can pass 1440 for bedtimes after midnight. */
  bedtimeMin?: number
  wakeMin?: number
  daySleepMin?: number
}

export type SweetSpotStatus =
  | 'ok' // awake: `next` is the next sleep
  | 'napping' // asleep for a nap: `wakeAround`, then `later`
  | 'night' // asleep for the night, or awake in the night: `wakeAround` is the morning wake-up
  | 'newborn' // under 8 weeks: `next` comes from the newborn wake window
  | 'needs-sleep' // nothing recent to predict from
  | 'needs-birthday'

export interface SweetSpot {
  status: SweetSpotStatus
  next?: SleepWindow
  later: SleepWindow[]
  wakeAround?: number
  awakeSince?: number
  asleepSince?: number
  /** While napping: how long this nap is expected to last, in minutes. */
  napExpectMin?: number
  /** Naps so far today, and the daytime sleep they add up to. */
  napsToday: number
  daySleepMs: number
  napsPlanned: number
  /** Wake windows in use today, minutes: before the first nap, between naps, before bed. */
  windows: { first: number; middle: number; last: number }
  bedtimeTarget?: number
  ageDays: number | null
  guide: AgeGuide
  pattern: Pattern
  basis: 'age' | 'logs' | 'custom'
  settings: SweetSpotSettings
  feed?: FeedForecast
}

export function phase(w: Pick<SleepWindow, 'start' | 'end'>, now: number): 'soon' | 'now' | 'late' {
  if (now < w.start) return 'soon'
  if (now <= w.end) return 'now'
  return 'late'
}

// ---------------------------------------------------------------------------- helpers
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const round5 = (t: number) => Math.round(t / (5 * MIN)) * 5 * MIN
/** The local date, "2026-11-01", without pulling in date formatting (this file also runs on the server). */
const dayFormats = new Map<string, Intl.DateTimeFormat>()
function dayKey(t: number, tz: string): string {
  let f = dayFormats.get(tz)
  if (!f) dayFormats.set(tz, (f = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz })))
  return f.format(t)
}

function inWindow(m: number, startMin: number, endMin: number) {
  return startMin > endMin ? m >= startMin || m < endMin : m >= startMin && m < endMin
}

interface Weighted {
  v: number
  w: number
}
/** Median that lets recent days count more. */
function weightedMedian(xs: Weighted[]): number | undefined {
  if (!xs.length) return undefined
  const s = [...xs].sort((a, b) => a.v - b.v)
  const total = s.reduce((n, x) => n + x.w, 0)
  let acc = 0
  for (const x of s) {
    acc += x.w
    if (acc >= total / 2) return x.v
  }
  return s[s.length - 1].v
}
const recency = (at: number, now: number) => Math.pow(0.5, Math.max(0, now - at) / (4 * DAY))

/** A local time on the local day of `ref`; minutes can pass 1440 for the next day. */
function atMinute(ref: number, minute: number, tz: string): number {
  const days = Math.floor(minute / 1440)
  const m = ((Math.round(minute) % 1440) + 1440) % 1440
  const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const base = days ? addDaysTz(ref, days, tz).getTime() : ref
  return atLocalTime(base, hhmm, tz).getTime()
}

// ---------------------------------------------------------------------------- the baby's days
interface Sleep {
  start: number
  end: number | null
  night: boolean
}

interface Day {
  /** Morning wake-up: the end of the night before, when logged. */
  wake: number | null
  naps: Sleep[]
  /** Start of the night's sleep, when logged. */
  bedtime: number | null
}

function isNight(e: LeelaEvent, fam: Fam, now: number): boolean {
  if (e.data.kind === 'night') return true
  if (e.data.kind === 'nap') return false
  if (sleepKind(e, fam) === 'night') return true
  const start = Date.parse(e.started_at)
  const end = e.ended_at ? Date.parse(e.ended_at) : e.timer_state ? now : start
  if (end - start >= 5 * H) return true
  // A bedtime a little before the family's night hours still starts the night.
  const before = toMin(fam.night_start) - minuteOfDay(start, fam.timezone)
  return before > 0 && before <= 120 && end - start >= 3 * H
}

function sleepsOf(events: LeelaEvent[], childId: string, fam: Fam, now: number): Sleep[] {
  const since = now - 15 * DAY
  const list: Sleep[] = []
  for (const e of events) {
    if (e.deleted_at || e.type !== 'sleep' || e.child_id !== childId) continue
    const start = Date.parse(e.started_at)
    if (start < since || start > now) continue
    const end = e.ended_at ? Date.parse(e.ended_at) : e.timer_state ? null : start
    if (end !== null && end <= start) continue
    list.push({ start, end: end === null ? null : Math.min(end, now), night: isNight(e, fam, now) })
  }
  list.sort((a, b) => a.start - b.start)
  // A sleep that resumes within a few minutes is one sleep.
  const merged: Sleep[] = []
  for (const s of list) {
    const prev = merged[merged.length - 1]
    if (prev && prev.end !== null && s.start - prev.end < 15 * MIN) {
      prev.end = s.end === null ? null : Math.max(prev.end, s.end)
      prev.night = prev.night || s.night
    } else if (prev && (prev.end === null || s.start < prev.end)) {
      // Overlapping entries: keep the longer reach.
      if (prev.end !== null) prev.end = s.end === null ? null : Math.max(prev.end, s.end)
      prev.night = prev.night || s.night
    } else merged.push({ ...s })
  }
  return merged
}

function buildDays(sleeps: Sleep[], fam: Fam): { days: Day[]; current: Day | null } {
  const ns = toMin(fam.night_start)
  const ne = toMin(fam.night_end)
  const night = (t: number) => inWindow(minuteOfDay(t, fam.timezone), ns, ne)
  const days: Day[] = []
  let cur: Day | null = null
  let lastEnd: number | null = null
  for (const s of sleeps) {
    if (s.night) {
      const sameNight =
        cur !== null &&
        cur.naps.length === 0 &&
        cur.wake !== null &&
        (s.start - cur.wake < 4 * H || (night(cur.wake) && night(s.start) && s.start - cur.wake < 8 * H))
      if (sameNight && cur) cur.wake = s.end
      else {
        if (cur) {
          cur.bedtime = s.start
          days.push(cur)
        }
        cur = { wake: s.end, naps: [], bedtime: null }
      }
    } else {
      if (!cur || (lastEnd !== null && s.start - lastEnd > 14 * H)) {
        // A nap with no night logged before it starts a day whose wake-up isn't known.
        if (cur) days.push(cur)
        cur = { wake: null, naps: [], bedtime: null }
      }
      cur.naps.push(s)
    }
    lastEnd = s.end
  }
  return { days, current: cur }
}

// ---------------------------------------------------------------------------- learning the pattern
interface Learned {
  pattern: Pattern
  ratios: { first?: number; middle?: number; last?: number; all?: number }
  /** Minutes at the same place in days with the same number of naps, keyed "position/naps". */
  exact: Map<string, Weighted[]>
  napLen: { byIndex: (number | undefined)[]; all?: number }
}

/** Typical wake window at position i of a day with n naps (position n is the one before bed). */
function ageWindow(i: number, n: number, wake: [number, number]): number {
  const [lo, hi] = wake
  if (n <= 0) return hi
  return lo + (hi - lo) * (0.15 + (0.85 * Math.min(i, n)) / n)
}

function learn(all: Day[], now: number, fam: Fam, guide: AgeGuide, napsRef: number): Learned {
  const tz = fam.timezone
  const since = now - 10 * DAY
  const week = now - 7 * DAY
  const groups: Record<'first' | 'middle' | 'last', Weighted[]> = { first: [], middle: [], last: [] }
  const allRatios: Weighted[] = []
  const lengths: Weighted[][] = []
  const allLengths: Weighted[] = []
  const naps: Weighted[] = []
  const bedtimes: Weighted[] = []
  const wakes: Weighted[] = []
  const daySleep: Weighted[] = []
  const learnedDays = new Set<string>()
  const [lo, hi] = guide.wake
  const ageMid = napsRef >= 2 ? Array.from({ length: napsRef - 1 }, (_, k) => ageWindow(k + 1, napsRef, guide.wake)).reduce((a, b) => a + b, 0) / (napsRef - 1) : (lo + hi) / 2
  const ageOf = { first: ageWindow(0, Math.max(1, napsRef), guide.wake), middle: ageMid, last: hi }

  const exact = new Map<string, Weighted[]>()
  const add = (g: 'first' | 'middle' | 'last', minutes: number, at: number, key: string | null) => {
    if (at < since || minutes < 10 || minutes > 8 * 60 || minutes > hi * 2.2) return
    const w = recency(at, now)
    const r = minutes / ageOf[g]
    groups[g].push({ v: r, w })
    allRatios.push({ v: r, w })
    if (key) exact.set(key, [...(exact.get(key) ?? []), { v: minutes, w }])
    if (at >= week) learnedDays.add(dayKey(at, tz))
  }

  for (const d of all) {
    const n = d.naps.length
    const done = d.naps.filter((s) => s.end !== null)
    // Only a fully logged day says which window of the day each gap was.
    const whole = d.wake !== null && d.bedtime !== null
    const key = (pos: number) => (whole ? `${pos}/${n}` : null)
    if (d.wake !== null && n >= 1) add('first', (d.naps[0].start - d.wake) / MIN, d.naps[0].start, key(0))
    for (let k = 1; k < n; k++) {
      const prevEnd = d.naps[k - 1].end
      if (prevEnd !== null) add('middle', (d.naps[k].start - prevEnd) / MIN, d.naps[k].start, key(k))
    }
    const lastEnd = n ? d.naps[n - 1].end : null
    if (d.bedtime !== null && n >= 1 && lastEnd !== null) add('last', (d.bedtime - lastEnd) / MIN, d.bedtime, key(n))
    done.forEach((s, k) => {
      if (s.start < since) return
      const len = (s.end! - s.start) / MIN
      if (len < 10 || len > 5 * 60) return
      const w = recency(s.start, now)
      ;(lengths[k] ??= []).push({ v: len, w })
      allLengths.push({ v: len, w })
    })
    if (d.wake !== null && d.wake >= since) {
      let m = minuteOfDay(d.wake, tz)
      if (m > 15 * 60) m -= 1440
      wakes.push({ v: m, w: recency(d.wake, now) })
    }
    if (d.bedtime !== null && d.bedtime >= since) {
      let m = minuteOfDay(d.bedtime, tz)
      if (m < 12 * 60) m += 1440
      bedtimes.push({ v: m, w: recency(d.bedtime, now) })
      if (d.wake !== null && d.bedtime >= week) {
        naps.push({ v: n, w: recency(d.bedtime, now) })
        daySleep.push({ v: done.reduce((t, s) => t + (s.end! - s.start), 0) / MIN, w: recency(d.bedtime, now) })
      }
    }
  }

  const days = learnedDays.size
  const weight = days < 3 ? 0 : Math.min(0.85, 0.15 * days)
  const ratio = (g: Weighted[]) => (g.length >= 2 ? weightedMedian(g) : undefined)
  const med = (xs: Weighted[], minN = 3) => (xs.length >= minN ? weightedMedian(xs) : undefined)
  const napsMed = med(naps)
  const r = { first: ratio(groups.first), middle: ratio(groups.middle), last: ratio(groups.last), all: allRatios.length >= 3 ? weightedMedian(allRatios) : undefined }
  return {
    pattern: {
      days,
      weight,
      first: groups.first.length >= 2 ? Math.round(r.first! * ageOf.first) : undefined,
      middle: groups.middle.length >= 2 ? Math.round(r.middle! * ageOf.middle) : undefined,
      last: groups.last.length >= 2 ? Math.round(r.last! * ageOf.last) : undefined,
      napMin: med(allLengths) !== undefined ? Math.round(med(allLengths)!) : undefined,
      naps: napsMed === undefined ? undefined : Math.round(napsMed),
      bedtimeMin: med(bedtimes),
      wakeMin: med(wakes),
      daySleepMin: med(daySleep) !== undefined ? Math.round(med(daySleep)!) : undefined,
    },
    ratios: r,
    exact,
    napLen: { byIndex: lengths.map((xs) => (xs && xs.length >= 3 ? weightedMedian(xs) : undefined)), all: med(allLengths) },
  }
}

// ---------------------------------------------------------------------------- the forecast
export function sweetSpot(events: LeelaEvent[], child: Child, fam: Fam, now: number): SweetSpot {
  const tz = fam.timezone
  const settings = readSettings(child.settings)
  const ageDays = ageInDays(child, now)
  const ageGuide = guideFor(Math.max(0, ageDays ?? 400))
  const sleeps = sleepsOf(events, child.id, fam, now)
  const { days, current } = buildDays(sleeps, fam)
  const all = current ? [...days, current] : days

  // A baby moving between nap counts uses the wake windows that go with the naps they take.
  const firstPass = learn(all, now, fam, ageGuide, ageGuide.defaultNaps)
  let guide = ageGuide
  const idx = AGE_GUIDE.indexOf(ageGuide)
  const pn = firstPass.pattern.naps
  if (pn !== undefined && firstPass.pattern.days >= 3 && ageDays !== null && ageDays >= NEWBORN_DAYS) {
    if (pn > ageGuide.naps[1] && idx > 2) guide = { ...ageGuide, wake: AGE_GUIDE[idx - 1].wake, napMin: AGE_GUIDE[idx - 1].napMin }
    else if (pn < ageGuide.naps[0] && idx < AGE_GUIDE.length - 1) guide = { ...ageGuide, wake: AGE_GUIDE[idx + 1].wake, napMin: AGE_GUIDE[idx + 1].napMin }
  }
  const napsPlanned = settings.naps ?? pn ?? guide.defaultNaps
  const learned = learn(all, now, fam, guide, Math.max(1, napsPlanned))
  const { pattern, ratios } = learned
  const w = pattern.weight
  const [lo, hi] = guide.wake

  const basis: SweetSpot['basis'] = settings.custom ? 'custom' : w > 0 ? 'logs' : 'age'
  const adjust = settings.adjust ?? 0
  const lean = (r: number | undefined) => 1 + w * ((r ?? ratios.all ?? 1) - 1)
  /** Wake window before sleep number i (0 = first nap) when the day has n naps; n = bedtime. */
  const windowAt = (i: number, n: number): number => {
    let m: number
    if (settings.custom) m = i === 0 && n > 0 ? settings.custom.first : i >= n ? settings.custom.last : settings.custom.middle
    else {
      const age = ageWindow(i, n, guide.wake)
      const same = learned.exact.get(`${Math.min(i, n)}/${n}`)
      const g = i === 0 && n > 0 ? ratios.first : i >= n ? ratios.last : ratios.middle
      // The baby's own gap at this point of the day when there's enough of it, otherwise the
      // shape of the day for their age, scaled to how the baby runs.
      m = same && same.length >= 3 ? age + w * (weightedMedian(same)! - age) : age * lean(g)
      m = clamp(m, lo * 0.85, hi * 1.15)
    }
    return Math.max(15, m + adjust)
  }
  const napLen = (i: number): number => {
    const own = learned.napLen.byIndex[i] ?? learned.napLen.all
    return clamp(Math.round(own ?? guide.napMin), 20, 180)
  }

  const nightStartMin = toMin(fam.night_start)
  const nightEndMin = toMin(fam.night_end)
  const wakeMin = pattern.wakeMin ?? nightEndMin
  const bedMin = settings.bedtime ? toMin(settings.bedtime) + (toMin(settings.bedtime) < 12 * 60 ? 1440 : 0) : pattern.bedtimeMin ?? nightStartMin + (nightStartMin < 12 * 60 ? 1440 : 0)

  const running = sleeps.length && sleeps[sleeps.length - 1].end === null ? sleeps[sleeps.length - 1] : undefined
  const lastDone = [...sleeps].reverse().find((s) => s.end !== null)
  const todayNaps = current?.naps ?? []
  const daySleepMs = todayNaps.reduce((t, s) => t + ((s.end ?? now) - s.start), 0)

  const base: SweetSpot = {
    status: 'needs-sleep',
    later: [],
    napsToday: todayNaps.filter((s) => s.end !== null).length,
    daySleepMs,
    napsPlanned,
    windows: { first: Math.round(windowAt(0, Math.max(1, napsPlanned))), middle: Math.round(windowAt(1, Math.max(2, napsPlanned))), last: Math.round(windowAt(napsPlanned, napsPlanned)) },
    ageDays,
    guide,
    pattern,
    basis,
    settings,
    feed: feedForecast(events, child, fam, now, ageDays),
  }
  if (ageDays === null) return { ...base, status: 'needs-birthday' }

  /** The morning wake-up after `t`, at the baby's usual time. */
  const nextMorning = (t: number) => {
    let at = atMinute(t, wakeMin, tz)
    if (at <= t + 30 * MIN) at = atMinute(addDaysTz(t, 1, tz).getTime(), wakeMin, tz)
    return at
  }

  // Newborns: sleep comes round again a short wake window after waking.
  if (ageDays < NEWBORN_DAYS) {
    if (running) return { ...base, status: 'newborn', asleepSince: running.start }
    if (!lastDone || now - lastDone.end! > 12 * H) return base
    const start = round5(lastDone.end! + guide.wake[0] * MIN)
    const end = round5(lastDone.end! + guide.wake[1] * MIN)
    return { ...base, status: 'newborn', awakeSince: lastDone.end!, next: { kind: 'nap', start, end, center: (start + end) / 2 } }
  }

  const bedtimeOn = (dayRef: number) => atMinute(dayRef, bedMin, tz)

  /** The rest of the day from a wake-up at `from`, with `done` naps already taken. */
  const plan = (from: number, done: number, shortLast: boolean): SleepWindow[] => {
    const n = napsPlanned
    // The bedtime that belongs to this day: today's, or the coming one if it's already evening.
    let target = bedtimeOn(from)
    if (target - from > 20 * H) target = bedtimeOn(addDaysTz(from, -1, tz).getTime())
    if (target < from - 6 * H) target = bedtimeOn(addDaysTz(from, 1, tz).getTime())
    const latest = target + 30 * MIN
    const lastW = windowAt(n, n)
    const items: SleepWindow[] = []
    let t = from
    let i = done
    while (items.length < 6 && i < n) {
      let W = windowAt(i, n)
      if (i === done && shortLast) W *= 0.85
      const c = t + W * MIN
      const L = napLen(i)
      const half = clamp(Math.round(W * 0.1), 10, 20) * MIN
      if (c + (L + lastW * 0.75) * MIN <= latest) {
        items.push({ kind: 'nap', start: round5(c - half), end: round5(c + half), center: round5(c), napNumber: i + 1, lengthMin: L })
        t = c + L * MIN
        i++
        continue
      }
      // Not enough day left for a full nap: a short one bridges a long stretch to bedtime.
      const catnap = Math.min(L, 35)
      if (target - t > lastW * 1.3 * MIN && c + (catnap + lastW * 0.6) * MIN <= latest) {
        items.push({ kind: 'nap', start: round5(c - half), end: round5(c + half), center: round5(c), napNumber: i + 1, lengthMin: catnap, short: true })
        t = c + catnap * MIN
        i++
      }
      break
    }
    // Children who no longer nap go to bed at their usual time.
    const bed = n === 0 ? target : clamp(t + lastW * MIN, target - 90 * MIN, target + 45 * MIN)
    items.push({ kind: 'bedtime', start: round5(bed - 15 * MIN), end: round5(bed + 15 * MIN), center: round5(bed) })
    return items
  }

  if (running) {
    // Asleep within an hour or so of bedtime, after the day's naps: that's the night starting.
    let bedRef = bedtimeOn(running.start)
    if (bedRef - running.start > 16 * H) bedRef = bedtimeOn(addDaysTz(running.start, -1, tz).getTime())
    const napsBefore = todayNaps.filter((s) => s.end !== null).length
    if (!running.night && running.start >= bedRef - 75 * MIN && napsBefore >= Math.min(1, napsPlanned)) running.night = true
    if (running.night) return { ...base, status: 'night', asleepSince: running.start, wakeAround: nextMorning(Math.max(now, running.start + 4 * H)), bedtimeTarget: undefined }
    const i = Math.max(0, todayNaps.length - 1)
    const expected = running.start + napLen(i) * MIN
    const wakeAround = round5(Math.max(expected, now + 5 * MIN))
    return { ...base, status: 'napping', asleepSince: running.start, wakeAround, napExpectMin: napLen(i), later: plan(wakeAround, i + 1, false) }
  }

  if (!lastDone || now - lastDone.end! > 16 * H) return base
  const lastWake = lastDone.end!
  if (!lastDone.night) {
    // If a whole night has gone by since the last nap, the morning wake-up wasn't logged.
    const span = (nightEndMin - nightStartMin + 1440) % 1440
    const midNight = (nightStartMin + span / 2) % 1440
    let mid = atMinute(lastWake, midNight, tz)
    if (mid <= lastWake) mid = atMinute(addDaysTz(lastWake, 1, tz).getTime(), midNight, tz)
    if (mid <= now && !inWindow(minuteOfDay(now, tz), nightStartMin, nightEndMin)) return base
  }

  // Awake in the night (a night waking): the next sleep is back to bed, not a nap.
  const wokeAt = minuteOfDay(lastWake, tz)
  const wakeToday = ((wakeMin % 1440) + 1440) % 1440
  const morningish = wokeAt >= wakeToday - 90 && wokeAt < 12 * 60
  if (lastDone.night && !morningish && inWindow(minuteOfDay(now, tz), nightStartMin, nightEndMin)) {
    return { ...base, status: 'night', awakeSince: lastWake, wakeAround: nextMorning(now) }
  }

  const done = lastDone.night ? 0 : todayNaps.filter((s) => s.end !== null).length
  const shortLast = !lastDone.night && (lastWake - lastDone.start) / MIN < (ageDays < 122 ? 30 : 40)
  const items = plan(lastWake, done, shortLast)
  const bedtime = items[items.length - 1]
  return { ...base, status: 'ok', awakeSince: lastWake, next: items[0], later: items.slice(1), bedtimeTarget: bedtime.center, napsToday: done }
}

// ---------------------------------------------------------------------------- feeds
const FEED_TYPES = new Set(['nursing', 'bottle'])

export function feedForecast(events: LeelaEvent[], child: Child, fam: Fam, now: number, ageDays: number | null): FeedForecast | undefined {
  const since = now - 4 * DAY
  const starts: number[] = []
  for (const e of events) {
    if (e.deleted_at || !FEED_TYPES.has(e.type) || e.child_id !== child.id) continue
    if (e.timer_state) return undefined // feeding right now
    const t = Date.parse(e.started_at)
    if (t >= since && t <= now) starts.push(t)
  }
  starts.sort((a, b) => a - b)
  // Top-ups within half an hour are the same feed.
  const feeds: number[] = []
  for (const t of starts) if (!feeds.length || t - feeds[feeds.length - 1] > 30 * MIN) feeds.push(t)
  if (!feeds.length) return undefined
  const last = feeds[feeds.length - 1]
  if (now - last > 12 * H) return undefined
  const ns = toMin(fam.night_start)
  const ne = toMin(fam.night_end)
  const nightNow = inWindow(minuteOfDay(now, fam.timezone), ns, ne)
  const recent = now - 3 * DAY
  const gaps: { v: number; w: number; night: boolean }[] = []
  for (let k = 1; k < feeds.length; k++) {
    const gap = (feeds[k] - feeds[k - 1]) / MIN
    if (feeds[k] < recent || gap < 45 || gap > 10 * 60) continue
    gaps.push({ v: gap, w: recency(feeds[k], now), night: inWindow(minuteOfDay(feeds[k - 1], fam.timezone), ns, ne) })
  }
  const same = gaps.filter((g) => g.night === nightNow)
  const pool = same.length >= 3 ? same : gaps.length >= 3 ? gaps : []
  let every = weightedMedian(pool)
  let basis: FeedForecast['basis'] = 'logs'
  if (every === undefined) {
    if (ageDays === null || ageDays >= 365) return undefined
    every = ageDays < 30 ? 150 : ageDays < 91 ? 180 : ageDays < 183 ? 210 : 240
    basis = 'age'
  }
  return { at: round5(last + every * MIN), last, everyMin: Math.round(every), basis }
}
