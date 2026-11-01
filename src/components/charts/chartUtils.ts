// Shared pieces of the charts that aren't components.
import { TZDate } from '@date-fns/tz'
import type { Column, Filter, MarkKind } from '../../lib/charts'
import { durationText } from '../../lib/time'

/** 1, 2, 2.5, 5 × 10ⁿ steps, so ticks land on clean numbers. */
export function niceMax(max: number, ticks = 2): { top: number; step: number } {
  if (!(max > 0)) return { top: 1, step: 0.5 }
  const raw = max / ticks
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  return { top: step * Math.ceil(max / step), step }
}

export function dayTick(day: number, i: number, n: number, tz: string): string | null {
  const d = new TZDate(day, tz)
  if (n <= 7) return d.toLocaleDateString('en', { weekday: 'short', timeZone: tz }).slice(0, 2)
  const every = n <= 14 ? 2 : n <= 31 ? 5 : 15
  return (n - 1 - i) % every === 0 ? (n <= 31 ? String(d.getDate()) : d.toLocaleDateString('en', { day: 'numeric', month: 'short', timeZone: tz })) : null
}

export const MARK_COLOR: Record<MarkKind, string> = {
  night: 'var(--c-night)',
  nap: 'var(--c-nap)',
  feed: 'var(--c-feed)',
  diaper: 'var(--c-diaper)',
  health: 'var(--ink)',
  other: 'var(--c-other)',
}

export const FILTERS: { id: Filter; label: string }[] = [
  { id: 'sleep', label: 'Sleep' },
  { id: 'feed', label: 'Feeds' },
  { id: 'diaper', label: 'Diapers' },
  { id: 'health', label: 'Health' },
  { id: 'other', label: 'Other' },
]

/** "13h 20m sleep, 7 feeds, 8 diapers" for one column. */
export function columnSummary(c: Column): string {
  let sleep = 0
  let feeds = 0
  let diapers = 0
  for (const m of c.marks) {
    if (m.kind === 'night' || m.kind === 'nap') sleep += m.end - m.start
    else if (m.kind === 'feed' && m.type !== 'solids') feeds++
    else if (m.kind === 'diaper') diapers++
  }
  return `${durationText(sleep)} sleep, ${feeds} ${feeds === 1 ? 'feed' : 'feeds'}, ${diapers} ${diapers === 1 ? 'diaper' : 'diapers'}`
}
