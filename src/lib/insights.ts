// What History shows about each kind of entry over a period: day-by-day figures, the headline on
// the overview, the numbers on each detail screen and the chart values per bucket. Built on the
// same counting as Today (totalsFor), so the screens never disagree.
//
// Imported logs often have no length (a bath noted at 10:40), so everything is counted in times
// first; minutes are only ever added up from entries that have a length, and say so.
import { ACTIVITY_KINDS, showsFor, type Tone } from './config'
import { eventEndMs, nursingSeconds, sleepKind, totalsFor, type Totals } from './counting'
import type { Bucket } from './period'
import { addDaysTz, dayLabel, durationText, fmtTime, minuteOfDay } from './time'
import type { EventType, Family, LeelaEvent, TimerSegment } from './types'

const MIN = 60_000
const H = 3_600_000
type Fam = Pick<Family, 'timezone' | 'night_start' | 'night_end'>

// ---------------------------------------------------------------------------- one day's figures
export interface ActAgg {
  n: number
  /** Entries with a length of a minute or more, and their minutes. */
  timed: number
  min: number
}

export interface DayAgg {
  day: number
  t: Totals
  breastN: number
  breastMin: number
  leftMin: number
  rightMin: number
  bottleN: number
  bottleMl: number
  /** Bottles of breast milk and of formula (mixed counts in both). */
  bottleBreast: number
  bottleFormula: number
  /** Longest stretch between feeds that started this day, minutes. */
  longestFeedGap: number
  solidsN: number
  foods: string[]
  newFoods: string[]
  pumpN: number
  wetOnly: number
  dirtyOnly: number
  mixed: number
  pottyWins: number
  pottyAccidents: number
  act: Record<string, ActAgg>
  vit: Record<string, number>
  med: Record<string, number>
  temps: number[]
  health: number
  growth: number
  milestones: number
  notes: number
  photos: number
  /** Night sleep that started this day: onset and end (for bedtime and wake-up). */
  nights: { start: number; end: number }[]
}

/** The activity kind an entry belongs to: its kind, or its own label, or 'other'. */
export function activityKey(e: Pick<LeelaEvent, 'data'>): string {
  const k = typeof e.data.kind === 'string' && e.data.kind ? e.data.kind : ''
  if (k) return k
  const l = typeof e.data.label === 'string' ? e.data.label.trim() : ''
  const known = ACTIVITY_KINDS.find((a) => a.label.toLowerCase() === l.toLowerCase())
  return known ? known.id : l ? `label:${l}` : 'other'
}

export const activityLabel = (key: string) => (key.startsWith('label:') ? key.slice(6) : ACTIVITY_KINDS.find((a) => a.id === key)?.label ?? (key === 'other' ? 'Other activities' : key))

const medName = (e: LeelaEvent) => String(e.data.name ?? '').trim() || 'Medicine'

/** A daily vitamin or supplement: given from the Vitamins list, or a medicine entry named like one. */
export function isSupplement(e: Pick<LeelaEvent, 'type' | 'data'>): boolean {
  if (e.type !== 'medicine') return false
  if (e.data.supplement) return true
  return /\b(vit(amin)?\b|vit\.? ?[a-e]\d?|d3|iron|ferr|multi-?vit|calcium|zinc|probiotic|dha|omega)/i.test(String(e.data.name ?? ''))
}

/** Entries that belong on this baby's screens, overlapping [from, to). */
export function visibleIn(events: LeelaEvent[], childId: string, userId: string | null, from: number, to: number, now: number): LeelaEvent[] {
  return events.filter((e) => {
    if (e.deleted_at || !showsFor(e, childId, userId)) return false
    const s = Date.parse(e.started_at)
    return s < to && Math.max(s, eventEndMs(e, now)) >= from
  })
}

export function dayAggs(events: LeelaEvent[], segments: TimerSegment[], childId: string, userId: string | null, family: Fam, days: number[], now: number): DayAgg[] {
  if (!days.length) return []
  const tz = family.timezone
  const end = addDaysTz(days[days.length - 1], 1, tz).getTime()
  const mine = visibleIn(events, childId, userId, days[0] - 26 * H, end, now)
  const feeds = mine.filter((e) => e.type === 'nursing' || e.type === 'bottle').map((e) => Date.parse(e.started_at)).sort((a, b) => a - b)
  return days.map((day) => {
    const next = addDaysTz(day, 1, tz).getTime()
    const d: DayAgg = {
      day,
      t: totalsFor(mine, segments, childId, day, next, family, now),
      breastN: 0,
      breastMin: 0,
      leftMin: 0,
      rightMin: 0,
      bottleN: 0,
      bottleMl: 0,
      bottleBreast: 0,
      bottleFormula: 0,
      longestFeedGap: 0,
      solidsN: 0,
      foods: [],
      newFoods: [],
      pumpN: 0,
      wetOnly: 0,
      dirtyOnly: 0,
      mixed: 0,
      pottyWins: 0,
      pottyAccidents: 0,
      act: {},
      vit: {},
      med: {},
      temps: [],
      health: 0,
      growth: 0,
      milestones: 0,
      notes: 0,
      photos: 0,
      nights: [],
    }
    for (const e of mine) {
      const s = Date.parse(e.started_at)
      if (s < day || s >= next) continue
      d.photos += e.photo_paths?.length ?? 0
      switch (e.type) {
        case 'sleep':
          if (e.ended_at && sleepKind(e, family) === 'night') d.nights.push({ start: s, end: Date.parse(e.ended_at) })
          break
        case 'nursing': {
          d.breastN++
          const ns = nursingSeconds(e, segments, now)
          const other = !e.timer_state && e.data.left_s === undefined && e.data.right_s === undefined && typeof e.data.total_s === 'number' ? e.data.total_s : 0
          d.leftMin += ns.left / 60
          d.rightMin += ns.right / 60
          d.breastMin += (ns.left + ns.right + other) / 60
          break
        }
        case 'bottle':
          d.bottleN++
          d.bottleMl += e.data.amount_ml ?? 0
          if (e.data.contents === 'breast' || e.data.contents === 'mixed') d.bottleBreast++
          if (e.data.contents === 'formula' || e.data.contents === 'mixed') d.bottleFormula++
          break
        case 'solids':
          d.solidsN++
          for (const f of e.data.foods ?? []) {
            d.foods.push(f.name)
            if (f.first) d.newFoods.push(f.name)
          }
          break
        case 'pump':
          d.pumpN++
          break
        case 'diaper':
          if (e.data.kind === 'mixed') d.mixed++
          else if (e.data.kind === 'dirty') d.dirtyOnly++
          else d.wetOnly++
          break
        case 'potty':
          if (e.data.outcome === 'accident') d.pottyAccidents++
          else d.pottyWins++
          break
        case 'activity': {
          const k = activityKey(e)
          const a = (d.act[k] ??= { n: 0, timed: 0, min: 0 })
          a.n++
          const m = (eventEndMs(e, now) - s) / MIN
          if (m >= 1) {
            a.timed++
            a.min += m
          }
          break
        }
        case 'medicine':
          if (isSupplement(e)) d.vit[medName(e)] = (d.vit[medName(e)] ?? 0) + 1
          else d.med[medName(e)] = (d.med[medName(e)] ?? 0) + 1
          break
        case 'temperature':
          if (typeof e.data.temp_c === 'number') d.temps.push(e.data.temp_c)
          break
        case 'symptom':
          d.health++
          break
        case 'growth':
          d.growth++
          break
        case 'milestone':
          d.milestones++
          break
        case 'note':
          d.notes++
          break
      }
    }
    // Longest gap between feeds starting this day (the gap after each feed of the day).
    for (let i = 0; i + 1 < feeds.length; i++) {
      if (feeds[i] < day || feeds[i] >= next) continue
      d.longestFeedGap = Math.max(d.longestFeedGap, (feeds[i + 1] - feeds[i]) / MIN)
    }
    return d
  })
}

// ---------------------------------------------------------------------------- categories
export type Group = 'rhythm' | 'care' | 'health' | 'moments'
export const GROUPS: { id: Group; label: string }[] = [
  { id: 'rhythm', label: 'Daily rhythm' },
  { id: 'care', label: 'Care and play' },
  { id: 'health', label: 'Health and growth' },
  { id: 'moments', label: 'Moments' },
]

export interface Stat {
  label: string
  value: string
}

export interface Series {
  key: string
  label: string
  color: string
  values: number[]
}

export interface Category {
  id: string
  label: string
  tone: Tone
  icon: { type: EventType; kind?: string }
  group: Group
  /** Which entries are this category's. */
  match: (e: LeelaEvent) => boolean
  /** Logged at all on this day. */
  has: (d: DayAgg) => boolean
  /** Per-day average over logged days (sleep, feeds) rather than a count (baths). */
  rate: boolean
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
/** Days from the first one where `has` is true to the end: vitamins started partway through count from then. */
const fromFirst = (ds: DayAgg[], has: (d: DayAgg) => boolean) => {
  const i = ds.findIndex(has)
  return i < 0 ? ds : ds.slice(i)
}
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0)
const one = (n: number) => (Math.round(n * 10) / 10).toString()
const timesText = (n: number) => `${n} ${n === 1 ? 'time' : 'times'}`
const pct = (a: number, b: number) => (a + b ? Math.round((a / (a + b)) * 100) : 0)

function activityCategory(key: string): Category {
  return {
    id: `activity:${key}`,
    label: activityLabel(key),
    tone: 'activity',
    icon: { type: 'activity', kind: key.startsWith('label:') ? undefined : key },
    group: 'care',
    match: (e) => e.type === 'activity' && activityKey(e) === key,
    has: (d) => (d.act[key]?.n ?? 0) > 0,
    rate: false,
  }
}

const BASE: Category[] = [
  { id: 'sleep', label: 'Sleep', tone: 'sleep', icon: { type: 'sleep' }, group: 'rhythm', match: (e) => e.type === 'sleep', has: (d) => d.t.sleepMs > 0, rate: true },
  { id: 'feeds', label: 'Feeds', tone: 'feed', icon: { type: 'nursing' }, group: 'rhythm', match: (e) => e.type === 'nursing' || e.type === 'bottle', has: (d) => d.breastN + d.bottleN > 0, rate: true },
  { id: 'solids', label: 'Solids', tone: 'feed', icon: { type: 'solids' }, group: 'rhythm', match: (e) => e.type === 'solids', has: (d) => d.solidsN > 0, rate: false },
  { id: 'diaper', label: 'Diapers', tone: 'diaper', icon: { type: 'diaper' }, group: 'rhythm', match: (e) => e.type === 'diaper', has: (d) => d.t.diapers > 0, rate: true },
  { id: 'potty', label: 'Potty', tone: 'diaper', icon: { type: 'potty' }, group: 'rhythm', match: (e) => e.type === 'potty', has: (d) => d.pottyWins + d.pottyAccidents > 0, rate: false },
  { id: 'pump', label: 'Pumping', tone: 'pump', icon: { type: 'pump' }, group: 'rhythm', match: (e) => e.type === 'pump', has: (d) => d.pumpN > 0, rate: true },
  { id: 'vitamins', label: 'Vitamins', tone: 'health', icon: { type: 'medicine' }, group: 'care', match: isSupplement, has: (d) => Object.keys(d.vit).length > 0, rate: false },
  { id: 'medicine', label: 'Medicine', tone: 'health', icon: { type: 'medicine' }, group: 'health', match: (e) => e.type === 'medicine' && !isSupplement(e), has: (d) => Object.keys(d.med).length > 0, rate: false },
  { id: 'temperature', label: 'Temperature', tone: 'health', icon: { type: 'temperature' }, group: 'health', match: (e) => e.type === 'temperature', has: (d) => d.temps.length > 0, rate: false },
  { id: 'health', label: 'Symptoms, visits and vaccines', tone: 'health', icon: { type: 'symptom' }, group: 'health', match: (e) => e.type === 'symptom', has: (d) => d.health > 0, rate: false },
  { id: 'growth', label: 'Growth', tone: 'growth', icon: { type: 'growth' }, group: 'health', match: (e) => e.type === 'growth', has: (d) => d.growth > 0, rate: false },
  { id: 'milestone', label: 'Firsts', tone: 'milestone', icon: { type: 'milestone' }, group: 'moments', match: (e) => e.type === 'milestone', has: (d) => d.milestones > 0, rate: false },
  { id: 'note', label: 'Notes', tone: 'note', icon: { type: 'note' }, group: 'moments', match: (e) => e.type === 'note', has: (d) => d.notes > 0, rate: false },
]

/** Every category that has ever had an entry for this baby, in display order (activity kinds by how often). */
export function categoriesFor(events: LeelaEvent[], childId: string, userId: string | null): Category[] {
  const mine = events.filter((e) => !e.deleted_at && showsFor(e, childId, userId))
  const acts = new Map<string, number>()
  for (const e of mine) if (e.type === 'activity') acts.set(activityKey(e), (acts.get(activityKey(e)) ?? 0) + 1)
  const order = ACTIVITY_KINDS.map((a) => a.id as string)
  const actCats = [...acts.entries()]
    .sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([k]) => activityCategory(k))
  const base = BASE.filter((c) => mine.some(c.match))
  const at = base.findIndex((c) => c.group !== 'rhythm')
  return [...base.slice(0, at < 0 ? base.length : at), ...actCats, ...base.slice(at < 0 ? base.length : at)]
}

export function categoryById(id: string): Category | undefined {
  return BASE.find((c) => c.id === id) ?? (id.startsWith('activity:') ? activityCategory(id.slice(9)) : undefined)
}

// ---------------------------------------------------------------------------- figures
/** The number a chart draws for a bucket of days, and how to write it. */
export function bucketValue(c: Category, ds: DayAgg[]): number {
  const logged = ds.filter(c.has)
  switch (c.id) {
    case 'sleep':
      return avg(logged.map((d) => d.t.sleepMs)) / H
    case 'feeds':
      return avg(logged.map((d) => d.breastN + d.bottleN))
    case 'diaper':
      return avg(logged.map((d) => d.t.diapers))
    case 'pump':
      return avg(logged.map((d) => d.t.pumpMl))
    case 'solids':
      return sum(ds.map((d) => d.solidsN))
    case 'potty':
      return sum(ds.map((d) => d.pottyWins))
    case 'vitamins':
      return logged.length
    case 'medicine':
      return sum(ds.map((d) => sum(Object.values(d.med))))
    case 'temperature':
      return logged.length ? Math.max(...logged.flatMap((d) => d.temps)) : 0
    case 'health':
      return sum(ds.map((d) => d.health))
    case 'growth':
      return sum(ds.map((d) => d.growth))
    case 'milestone':
      return sum(ds.map((d) => d.milestones))
    case 'note':
      return sum(ds.map((d) => d.notes))
    default: {
      const k = c.id.slice(9)
      return sum(ds.map((d) => d.act[k]?.n ?? 0))
    }
  }
}

export function valueText(c: Category, v: number): string {
  switch (c.id) {
    case 'sleep':
      return durationText(v * H)
    case 'pump':
      return `${Math.round(v)} ml`
    case 'temperature':
      return v ? `${one(v)}°` : '–'
    case 'feeds':
    case 'diaper':
      return one(v)
    default:
      return String(Math.round(v))
  }
}

/** What a chart's bars mean, for its heading. */
export function chartTitle(c: Category, grain: 'day' | 'week' | 'month'): string {
  const per = grain === 'day' ? 'each day' : grain === 'week' ? 'a day, by week' : 'a day, by month'
  const count = grain === 'day' ? 'each day' : `each ${grain}`
  switch (c.id) {
    case 'sleep':
      return `Sleep ${per}`
    case 'feeds':
      return `Feeds ${per}`
    case 'diaper':
      return `Diapers ${per}`
    case 'pump':
      return `Pumped ${per}`
    case 'vitamins':
      return grain === 'day' ? 'Days given' : `Days given ${count}`
    case 'temperature':
      return `Highest temperature ${count}`
    default:
      return `Times ${count}`
  }
}

export interface Headline {
  /** Big figure: "13h 10m", "6 times". */
  value: string
  /** After the figure: "a day". */
  unit: string
  /** Second line. */
  sub: string
}

/** The overview row for a category over some days (one day, or a whole period). */
export function headline(c: Category, ds: DayAgg[]): Headline {
  const logged = ds.filter(c.has)
  const n = ds.length
  const single = n === 1
  const onDays = n > 1 ? ` · on ${logged.length} of ${n} days` : ''
  switch (c.id) {
    case 'sleep': {
      const night = avg(logged.map((d) => d.t.nightMs))
      const naps = avg(logged.map((d) => d.t.naps))
      return { value: durationText(avg(logged.map((d) => d.t.sleepMs))), unit: single ? '' : 'a day', sub: `${durationText(night)} at night · ${one(naps)} ${naps === 1 ? 'nap' : 'naps'}` }
    }
    case 'feeds': {
      const b = avg(logged.map((d) => d.breastN))
      const bo = avg(logged.map((d) => d.bottleN))
      const ml = avg(logged.map((d) => d.bottleMl))
      const parts = [b ? `${one(b)} breast` : '', bo ? `${one(bo)} bottle${ml ? ` (${Math.round(ml)} ml)` : ''}` : '']
      return { value: one(b + bo), unit: single ? (b + bo === 1 ? 'feed' : 'feeds') : 'a day', sub: parts.filter(Boolean).join(' · ') }
    }
    case 'diaper': {
      const wet = avg(logged.map((d) => d.t.wet))
      const dirty = avg(logged.map((d) => d.t.dirty))
      return { value: one(avg(logged.map((d) => d.t.diapers))), unit: single ? 'changes' : 'a day', sub: `${one(wet)} wet · ${one(dirty)} dirty` }
    }
    case 'pump': {
      const s = avg(logged.map((d) => d.pumpN))
      return { value: `${Math.round(avg(logged.map((d) => d.t.pumpMl)))} ml`, unit: single ? '' : 'a day', sub: `${one(s)} ${s === 1 ? 'session' : 'sessions'}${single ? '' : ' a day'}` }
    }
    case 'solids': {
      const foods = [...new Set(ds.flatMap((d) => d.foods))]
      return { value: String(sum(ds.map((d) => d.solidsN))), unit: 'meals', sub: foods.slice(0, 4).join(', ') + (foods.length > 4 ? '…' : '') }
    }
    case 'potty':
      return { value: String(sum(ds.map((d) => d.pottyWins))), unit: 'on the potty', sub: `${sum(ds.map((d) => d.pottyAccidents))} accidents` }
    case 'vitamins': {
      const names = [...new Set(ds.flatMap((d) => Object.keys(d.vit)))]
      const per = names.map((nm) => {
        const span = fromFirst(ds, (d) => Boolean(d.vit[nm]))
        return `${nm} ${span.filter((d) => d.vit[nm]).length}/${span.length}`
      })
      const span = fromFirst(ds, c.has)
      return { value: single ? names.join(', ') : `${logged.length} of ${span.length}`, unit: single ? '' : 'days', sub: single ? 'given' : `${per.join(' · ')}${span.length < n ? ' · since the first' : ''}` }
    }
    case 'medicine': {
      const by = new Map<string, number>()
      for (const d of ds) for (const [k, v] of Object.entries(d.med)) by.set(k, (by.get(k) ?? 0) + v)
      const total = sum([...by.values()])
      return { value: String(total), unit: total === 1 ? 'dose' : 'doses', sub: [...by.entries()].map(([k, v]) => `${k} ×${v}`).join(' · ') }
    }
    case 'temperature': {
      const all = ds.flatMap((d) => d.temps)
      return { value: all.length ? `${one(Math.max(...all))} °C` : '–', unit: 'highest', sub: `${all.length} ${all.length === 1 ? 'reading' : 'readings'}` }
    }
    case 'health':
    case 'growth':
    case 'milestone':
    case 'note': {
      const v = bucketValue(c, ds)
      const word = c.id === 'growth' ? (v === 1 ? 'measurement' : 'measurements') : c.id === 'milestone' ? (v === 1 ? 'first' : 'firsts') : c.id === 'note' ? (v === 1 ? 'note' : 'notes') : v === 1 ? 'entry' : 'entries'
      return { value: String(v), unit: word, sub: '' }
    }
    default: {
      const k = c.id.slice(9)
      const a = ds.reduce((t, d) => ({ n: t.n + (d.act[k]?.n ?? 0), timed: t.timed + (d.act[k]?.timed ?? 0), min: t.min + (d.act[k]?.min ?? 0) }), { n: 0, timed: 0, min: 0 })
      const typical = a.timed ? ` · ${durationText((a.min / a.timed) * MIN)} each` : ''
      return { value: timesText(a.n), unit: '', sub: `${onDays.slice(3)}${typical}`.replace(/^ · /, '') }
    }
  }
}

/** "+40m", "−1.2" against the period before, for figures that are per-day averages. Null when not comparable. */
export function change(c: Category, now: DayAgg[], before: DayAgg[]): string | null {
  if (!c.rate || !before.some(c.has) || !now.some(c.has)) return null
  const a = bucketValue(c, now)
  const b = bucketValue(c, before)
  const d = a - b
  const tiny = c.id === 'sleep' ? Math.abs(d) < 10 / 60 : c.id === 'pump' ? Math.abs(d) < 10 : Math.abs(d) < 0.3
  if (tiny) return 'steady'
  const sign = d > 0 ? '+' : '−'
  const mag = Math.abs(d)
  return `${sign}${c.id === 'sleep' ? durationText(mag * H) : c.id === 'pump' ? `${Math.round(mag)} ml` : one(mag)}`
}

// ---------------------------------------------------------------------------- detail screen
/** Minutes after midnight, most common hour window of these moments: "10 – 11 AM". */
export function usualHour(times: number[], tz: string): string | null {
  if (times.length < 3) return null
  const counts = new Array(24).fill(0)
  for (const t of times) counts[Math.floor(minuteOfDay(t, tz) / 60) % 24]++
  let best = 0
  for (let h = 1; h < 24; h++) if (counts[h] > counts[best]) best = h
  if (counts[best] < Math.max(2, times.length * 0.2)) return null
  return hourRange(best)
}

export const hourRange = (h: number) => {
  const f = (x: number) => `${((x + 11) % 12) + 1}`
  const ap = (x: number) => (x % 24 < 12 ? 'AM' : 'PM')
  return ap(h) === ap(h + 1) ? `${f(h)} – ${f(h + 1)} ${ap(h)}` : `${f(h)} ${ap(h)} – ${f(h + 1)} ${ap(h + 1)}`
}

/** Counts by hour of day (0–23) of when these entries started. */
export function hourCounts(times: number[], tz: string): number[] {
  const counts = new Array(24).fill(0)
  for (const t of times) counts[Math.floor(minuteOfDay(t, tz) / 60) % 24]++
  return counts
}

/** Clock time as "2:15 AM" from minutes after midnight. */
export const clockOf = (minute: number) => {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440
  const h = Math.floor(m / 60)
  return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** Median clock time, treating times around midnight as close (for bedtimes and wake-ups). */
export function medianClock(times: number[], tz: string, pivot = 720): number | null {
  if (!times.length) return null
  // Shift so the pivot (noon by default) is the cut: 11 PM and 1 AM sort next to each other.
  const xs = times.map((t) => (minuteOfDay(t, tz) - pivot + 1440) % 1440).sort((a, b) => a - b)
  return (xs[Math.floor(xs.length / 2)] + pivot) % 1440
}

/** The figures at the top of a category's screen. */
export function detailStats(c: Category, ds: DayAgg[], entries: LeelaEvent[], tz: string): Stat[] {
  const logged = ds.filter(c.has)
  const n = ds.length
  const times = entries.map((e) => Date.parse(e.started_at))
  const usual = usualHour(times, tz)
  const out: Stat[] = []
  switch (c.id) {
    case 'sleep': {
      const nights = ds.flatMap((d) => d.nights).filter((x) => x.end - x.start >= 4 * H)
      const bed = medianClock(nights.map((x) => x.start), tz)
      const wake = medianClock(nights.map((x) => x.end), tz, 0)
      out.push(
        { label: 'Sleep a day', value: durationText(avg(logged.map((d) => d.t.sleepMs))) },
        { label: 'At night', value: durationText(avg(logged.map((d) => d.t.nightMs))) },
        { label: 'Naps a day', value: one(avg(logged.map((d) => d.t.naps))) },
        { label: 'Naps, total a day', value: durationText(avg(logged.map((d) => d.t.napMs))) },
        { label: 'Longest stretch', value: durationText(Math.max(0, ...ds.map((d) => d.t.longestSleepMs))) },
      )
      if (bed !== null) out.push({ label: 'Night usually starts', value: clockOf(bed) })
      if (wake !== null) out.push({ label: 'Up for the day', value: clockOf(wake) })
      break
    }
    case 'feeds': {
      const l = sum(ds.map((d) => d.leftMin))
      const r = sum(ds.map((d) => d.rightMin))
      out.push({ label: 'Feeds a day', value: one(avg(logged.map((d) => d.breastN + d.bottleN))) })
      if (ds.some((d) => d.breastN)) out.push({ label: 'Breastfeeds a day', value: one(avg(logged.map((d) => d.breastN))) }, { label: 'Breastfeeding a day', value: `${Math.round(avg(logged.map((d) => d.breastMin)))} min` })
      if (l + r > 0) out.push({ label: 'Left / right', value: `${pct(l, r)}% / ${pct(r, l)}%` })
      if (ds.some((d) => d.bottleN)) out.push({ label: 'Bottles a day', value: one(avg(logged.map((d) => d.bottleN))) }, { label: 'Bottle a day', value: `${Math.round(avg(logged.map((d) => d.bottleMl)))} ml` })
      const gaps = logged.map((d) => d.longestFeedGap).filter((g) => g > 0)
      if (gaps.length) out.push({ label: 'Longest gap, typical', value: durationText(avg(gaps) * MIN) })
      break
    }
    case 'diaper': {
      out.push(
        { label: 'Changes a day', value: one(avg(logged.map((d) => d.t.diapers))) },
        { label: 'Wet a day', value: one(avg(logged.map((d) => d.t.wet))) },
        { label: 'Dirty a day', value: one(avg(logged.map((d) => d.t.dirty))) },
        { label: 'Days with a dirty one', value: `${ds.filter((d) => d.t.dirty > 0).length} of ${n}` },
      )
      break
    }
    case 'pump':
      out.push({ label: 'Pumped a day', value: `${Math.round(avg(logged.map((d) => d.t.pumpMl)))} ml` }, { label: 'Sessions a day', value: one(avg(logged.map((d) => d.pumpN))) }, { label: 'Total', value: `${Math.round(sum(ds.map((d) => d.t.pumpMl)))} ml` })
      break
    case 'vitamins': {
      const names = [...new Set(ds.flatMap((d) => Object.keys(d.vit)))]
      for (const nm of names) {
        const span = fromFirst(ds, (d) => Boolean(d.vit[nm]))
        out.push({ label: nm, value: `${span.filter((d) => d.vit[nm]).length} of ${span.length} days` })
      }
      break
    }
    case 'temperature': {
      const all = ds.flatMap((d) => d.temps)
      out.push({ label: 'Readings', value: String(all.length) })
      if (all.length) out.push({ label: 'Highest', value: `${one(Math.max(...all))} °C` })
      break
    }
    default: {
      if (c.id.startsWith('activity:')) {
        const k = c.id.slice(9)
        const a = ds.reduce((t, d) => ({ n: t.n + (d.act[k]?.n ?? 0), timed: t.timed + (d.act[k]?.timed ?? 0), min: t.min + (d.act[k]?.min ?? 0) }), { n: 0, timed: 0, min: 0 })
        if (a.timed) out.push({ label: 'Usually lasts', value: durationText((a.min / a.timed) * MIN) }, { label: 'Time logged', value: durationText(a.min * MIN) })
      }
    }
  }
  if (usual && c.id !== 'sleep') out.push({ label: 'Most often', value: usual })
  const last = entries[0]
  if (last && c.id !== 'sleep') out.push({ label: 'Last one', value: `${dayLabel(last.started_at, tz)}, ${fmtTime(last.started_at, tz)}` })
  return out
}

/** A note under the figures when they're only partly known: lengths missing from imported logs. */
export function detailNote(c: Category, ds: DayAgg[]): string | null {
  if (!c.id.startsWith('activity:')) return null
  const k = c.id.slice(9)
  const n = sum(ds.map((d) => d.act[k]?.n ?? 0))
  const timed = sum(ds.map((d) => d.act[k]?.timed ?? 0))
  if (!n || timed === n) return null
  return timed
    ? `Every ${activityLabel(k).toLowerCase()} is counted. ${timed} of ${n} were logged with a length, so time totals use those ${timed} only.`
    : `Every ${activityLabel(k).toLowerCase()} is counted. None were logged with a length, so there are no time totals.`
}

/** The bars on a category's screen, one value per bucket (stacked where that helps). */
export function detailSeries(c: Category, per: DayAgg[][]): Series[] {
  switch (c.id) {
    case 'sleep':
      return [
        { key: 'night', label: 'Night', color: 'var(--c-night)', values: per.map((ds) => avg(ds.filter(c.has).map((d) => d.t.nightMs)) / H) },
        { key: 'naps', label: 'Naps', color: 'var(--c-nap)', values: per.map((ds) => avg(ds.filter(c.has).map((d) => d.t.napMs)) / H) },
      ]
    case 'feeds':
      return [
        { key: 'breast', label: 'Breast', color: 'var(--c-feed)', values: per.map((ds) => avg(ds.filter(c.has).map((d) => d.breastN))) },
        { key: 'bottle', label: 'Bottle', color: 'var(--c-feed-2)', values: per.map((ds) => avg(ds.filter(c.has).map((d) => d.bottleN))) },
      ]
    case 'diaper':
      return [
        { key: 'wet', label: 'Wet', color: 'var(--c-diaper)', values: per.map((ds) => avg(ds.filter(c.has).map((d) => d.wetOnly))) },
        { key: 'mixed', label: 'Both', color: 'color-mix(in srgb, var(--c-diaper) 60%, var(--card))', values: per.map((ds) => avg(ds.filter(c.has).map((d) => d.mixed))) },
        { key: 'dirty', label: 'Dirty', color: 'var(--diaper)', values: per.map((ds) => avg(ds.filter(c.has).map((d) => d.dirtyOnly))) },
      ]
    default:
      return [{ key: 'v', label: c.label, color: `var(--${c.tone})`, values: per.map((ds) => bucketValue(c, ds)) }]
  }
}

/** Day figures grouped into chart buckets. */
export function byBucket(ds: DayAgg[], buckets: Bucket[]): DayAgg[][] {
  return buckets.map((b) => ds.filter((d) => d.day >= b.from && d.day < b.to))
}

/** A category's entries in [from, to), newest first. */
export function entriesOf(c: Category, events: LeelaEvent[], childId: string, userId: string | null, from: number, to: number): LeelaEvent[] {
  return events
    .filter((e) => !e.deleted_at && showsFor(e, childId, userId) && c.match(e) && Date.parse(e.started_at) >= from && Date.parse(e.started_at) < to)
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
}

/** Text to search an entry by: its title, details, notes, foods and names. */
export function searchText(e: LeelaEvent, title: string, detail: string | null): string {
  const d = e.data
  return [title, detail, e.notes, d.title, d.body, d.name, d.label, d.vaccine, (d.tags ?? []).join(' '), (d.foods ?? []).map((f) => f.name).join(' '), d.ghar && typeof d.ghar === 'object' ? (d.ghar as { detail?: string }).detail : '']
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}
