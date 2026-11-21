// Sweet spot: when the baby is likely ready to sleep next, how long each sleep will last, how the
// next day or so may go, and when the next feed is really due.
//
// How it learns (no fixed "7 am to 7 pm" day):
// - Every gap between two logged sleeps is an example: when the baby woke (time of day), how long
//   the sleep before it was, and how long they then stayed awake. To predict, examples are weighed
//   by how close they are in time of day, how similar the sleep before was (a short nap means a
//   shorter time awake) and how recent they are (yesterday counts far more than last week, so a
//   change in routine is followed within two or three days). The weighted spread of those examples
//   gives the window: the middle half of what the baby actually did.
// - Sleep lengths are learned the same way from when a sleep starts: a 2 am sleep may last nine
//   hours, a 6 pm one forty minutes. While asleep, only examples that lasted at least as long as
//   this sleep so far count, so the wake-up estimate sharpens as the sleep goes on.
// - The baby's own night is found from their long sleeps, so a late-night baby isn't forced into
//   someone else's schedule. A bedtime set by the family pulls the night towards it.
// - Feeds know about sleep: if the baby rarely feeds during this kind of sleep, the next feed is
//   expected when they wake, not in the middle of it.
// - It checks itself: each new sleep in the last two weeks is predicted again from what was
//   known just before it, and how often the window was right is shown to the family.
// With little logged, everything leans on what's typical for the baby's age. Pure, with no
// libraries: the same file runs on phones and, bundled, on the server (reminders, Ghar).

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
  /** Typical longest stretch of night sleep, in hours. */
  nightHours: number
}

// Adapted from published guidance (wake-window and nap charts used by baby sleep apps).
export const AGE_GUIDE: AgeGuide[] = [
  { until: 28, label: 'newborns', wake: [30, 60], naps: [4, 6], defaultNaps: 5, napMin: 50, daySleep: [5, 8], nightHours: 3 },
  { until: 56, label: '1 month', wake: [45, 90], naps: [4, 6], defaultNaps: 5, napMin: 60, daySleep: [5, 7], nightHours: 4 },
  { until: 91, label: '2 months', wake: [60, 105], naps: [4, 5], defaultNaps: 4, napMin: 70, daySleep: [5, 6], nightHours: 5 },
  { until: 122, label: '3 months', wake: [60, 120], naps: [4, 5], defaultNaps: 4, napMin: 60, daySleep: [4, 5], nightHours: 6 },
  { until: 183, label: '4–5 months', wake: [90, 150], naps: [3, 4], defaultNaps: 3, napMin: 60, daySleep: [3, 4.5], nightHours: 7 },
  { until: 213, label: '6 months', wake: [120, 180], naps: [3, 3], defaultNaps: 3, napMin: 60, daySleep: [2.5, 3.5], nightHours: 8 },
  { until: 274, label: '7–8 months', wake: [150, 210], naps: [2, 3], defaultNaps: 3, napMin: 70, daySleep: [2, 3.5], nightHours: 9 },
  { until: 304, label: '9 months', wake: [150, 210], naps: [2, 2], defaultNaps: 2, napMin: 75, daySleep: [2, 3], nightHours: 10 },
  { until: 396, label: '10–12 months', wake: [180, 240], naps: [2, 2], defaultNaps: 2, napMin: 75, daySleep: [2, 3], nightHours: 10 },
  { until: 457, label: '13–14 months', wake: [180, 270], naps: [1, 2], defaultNaps: 2, napMin: 90, daySleep: [2, 3], nightHours: 10 },
  { until: 579, label: '15–18 months', wake: [240, 330], naps: [1, 2], defaultNaps: 1, napMin: 120, daySleep: [2, 3], nightHours: 10 },
  { until: 730, label: '19–24 months', wake: [300, 360], naps: [1, 1], defaultNaps: 1, napMin: 120, daySleep: [1.5, 2.5], nightHours: 10 },
  { until: 1096, label: '2 years', wake: [315, 390], naps: [1, 1], defaultNaps: 1, napMin: 100, daySleep: [1, 2], nightHours: 10 },
  { until: 1461, label: '3 years', wake: [360, 420], naps: [0, 1], defaultNaps: 1, napMin: 75, daySleep: [0, 1.5], nightHours: 10 },
  { until: Infinity, label: '4 years and up', wake: [360, 480], naps: [0, 1], defaultNaps: 0, napMin: 60, daySleep: [0, 1], nightHours: 10 },
]

/** Below this age (8 weeks) sleep is too irregular to forecast; the newborn guide is shown. */
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
  /** Naps a day (older setting, no longer used for predictions). */
  naps?: number
  /** Target bedtime, "HH:MM": the night is planned towards it. */
  bedtime?: string
  /** Minutes added to every time awake (negative for shorter). */
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
  /** 'bedtime' is the start of the baby's night (whenever that is for them). */
  kind: 'nap' | 'bedtime'
  /** The window, rounded to 5 minutes. */
  start: number
  end: number
  center: number
  /** Which nap since the night, from 1. */
  napNumber?: number
  /** Expected length of the sleep, in minutes. */
  lengthMin?: number
  /** A short nap to bridge the gap to bedtime. */
  short?: boolean
  /** Awake in the night: this is going back to sleep. */
  resettle?: boolean
  /** How sure: 'low' when this baby's times at this hour vary a lot (or little is logged). */
  confidence?: 'high' | 'medium' | 'low'
}

export interface FeedForecast {
  /** When the next feed is likely. */
  at: number
  /** Start of the last feed. */
  last: number
  /** Typical gap between feeds at this time of day, in minutes. */
  everyMin: number
  basis: 'logs' | 'age'
  /** Why it's then: the usual gap, as soon as the baby wakes, or just before a long sleep. */
  when?: 'gap' | 'on-waking' | 'before-sleep'
  /** Likely range. */
  range?: [number, number]
}

export interface Pattern {
  /** Days in the last two weeks with sleep logged. */
  days: number
  /** How much the baby's own pattern counts, 0 to 1. */
  weight: number
  /** The baby's own typical wake windows lately, in minutes: after the night, between naps, before the night. */
  first?: number
  middle?: number
  last?: number
  napMin?: number
  naps?: number
  /** Minutes after midnight (0–1439) when the baby's night usually starts and ends lately. */
  bedtimeMin?: number
  wakeMin?: number
  /** Typical night length lately, in minutes. */
  nightMin?: number
  daySleepMin?: number
  /** Sleeps learned from. */
  sleeps: number
}

export interface Accuracy {
  /** Sleeps in the last two weeks predicted again from what was known just before. */
  checked: number
  /** How many started inside the window. */
  inWindow: number
  /** How many started within half an hour of the middle of the window. */
  within30: number
  /** Typical miss, in minutes. */
  missMin: number
  /** Typical miss of the wake-up time, in minutes (from 15 minutes into each sleep). */
  wakeMissMin?: number
}

export type SweetSpotStatus =
  | 'ok' // awake: `next` is the next sleep
  | 'napping' // asleep for a nap: `wakeAround`, then `later`
  | 'night' // asleep for the night: `wakeAround` is when the night likely ends
  | 'newborn' // under 8 weeks: `next` comes from the newborn wake window
  | 'needs-sleep' // nothing recent to predict from
  | 'needs-birthday'

export interface SweetSpot {
  status: SweetSpotStatus
  next?: SleepWindow
  later: SleepWindow[]
  wakeAround?: number
  /** Likely range of the wake-up while asleep. */
  wakeRange?: [number, number]
  awakeSince?: number
  asleepSince?: number
  /** While asleep: how long this sleep is expected to last, in minutes. */
  napExpectMin?: number
  /** Naps since the night, and the sleep they add up to. */
  napsToday: number
  daySleepMs: number
  napsPlanned: number
  /** Typical wake windows lately, minutes: after the night, between naps, before the night. */
  windows: { first: number; middle: number; last: number }
  bedtimeTarget?: number
  ageDays: number | null
  guide: AgeGuide
  pattern: Pattern
  basis: 'age' | 'logs' | 'custom'
  settings: SweetSpotSettings
  feed?: FeedForecast
  accuracy?: Accuracy
}

export function phase(w: Pick<SleepWindow, 'start' | 'end'>, now: number): 'soon' | 'now' | 'late' {
  if (now < w.start) return 'soon'
  if (now <= w.end) return 'now'
  return 'late'
}

// ---------------------------------------------------------------------------- time of day
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const round5 = (t: number) => Math.round(t / (5 * MIN)) * 5 * MIN
const mod1440 = (m: number) => ((m % 1440) + 1440) % 1440
/** Signed difference a − b on the clock face, in −720…720 minutes. */
const circ = (a: number, b: number) => {
  const d = mod1440(a - b)
  return d > 720 ? d - 1440 : d
}

const formats = new Map<string, Intl.DateTimeFormat>()
function offsetMin(t: number, tz: string): number {
  let f = formats.get(tz)
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
    } catch {
      f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
    }
    formats.set(tz, f)
  }
  const p: Record<string, number> = {}
  for (const x of f.formatToParts(t)) if (x.type !== 'literal') p[x.type] = Number(x.value)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute)
  return Math.round((asUtc - Math.floor(t / MIN) * MIN) / MIN)
}
/** Minutes after local midnight. */
function tod(t: number, tz: string): number {
  return mod1440(Math.floor(t / MIN) + offsetMin(t, tz))
}
/** The next moment at or after `t` when the local clock shows `minute`. */
function nextAt(t: number, minute: number, tz: string): number {
  const ahead = mod1440(minute - tod(t, tz))
  return Math.floor(t / MIN) * MIN + ahead * MIN
}

// ---------------------------------------------------------------------------- weighted statistics
interface W {
  v: number
  w: number
}
function quantile(xs: W[], q: number): number | undefined {
  const s = xs.filter((x) => x.w > 0).sort((a, b) => a.v - b.v)
  if (!s.length) return undefined
  const total = s.reduce((n, x) => n + x.w, 0)
  let acc = 0
  for (let i = 0; i < s.length; i++) {
    const next = acc + s[i].w
    if (next >= total * q) {
      // Interpolate within this example's share for a smoother answer.
      if (i === 0) return s[0].v
      const f = (total * q - acc) / s[i].w
      return s[i - 1].v + (s[i].v - s[i - 1].v) * clamp(f, 0, 1)
    }
    acc = next
  }
  return s[s.length - 1].v
}
/** How many examples the weights are worth. */
const effective = (xs: W[]) => {
  const a = xs.reduce((n, x) => n + x.w, 0)
  const b = xs.reduce((n, x) => n + x.w * x.w, 0)
  return b > 0 ? (a * a) / b : 0
}
const gauss = (d: number, sigma: number) => Math.exp(-0.5 * (d / sigma) ** 2)
const halfLife = (age: number, half: number) => Math.pow(0.5, Math.max(0, age) / half)
/** Median of clock times that may straddle midnight. */
function clockMedian(xs: W[]): number | undefined {
  if (!xs.length) return undefined
  // Centre on the weighted circular mean, then take the median of the offsets.
  let sx = 0
  let sy = 0
  for (const x of xs) {
    const a = (x.v / 1440) * 2 * Math.PI
    sx += Math.cos(a) * x.w
    sy += Math.sin(a) * x.w
  }
  const mean = mod1440((Math.atan2(sy, sx) / (2 * Math.PI)) * 1440)
  const m = quantile(
    xs.map((x) => ({ v: circ(x.v, mean), w: x.w })),
    0.5,
  )
  return m === undefined ? undefined : mod1440(mean + m)
}

// ---------------------------------------------------------------------------- the baby's sleeps
interface Sleep {
  start: number
  end: number | null
}
interface Gap {
  /** When the baby woke. */
  at: number
  tod: number
  /** Length of the sleep before, minutes. */
  prev: number
  /** Minutes awake. */
  v: number
  afterNight: boolean
  beforeNight: boolean
}
interface Stretch {
  at: number
  tod: number
  /** Minutes asleep. */
  v: number
  night: boolean
}

const LOOKBACK = 28 * DAY

function sleepsOf(events: LeelaEvent[], childId: string, now: number): Sleep[] {
  const since = now - LOOKBACK
  const list: Sleep[] = []
  for (const e of events) {
    if (e.deleted_at || e.type !== 'sleep' || e.child_id !== childId) continue
    const start = Date.parse(e.started_at)
    if (start < since || start > now) continue
    const end = e.ended_at ? Date.parse(e.ended_at) : e.timer_state ? null : start
    if (end !== null && end <= start) continue
    list.push({ start, end: end === null ? null : Math.min(end, now) })
  }
  list.sort((a, b) => a.start - b.start)
  // A sleep that resumes within 20 minutes (a quick resettle) is one sleep.
  const merged: Sleep[] = []
  for (const s of list) {
    const prev = merged[merged.length - 1]
    if (prev && (prev.end === null || s.start - prev.end < 20 * MIN)) {
      if (prev.end !== null) prev.end = s.end === null ? null : Math.max(prev.end, s.end)
    } else merged.push({ ...s })
  }
  return merged
}

interface Night {
  /** Usual start and end on the clock, minutes after midnight. */
  onset: number
  wake: number
  /** Typical length, minutes. */
  length: number
  /** From the baby's own long sleeps (true) or the family's night hours (false). */
  learned: boolean
}

/** The baby's own night lately: when their long sleeps start and end, recent nights counting most. */
function findNight(sleeps: Sleep[], cutoff: number, fam: Fam, guide: AgeGuide, bedtime?: string): Night {
  const tz = fam.timezone
  const longMin = Math.min(240, guide.nightHours * 60 * 0.6)
  const onsets: W[] = []
  const wakes: W[] = []
  const lengths: W[] = []
  for (const s of sleeps) {
    if (s.end === null || s.end > cutoff || s.start < cutoff - 12 * DAY) continue
    const len = (s.end - s.start) / MIN
    if (len < longMin) continue
    const w = halfLife((cutoff - s.end) / DAY, 2)
    onsets.push({ v: tod(s.start, tz), w })
    wakes.push({ v: tod(s.end, tz), w })
    lengths.push({ v: len, w })
  }
  const learned = onsets.length >= 2
  let onset = learned ? clockMedian(onsets)! : toMin(fam.night_start)
  const wake = learned ? clockMedian(wakes)! : toMin(fam.night_end)
  const length = learned ? quantile(lengths, 0.5)! : mod1440(wake - onset) || guide.nightHours * 60
  if (bedtime) onset = toMin(bedtime)
  return { onset, wake, length, learned }
}

/** Whether a sleep starting at `start` and lasting `len` minutes is the baby's night. */
function isNightSleep(start: number, len: number, night: Night, tz: string, guide: AgeGuide): boolean {
  if (len >= Math.max(240, guide.nightHours * 60 * 0.6)) return true
  return Math.abs(circ(tod(start, tz), night.onset)) <= 120 && len >= 150
}

function history(sleeps: Sleep[], night: Night, tz: string, guide: AgeGuide): { gaps: Gap[]; stretches: Stretch[] } {
  const gaps: Gap[] = []
  const stretches: Stretch[] = []
  const nightOf = sleeps.map((s) => (s.end === null ? false : isNightSleep(s.start, (s.end - s.start) / MIN, night, tz, guide)))
  for (let k = 0; k < sleeps.length; k++) {
    const s = sleeps[k]
    if (s.end === null) continue
    const len = (s.end - s.start) / MIN
    if (len >= 8) stretches.push({ at: s.start, tod: tod(s.start, tz), v: len, night: nightOf[k] })
    const n = sleeps[k + 1]
    if (!n) continue
    const v = (n.start - s.end) / MIN
    // Much longer awake than the age allows almost always means a sleep wasn't logged.
    if (v < 8 || v > Math.max(8 * 60, guide.wake[1] * 2)) continue
    gaps.push({ at: s.end, tod: tod(s.end, tz), prev: len, v, afterNight: nightOf[k], beforeNight: n.end === null ? false : nightOf[k + 1] })
  }
  return { gaps, stretches }
}

// ---------------------------------------------------------------------------- the two models
interface Dist {
  lo: number
  mid: number
  hi: number
  /** How many examples it's worth. */
  n: number
}

// Tuned on a real baby's six weeks of logs (each sleep predicted from only what came before it).
const TOD_SIGMA = 70 // minutes: examples an hour away in the day still count well
const RECENT_HALF = 7 // days: last week counts twice as much as the week before
/** How much an example's clock time counts as well as its length (babies drift to the same times). */
const CLOCK_PULL = 0.5
/** How far a predicted bedtime moves towards when recent nights began. */
const BEDTIME_PULL = 0.3

/**
 * Minutes awake before the next sleep, for a wake-up at `woke` after a sleep of `prev` minutes,
 * given `elapsed` minutes already awake. Learned from gaps before `cutoff`.
 */
function awakeModel(gaps: Gap[], woke: number, prev: number, elapsed: number, cutoff: number, tz: string, guide: AgeGuide): Dist {
  const t = tod(woke, tz)
  const xs: W[] = []
  for (const g of gaps) {
    if (g.at + g.v * MIN > cutoff) continue
    if (g.v <= elapsed) continue
    const w = gauss(circ(g.tod, t), TOD_SIGMA) * gauss(Math.log(Math.max(5, g.prev) / Math.max(5, prev)), 1.2) * halfLife((cutoff - g.at) / DAY, RECENT_HALF)
    // Half by how long they stayed awake, half by the clock time they fell asleep.
    if (w > 0.002) xs.push({ v: Math.max(elapsed + 1, g.v + CLOCK_PULL * circ(g.tod, t)), w })
  }
  const n = effective(xs)
  // What's typical for the age, as a fallback and a gentle pull while examples are few.
  const [alo, ahi] = guide.wake
  const prior = { lo: Math.max(alo, elapsed + 5), mid: Math.max((alo + ahi) / 2, elapsed + 15), hi: Math.max(ahi, elapsed + 30) }
  if (n < 0.5) return { ...prior, n }
  const k = 0.5
  const mix = (d: number, p: number) => (n * d + k * p) / (n + k)
  return { lo: mix(quantile(xs, 0.25)!, prior.lo), mid: mix(quantile(xs, 0.5)!, prior.mid), hi: mix(quantile(xs, 0.75)!, prior.hi), n }
}

/** Minutes a sleep starting at `start` will last, given `elapsed` minutes asleep so far. */
function sleepModel(stretches: Stretch[], start: number, elapsed: number, cutoff: number, tz: string, guide: AgeGuide, night: Night): Dist {
  const t = tod(start, tz)
  const xs: W[] = []
  for (const s of stretches) {
    if (s.at + s.v * MIN > cutoff) continue
    if (s.v <= elapsed) continue
    const w = gauss(circ(s.tod, t), 60) * halfLife((cutoff - s.at) / DAY, 2.5)
    if (w > 0.002) xs.push({ v: s.v, w })
  }
  const n = effective(xs)
  const nightish = Math.abs(circ(t, night.onset)) <= 90
  const base = nightish ? night.length : guide.napMin
  const prior = { lo: Math.max(base * 0.7, elapsed + 5), mid: Math.max(base, elapsed + 15), hi: Math.max(base * 1.3, elapsed + 30) }
  if (n < 0.5) return { ...prior, n }
  const k = 1
  const mix = (d: number, p: number) => (n * d + k * p) / (n + k)
  return { lo: mix(quantile(xs, 0.25)!, prior.lo), mid: mix(quantile(xs, 0.5)!, prior.mid), hi: mix(quantile(xs, 0.75)!, prior.hi), n }
}

/**
 * How long this night will last (given `elapsed` minutes asleep so far): mostly from the clock time
 * the baby usually wakes, partly from how long recent nights lasted. Babies tend to wake at much the
 * same time even when bedtime moves, so a night that starts earlier is a longer one.
 */
function nightModel(stretches: Stretch[], start: number, elapsed: number, cutoff: number, night: Night, tz: string): Dist {
  const byLength = nightLengths(stretches, elapsed, cutoff, night)
  if (!night.learned) return byLength
  const toWake = (nextAt(start + 3 * H, night.wake, tz) - start) / MIN
  if (toWake <= elapsed) return byLength
  const blend = (v: number) => 0.3 * v + 0.7 * toWake
  return { lo: Math.max(elapsed + 5, blend(byLength.lo) - 20), mid: Math.max(elapsed + 10, blend(byLength.mid)), hi: Math.max(elapsed + 20, blend(byLength.hi) + 20), n: byLength.n }
}

function nightLengths(stretches: Stretch[], elapsed: number, cutoff: number, night: Night): Dist {
  const xs: W[] = []
  for (const s of stretches) {
    if (!s.night || s.at + s.v * MIN > cutoff || s.v <= elapsed) continue
    xs.push({ v: s.v, w: halfLife((cutoff - s.at) / DAY, 2) })
  }
  const n = effective(xs)
  const prior = { lo: Math.max(night.length * 0.8, elapsed + 10), mid: Math.max(night.length, elapsed + 30), hi: Math.max(night.length * 1.15, elapsed + 60) }
  if (n < 0.5) return { ...prior, n }
  const mix = (d: number, p: number) => (n * d + 0.5 * p) / (n + 0.5)
  return { lo: mix(quantile(xs, 0.25)!, prior.lo), mid: mix(quantile(xs, 0.5)!, prior.mid), hi: mix(quantile(xs, 0.75)!, prior.hi), n }
}

// ---------------------------------------------------------------------------- the forecast
interface Ctx {
  tz: string
  guide: AgeGuide
  night: Night
  gaps: Gap[]
  stretches: Stretch[]
  settings: SweetSpotSettings
  cutoff: number
  /** When the last night ended, if known. */
  lastNightEnd: number | null
}

/**
 * Whether a sleep starting at `start` is the night beginning: as long after the last night ended
 * as the baby's days usually run. This follows a bedtime that's moving, which the time of day
 * alone can't.
 */
function nightDue(c: Ctx, start: number): boolean {
  if (c.lastNightEnd === null) return false
  const dayMin = c.night.learned ? mod1440(c.night.onset - c.night.wake) || 14 * 60 : 24 * 60 - c.guide.nightHours * 60 - 60
  // A bedtime moved earlier makes the day shorter, so there's room for a couple of hours' change,
  // as long as it's still within three hours of the usual bedtime.
  if (Math.abs(circ(tod(start, c.tz), c.night.onset)) > 180) return false
  return (start - c.lastNightEnd) / MIN >= Math.max(8 * 60, dayMin - 150)
}

/** The window for the next sleep after waking at `woke` (from a sleep of `prev` minutes). */
function nextWindow(c: Ctx, woke: number, prev: number, elapsed: number, afterNight: boolean): { start: number; end: number; center: number; n: number; spread: number } {
  const adj = c.settings.adjust ?? 0
  if (c.settings.custom) {
    const m = (afterNight ? c.settings.custom.first : c.settings.custom.middle) + adj
    const half = clamp(m * 0.1, 10, 20)
    return { start: woke + (m - half) * MIN, end: woke + (m + half) * MIN, center: woke + m * MIN, n: 99, spread: 2 * half }
  }
  const d = awakeModel(c.gaps, woke, prev, elapsed, c.cutoff, c.tz, c.guide)
  // A window narrow enough to plan with, wide enough to be honest.
  let lo = d.lo + adj
  let hi = d.hi + adj
  const mid = d.mid + adj
  const spread = hi - lo
  if (hi - lo < 20) {
    lo = mid - 10
    hi = mid + 10
  }
  if (hi - lo > 90) {
    lo = Math.max(lo, mid - 45)
    hi = Math.min(hi, mid + 45)
  }
  return { start: woke + lo * MIN, end: woke + hi * MIN, center: woke + mid * MIN, n: d.n, spread }
}

/**
 * The coming sleeps from a wake-up at `woke`, until the night begins (inclusive), using the most
 * likely value at each step.
 */
function plan(c: Ctx, woke: number, prev: number, elapsed: number, afterNight: boolean, napsDone: number, resettle: boolean): SleepWindow[] {
  const items: SleepWindow[] = []
  let t = woke
  let p = prev
  let after = afterNight
  let napNo = napsDone
  const target = c.settings.bedtime ? toMin(c.settings.bedtime) : null
  for (let step = 0; step < 8 && t < woke + 30 * H; step++) {
    const w = nextWindow(c, t, p, step === 0 ? elapsed : 0, after)
    let len = sleepModel(c.stretches, w.center, 0, c.cutoff, c.tz, c.guide, c.night).mid
    let night = isNightSleep(w.center, len, c.night, c.tz, c.guide)
    if (step === 0 && resettle) {
      // Back to sleep in the night: it lasts until the usual morning wake-up.
      night = true
      len = Math.max(30, (nextAt(w.center + 30 * MIN, c.night.wake, c.tz) - w.center) / MIN)
    } else {
      if (!night && !resettle && nightDue(c, w.center)) night = true
      if (night) len = Math.max(len, nightModel(c.stretches, w.center, 0, c.cutoff, c.night, c.tz).mid)
    }
    let { start, end, center } = w
    if (night && !resettle && target === null && c.night.learned) {
      // Bedtime leans on when recent nights began, which follows a moved bedtime within a couple of
      // days, where the time-awake examples take a week or more.
      const onsetAt = nextAt(center - 12 * H, c.night.onset, c.tz)
      const shift = onsetAt - center
      if (Math.abs(shift) <= 4 * H) {
        const move = Math.max(BEDTIME_PULL * shift, t + 20 * MIN - center)
        center += move
        start += move
        end += move
      }
    }
    if (target !== null && !resettle) {
      // A bedtime set by the family: the night starts then, and no nap runs too close to it.
      const bed = nextAt(t, target, c.tz)
      const lastWin = c.settings.custom?.last ?? (c.guide.wake[0] + c.guide.wake[1]) / 2
      const napEnd = center + len * MIN
      if (!night && (center >= bed - 45 * MIN || napEnd + lastWin * 0.6 * MIN > bed)) {
        if (bed - t <= lastWin * 1.6 * MIN || center >= bed - 45 * MIN) {
          center = Math.max(bed, t + 20 * MIN)
          start = center - 15 * MIN
          end = center + 15 * MIN
          night = true
          len = sleepModel(c.stretches, center, 0, c.cutoff, c.tz, c.guide, c.night).mid
          len = Math.max(len, c.night.length * 0.8)
        } else {
          // A short nap bridges the long stretch to bedtime.
          len = Math.min(len, 35)
        }
      }
    }
    const item: SleepWindow = {
      kind: night ? 'bedtime' : 'nap',
      start: round5(start),
      end: round5(end),
      center: round5(center),
      lengthMin: Math.round(len),
    }
    if (!night) item.napNumber = ++napNo
    if (!night && len <= 35 && target !== null) item.short = true
    if (step === 0 && resettle) item.resettle = true
    if (step === 0) item.confidence = w.n < 2 ? 'low' : w.spread > 120 ? 'low' : w.spread > 70 ? 'medium' : 'high'
    items.push(item)
    if (night) break
    t = center + len * MIN
    p = len
    after = false
  }
  return items
}

/** How well the model has done lately: every sleep of the last two weeks, predicted again from what was known just before. */
function selfCheck(c: Ctx, now: number): Accuracy | undefined {
  let checked = 0
  let inWindow = 0
  let within30 = 0
  const misses: number[] = []
  for (const g of c.gaps) {
    if (g.at < now - 14 * DAY) continue
    const onset = g.at + g.v * MIN
    if (onset > now) continue
    const cc = { ...c, cutoff: g.at + 5 * MIN }
    const w = nextWindow(cc, g.at, g.prev, 0, g.afterNight)
    checked++
    if (onset >= round5(w.start) && onset <= round5(w.end)) inWindow++
    const miss = Math.abs(onset - w.center) / MIN
    if (miss <= 30) within30++
    misses.push(miss)
  }
  if (checked < 5) return undefined
  const wakeMisses: number[] = []
  for (const s of c.stretches) {
    if (s.at < now - 14 * DAY || s.v < 25) continue
    const end = s.at + s.v * MIN
    if (end > now) continue
    const d = sleepModel(c.stretches, s.at, 15, s.at + 15 * MIN, c.tz, c.guide, c.night)
    wakeMisses.push(Math.abs(s.v - d.mid))
  }
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
  return {
    checked,
    inWindow,
    within30,
    missMin: Math.round(med(misses)),
    wakeMissMin: wakeMisses.length >= 5 ? Math.round(med(wakeMisses)) : undefined,
  }
}

function patternOf(c: Ctx, sleeps: Sleep[], now: number): Pattern {
  const week = now - 7 * DAY
  const days = new Set<number>()
  for (const s of sleeps) if (s.start >= now - 14 * DAY) days.add(Math.floor((s.start + offsetMin(s.start, c.tz) * MIN) / DAY))
  const rec = (at: number) => halfLife((now - at) / DAY, RECENT_HALF)
  const pick = (f: (g: Gap) => boolean) => c.gaps.filter((g) => g.at >= week && f(g)).map((g) => ({ v: g.v, w: rec(g.at) }))
  const first = pick((g) => g.afterNight)
  const last = pick((g) => g.beforeNight && !g.afterNight)
  const middle = pick((g) => !g.afterNight && !g.beforeNight)
  const naps = c.stretches.filter((s) => s.at >= week && !s.night)
  const nights = c.stretches.filter((s) => s.at >= week && s.night).length
  const napsPerDay = nights ? naps.length / Math.max(1, nights) : undefined
  const q = (xs: W[], min = 2) => (xs.length >= min ? Math.round(quantile(xs, 0.5)!) : undefined)
  const nm = q(naps.map((s) => ({ v: s.v, w: rec(s.at) })), 3)
  return {
    days: days.size,
    weight: clamp(days.size / 7, 0, 1),
    first: q(first),
    middle: q(middle, 3),
    last: q(last),
    napMin: nm,
    naps: napsPerDay !== undefined ? Math.round(napsPerDay) : undefined,
    bedtimeMin: c.night.learned ? Math.round(c.night.onset) : undefined,
    wakeMin: c.night.learned ? Math.round(c.night.wake) : undefined,
    nightMin: c.night.learned ? Math.round(c.night.length) : undefined,
    daySleepMin: napsPerDay !== undefined && nm !== undefined ? Math.round(naps.reduce((t, s) => t + s.v, 0) / Math.max(1, nights)) : undefined,
    sleeps: c.stretches.length,
  }
}

export function sweetSpot(events: LeelaEvent[], child: Child, fam: Fam, now: number): SweetSpot {
  const tz = fam.timezone
  const settings = readSettings(child.settings)
  const ageDays = ageInDays(child, now)
  const guide = guideFor(Math.max(0, ageDays ?? 400))
  const sleeps = sleepsOf(events, child.id, now)
  const night = findNight(sleeps, now, fam, guide, settings.bedtime)
  const { gaps, stretches } = history(sleeps, night, tz, guide)
  const c: Ctx = { tz, guide, night, gaps, stretches, settings, cutoff: now, lastNightEnd: null }

  const running = sleeps.length && sleeps[sleeps.length - 1].end === null ? sleeps[sleeps.length - 1] : undefined
  const done = sleeps.filter((s) => s.end !== null)
  const lastDone = done[done.length - 1]
  // Naps since the last night.
  let lastNightIdx = -1
  for (let k = done.length - 1; k >= 0; k--) {
    if (isNightSleep(done[k].start, (done[k].end! - done[k].start) / MIN, night, tz, guide)) {
      lastNightIdx = k
      break
    }
  }
  const napsSince = lastNightIdx >= 0 ? done.slice(lastNightIdx + 1) : done.filter((s) => s.start > now - 14 * H)
  c.lastNightEnd = lastNightIdx >= 0 ? done[lastNightIdx].end : null
  const daySleepMs = napsSince.reduce((t, s) => t + (s.end! - s.start), 0) + (running && !isNightSleep(running.start, (now - running.start) / MIN, night, tz, guide) ? now - running.start : 0)

  const pattern = patternOf(c, sleeps, now)
  const own = pattern.days >= 3 && stretches.length >= 8
  const basis: SweetSpot['basis'] = settings.custom ? 'custom' : own ? 'logs' : 'age'
  const avgWake = Math.round((guide.wake[0] + guide.wake[1]) / 2)
  const windows = settings.custom
    ? { ...settings.custom }
    : { first: pattern.first ?? guide.wake[0], middle: pattern.middle ?? avgWake, last: pattern.last ?? guide.wake[1] }

  const base: SweetSpot = {
    status: 'needs-sleep',
    later: [],
    napsToday: napsSince.length,
    daySleepMs,
    napsPlanned: pattern.naps ?? guide.defaultNaps,
    windows,
    ageDays,
    guide,
    pattern,
    basis,
    settings,
    accuracy: own ? selfCheck(c, now) : undefined,
  }
  if (ageDays === null) return { ...base, status: 'needs-birthday' }

  // Newborns: sleep comes round again a short wake window after waking.
  if (ageDays < NEWBORN_DAYS) {
    const feed = feedForecast(events, child, fam, now, ageDays)
    if (running) return { ...base, feed, status: 'newborn', asleepSince: running.start }
    if (!lastDone || now - lastDone.end! > 12 * H) return { ...base, feed }
    const start = round5(lastDone.end! + guide.wake[0] * MIN)
    const end = round5(lastDone.end! + guide.wake[1] * MIN)
    return { ...base, feed, status: 'newborn', awakeSince: lastDone.end!, next: { kind: 'nap', start, end, center: (start + end) / 2 } }
  }

  if (running) {
    const elapsed = (now - running.start) / MIN
    const whole = sleepModel(stretches, running.start, 0, now, tz, guide, night)
    const isNight =
      elapsed >= 240 ||
      (elapsed >= 150 && Math.abs(circ(tod(running.start, tz), night.onset)) <= 240) ||
      isNightSleep(running.start, whole.mid, night, tz, guide) ||
      nightDue(c, running.start)
    const d = isNight ? nightModel(stretches, running.start, elapsed, now, night, tz) : sleepModel(stretches, running.start, elapsed, now, tz, guide, night)
    const wakeAround = round5(Math.max(running.start + d.mid * MIN, now + 5 * MIN))
    const wakeRange: [number, number] = [round5(Math.max(running.start + d.lo * MIN, now)), round5(Math.max(running.start + d.hi * MIN, now + 10 * MIN))]
    const later = plan(c, wakeAround, Math.max(elapsed, d.mid), 0, isNight, isNight ? 0 : napsSince.length, false)
    const spot: SweetSpot = {
      ...base,
      status: isNight ? 'night' : 'napping',
      asleepSince: running.start,
      wakeAround,
      wakeRange,
      napExpectMin: Math.round(d.mid),
      later: isNight ? later.slice(0, 1) : later,
      napsToday: isNight ? 0 : napsSince.length,
    }
    spot.feed = feedForecast(events, child, fam, now, ageDays, { asleepFrom: running.start, wakeAround, nightSleep: isNight, sleeps, night })
    return spot
  }

  if (!lastDone || now - lastDone.end! > 16 * H) return { ...base, feed: feedForecast(events, child, fam, now, ageDays, { sleeps, night }) }
  const woke = lastDone.end!
  const prevLen = (woke - lastDone.start) / MIN
  const afterNight = lastNightIdx === done.length - 1
  // Awake well before the night's usual end: a night waking, so the next sleep is back to bed.
  const intoNight = mod1440(tod(woke, tz) - night.onset)
  const resettle = afterNight && night.learned && intoNight < night.length - 120 && prevLen < night.length * 0.6
  const items = plan(c, woke, prevLen, (now - woke) / MIN, afterNight && !resettle, afterNight ? 0 : napsSince.length, resettle)
  const bedtime = items.find((w) => w.kind === 'bedtime')
  const spot: SweetSpot = {
    ...base,
    status: 'ok',
    awakeSince: woke,
    next: items[0],
    later: items.slice(1),
    bedtimeTarget: bedtime?.center,
    napsToday: afterNight ? 0 : napsSince.length,
  }
  spot.feed = feedForecast(events, child, fam, now, ageDays, { nextSleep: items[0], sleeps, night })
  return spot
}

// ---------------------------------------------------------------------------- feeds
const FEED_TYPES = new Set(['nursing', 'bottle'])

interface FeedContext {
  sleeps?: Sleep[]
  night?: Night
  /** Asleep now since this moment, likely waking then. */
  asleepFrom?: number
  wakeAround?: number
  nightSleep?: boolean
  /** Awake now: the coming sleep. */
  nextSleep?: SleepWindow
}

/**
 * The next feed. Gaps between feeds are learned by time of day (evening cluster feeds are close
 * together); gaps that span a long sleep aren't hunger gaps and are left out. If the baby usually
 * sleeps through this kind of sleep without a feed, the feed is expected when they wake.
 */
export function feedForecast(events: LeelaEvent[], child: Child, fam: Fam, now: number, ageDays: number | null, ctx: FeedContext = {}): FeedForecast | undefined {
  const tz = fam.timezone
  const since = now - 21 * DAY
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
  if (now - last > 14 * H) return undefined

  const long = (ctx.sleeps ?? []).filter((s) => s.end !== null && s.end - s.start >= 120 * MIN)
  const spansLongSleep = (a: number, b: number) => long.some((s) => s.start >= a - 10 * MIN && s.end! <= b + 10 * MIN)
  const gaps: W[] = []
  const t0 = tod(last, tz)
  for (let k = 1; k < feeds.length; k++) {
    const gap = (feeds[k] - feeds[k - 1]) / MIN
    if (gap < 35 || gap > 8 * 60 || spansLongSleep(feeds[k - 1], feeds[k])) continue
    gaps.push({ v: gap, w: gauss(circ(tod(feeds[k - 1], tz), t0), 90) * halfLife((now - feeds[k]) / DAY, RECENT_HALF) })
  }
  let every = effective(gaps) >= 2 ? quantile(gaps, 0.5) : undefined
  let lo = effective(gaps) >= 2 ? quantile(gaps, 0.3) : undefined
  let hi = effective(gaps) >= 2 ? quantile(gaps, 0.7) : undefined
  let basis: FeedForecast['basis'] = 'logs'
  if (every === undefined) {
    if (ageDays === null || ageDays >= 365) return undefined
    every = ageDays < 30 ? 150 : ageDays < 91 ? 180 : ageDays < 183 ? 210 : 240
    lo = every * 0.8
    hi = every * 1.2
    basis = 'age'
  }
  const out = (at: number, when: FeedForecast['when'], range?: [number, number]): FeedForecast => ({ at: round5(at), last, everyMin: Math.round(every!), basis, when, ...(range ? { range: [round5(range[0]), round5(range[1])] } : {}) })
  const byGap = out(last + every * MIN, 'gap', [last + lo! * MIN, last + hi! * MIN])

  // How this baby feeds around long sleeps, learned from the logs.
  const hist = long.filter((s) => s.end! < now)
  const fedDuring = (s: Sleep) => feeds.some((f) => f > s.start + 20 * MIN && f < s.end! - 15 * MIN)
  const similar = (startAt: number, minLen: number) =>
    hist.filter((s) => s.end! - s.start >= minLen * MIN && Math.abs(circ(tod(s.start, tz), tod(startAt, tz))) <= 120 && s.start >= now - 14 * DAY)
  const wakeDelay = (() => {
    const xs: W[] = []
    for (const s of hist) {
      const f = feeds.find((x) => x >= s.end! - 10 * MIN && x <= s.end! + 120 * MIN)
      if (f !== undefined) xs.push({ v: Math.max(0, (f - s.end!) / MIN), w: halfLife((now - s.end!) / DAY, RECENT_HALF) })
    }
    return xs.length >= 2 ? quantile(xs, 0.5)! : 15
  })()

  if (ctx.asleepFrom !== undefined && ctx.wakeAround !== undefined) {
    const like = similar(ctx.asleepFrom, Math.min(180, Math.max(120, (now - ctx.asleepFrom) / MIN)))
    const rate = like.length >= 2 ? like.filter(fedDuring).length / like.length : ctx.nightSleep ? 0.3 : 0.2
    const onWaking = ctx.wakeAround + wakeDelay * MIN
    // Usually sleeps through: the feed comes when they wake.
    if (rate < 0.4 || byGap.at >= ctx.wakeAround - 20 * MIN) return out(Math.max(onWaking, now), 'on-waking')
    return byGap.at < now ? out(now, 'gap') : byGap
  }

  const s = ctx.nextSleep
  if (s && s.lengthMin && s.lengthMin >= 120 && byGap.at > s.center - 10 * MIN) {
    // The usual gap runs into a long sleep the baby usually sleeps through.
    const like = similar(s.center, 120)
    const rate = like.length >= 2 ? like.filter(fedDuring).length / like.length : 0.3
    if (rate < 0.4) {
      const before = like.filter((x) => feeds.some((f) => f >= x.start - 60 * MIN && f <= x.start + 10 * MIN)).length
      const fedRecently = now - last < 60 * MIN
      if (like.length >= 2 && before / like.length >= 0.5 && !fedRecently) return out(Math.max(s.center - 20 * MIN, now), 'before-sleep')
      return out(s.center + s.lengthMin * MIN + wakeDelay * MIN, 'on-waking')
    }
  }
  return byGap
}
