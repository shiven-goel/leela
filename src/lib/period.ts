// The stretch of time History looks at: a day, a week, a month, since birth or any range, in the
// family's time zone. Periods run from local midnight to local midnight (`to` is exclusive).
import { TZDate } from '@date-fns/tz'
import { addDaysTz, dayStart, daysBetween, fmtShortDate } from './time'

export type PeriodKind = 'day' | 'week' | 'month' | 'all' | 'custom'

export interface Period {
  kind: PeriodKind
  from: number
  /** Exclusive: local midnight after the last day. */
  to: number
}

export interface Bucket {
  from: number
  to: number
  /** Short label for an axis: "21", "16 Nov", "Nov". */
  tick: string
  /** Full label for a tooltip or a table: "Sat, 21 Nov", "16 – 22 Nov", "November". */
  label: string
}

const DAY = 86_400_000
const monthName = (d: TZDate, style: 'long' | 'short' = 'long') => d.toLocaleDateString('en', { month: style, timeZone: d.timeZone })

/** Midnight at the start of `t`'s local day. */
export const startOf = (t: number, tz: string) => dayStart(t, tz).getTime()

/** The first local day of anything to show: birth, or the first entry if that's earlier. */
export function firstDay(birth: string | null | undefined, firstEntry: number | null, tz: string, now: number): number {
  const b = birth ? new TZDate(Number(birth.slice(0, 4)), Number(birth.slice(5, 7)) - 1, Number(birth.slice(8, 10)), tz).getTime() : null
  const cands = [b, firstEntry === null ? null : startOf(firstEntry, tz)].filter((x): x is number => x !== null)
  return cands.length ? Math.min(...cands) : startOf(now, tz)
}

/**
 * A period of `kind` around the local day `anchor` (any moment in it): the day itself, the seven
 * days ending on it, its calendar month, or since `start` (birth) until today.
 */
export function makePeriod(kind: PeriodKind, anchor: number, tz: string, start: number, now: number): Period {
  const day = startOf(anchor, tz)
  const today = startOf(now, tz)
  const tomorrow = addDaysTz(today, 1, tz).getTime()
  switch (kind) {
    case 'day':
      return { kind, from: day, to: addDaysTz(day, 1, tz).getTime() }
    case 'week':
      return { kind, from: addDaysTz(day, -6, tz).getTime(), to: addDaysTz(day, 1, tz).getTime() }
    case 'month': {
      const d = new TZDate(day, tz)
      const from = new TZDate(d.getFullYear(), d.getMonth(), 1, tz).getTime()
      return { kind, from, to: new TZDate(d.getFullYear(), d.getMonth() + 1, 1, tz).getTime() }
    }
    case 'all':
    default:
      return { kind: kind === 'custom' ? 'custom' : 'all', from: Math.min(start, today), to: tomorrow }
  }
}

/** A custom range of whole local days, from the day of `a` to the day of `b` (either order). */
export function customPeriod(a: number, b: number, tz: string): Period {
  const x = startOf(Math.min(a, b), tz)
  const y = startOf(Math.max(a, b), tz)
  return { kind: 'custom', from: x, to: addDaysTz(y, 1, tz).getTime() }
}

/** The same kind of period one step earlier (-1) or later (+1). Never later than today. */
export function shiftPeriod(p: Period, dir: -1 | 1, tz: string, now: number): Period {
  const today = startOf(now, tz)
  let next: Period
  if (p.kind === 'day') next = { ...p, from: addDaysTz(p.from, dir, tz).getTime(), to: addDaysTz(p.to, dir, tz).getTime() }
  else if (p.kind === 'week') next = { ...p, from: addDaysTz(p.from, 7 * dir, tz).getTime(), to: addDaysTz(p.to, 7 * dir, tz).getTime() }
  else if (p.kind === 'month') {
    const d = new TZDate(p.from, tz)
    const from = new TZDate(d.getFullYear(), d.getMonth() + dir, 1, tz).getTime()
    next = { ...p, from, to: new TZDate(d.getFullYear(), d.getMonth() + dir + 1, 1, tz).getTime() }
  } else {
    const n = dayCount(p, tz)
    next = { ...p, from: addDaysTz(p.from, n * dir, tz).getTime(), to: addDaysTz(p.to, n * dir, tz).getTime() }
  }
  return next.from > today ? p : next
}

/** Whether there's a later period to step to. */
export const canGoLater = (p: Period, tz: string, now: number) => p.kind !== 'all' && p.to <= startOf(now, tz)

/** Number of local days in the period. */
export const dayCount = (p: Period, tz: string) => Math.max(1, daysBetween(p.to, p.from, tz))

/** The days of the period that have happened (up to today), as local midnights. */
export function daysOf(p: Period, tz: string, now: number): number[] {
  const out: number[] = []
  const today = startOf(now, tz)
  for (let d = p.from; d < p.to && d <= today; d = addDaysTz(d, 1, tz).getTime()) out.push(d)
  return out
}

/** The period before this one, of the same length, for comparisons. */
export function previousPeriod(p: Period, tz: string): Period {
  if (p.kind === 'month') {
    const d = new TZDate(p.from, tz)
    return { kind: 'month', from: new TZDate(d.getFullYear(), d.getMonth() - 1, 1, tz).getTime(), to: p.from }
  }
  const n = dayCount(p, tz)
  return { kind: p.kind, from: addDaysTz(p.from, -n, tz).getTime(), to: p.from }
}

/** How a period's chart groups: by day up to five weeks, by week up to seven months, then by month. */
export function grain(p: Period, tz: string, now: number): 'day' | 'week' | 'month' {
  const n = daysOf(p, tz, now).length
  return n <= 35 ? 'day' : n <= 213 ? 'week' : 'month'
}

/** The period split into chart buckets (only the part up to today). */
export function bucketsOf(p: Period, tz: string, now: number): Bucket[] {
  const days = daysOf(p, tz, now)
  if (!days.length) return []
  const g = grain(p, tz, now)
  const end = addDaysTz(days[days.length - 1], 1, tz).getTime()
  const out: Bucket[] = []
  if (g === 'day') {
    for (const d of days) {
      const t = new TZDate(d, tz)
      out.push({
        from: d,
        to: addDaysTz(d, 1, tz).getTime(),
        tick: days.length <= 7 ? t.toLocaleDateString('en', { weekday: 'short', timeZone: tz }).slice(0, 2) : String(t.getDate()),
        label: t.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }),
      })
    }
    return out
  }
  if (g === 'week') {
    // Weeks counted back from the last day, so the newest bar is a whole week.
    const starts: number[] = []
    for (let s = addDaysTz(end, -7, tz).getTime(); s > p.from - 7 * DAY; s = addDaysTz(s, -7, tz).getTime()) starts.unshift(Math.max(s, days[0]))
    for (let i = 0; i < starts.length; i++) {
      const from = starts[i]
      const to = i + 1 < starts.length ? starts[i + 1] : end
      if (to <= from) continue
      out.push({ from, to, tick: fmtShortDate(from, tz), label: `${fmtShortDate(from, tz)} – ${fmtShortDate(addDaysTz(to, -1, tz).getTime(), tz)}` })
    }
    return out
  }
  let cur = new TZDate(days[0], tz)
  let from = days[0]
  while (from < end) {
    const next = new TZDate(cur.getFullYear(), cur.getMonth() + 1, 1, tz).getTime()
    const to = Math.min(next, end)
    out.push({ from, to, tick: monthName(cur, 'short'), label: `${monthName(cur)} ${cur.getFullYear()}` })
    from = next
    cur = new TZDate(next, tz)
  }
  return out
}

/** "Today", "Sat, 14 Nov"; "15 – 21 Nov"; "November 2026"; "Since birth"; "3 Oct – 9 Nov". */
export function periodLabel(p: Period, tz: string, now: number, opts: { birth?: boolean } = {}): string {
  const today = startOf(now, tz)
  const last = addDaysTz(p.to, -1, tz).getTime()
  if (p.kind === 'day') {
    const diff = daysBetween(today, p.from, tz)
    if (diff === 0) return 'Today'
    if (diff === 1) return 'Yesterday'
    return new TZDate(p.from, tz).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz })
  }
  if (p.kind === 'month') {
    const d = new TZDate(p.from, tz)
    return `${monthName(d)}${d.getFullYear() === new TZDate(now, tz).getFullYear() ? '' : ` ${d.getFullYear()}`}`
  }
  if (p.kind === 'all') return opts.birth ? 'Since birth' : 'Everything'
  if (p.kind === 'week' && last === today) return 'Last 7 days'
  return rangeText(p.from, last, tz)
}

/** "15 – 21 Nov", "28 Oct – 3 Nov", "3 Oct 2025 – 9 Jan 2026". */
export function rangeText(first: number, last: number, tz: string): string {
  const a = new TZDate(first, tz)
  const b = new TZDate(last, tz)
  const sameYear = a.getFullYear() === b.getFullYear()
  const year = (d: TZDate) => (sameYear ? '' : ` ${d.getFullYear()}`)
  if (sameYear && a.getMonth() === b.getMonth()) return a.getDate() === b.getDate() ? fmtShortDate(first, tz) : `${a.getDate()} – ${fmtShortDate(last, tz)}`
  return `${fmtShortDate(first, tz)}${year(a)} – ${fmtShortDate(last, tz)}${year(b)}`
}

/** The baby's months of life up to now, as periods: month 1 is birth to the day before one month. */
export function lifeMonths(birth: string, tz: string, now: number): { n: number; period: Period }[] {
  const y = Number(birth.slice(0, 4))
  const m = Number(birth.slice(5, 7)) - 1
  const d = Number(birth.slice(8, 10))
  const out: { n: number; period: Period }[] = []
  for (let i = 0; i < 60; i++) {
    const from = new TZDate(y, m + i, d, tz).getTime()
    if (from > now) break
    out.push({ n: i + 1, period: { kind: 'custom', from, to: new TZDate(y, m + i + 1, d, tz).getTime() } })
  }
  return out
}
