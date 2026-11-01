// One counting function for every screen, so Today, History, Trends and exports always agree.
import type { Family, LeelaEvent, TimerSegment } from './types'
import { minuteOfDay } from './time'

export interface Totals {
  sleepMs: number
  napMs: number
  nightMs: number
  naps: number
  longestSleepMs: number
  feeds: number
  bottleMl: number
  nursingLeftS: number
  nursingRightS: number
  /** Breastfeeding with no sides recorded (imported logs). */
  nursingOtherS: number
  solids: number
  diapers: number
  wet: number
  dirty: number
  potty: number
  pumpMl: number
  meds: number
}

export const emptyTotals = (): Totals => ({
  sleepMs: 0,
  napMs: 0,
  nightMs: 0,
  naps: 0,
  longestSleepMs: 0,
  feeds: 0,
  bottleMl: 0,
  nursingLeftS: 0,
  nursingRightS: 0,
  nursingOtherS: 0,
  solids: 0,
  diapers: 0,
  wet: 0,
  dirty: 0,
  potty: 0,
  pumpMl: 0,
  meds: 0,
})

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Whether a moment falls in the family's night window (default 7 PM to 7 AM). */
export function inNightWindow(at: string | number, family: Pick<Family, 'timezone' | 'night_start' | 'night_end'>): boolean {
  const m = minuteOfDay(at, family.timezone)
  const start = toMin(family.night_start)
  const end = toMin(family.night_end)
  return start > end ? m >= start || m < end : m >= start && m < end
}

export function sleepKind(e: LeelaEvent, family: Pick<Family, 'timezone' | 'night_start' | 'night_end'>): 'nap' | 'night' {
  if (e.data.kind === 'nap' || e.data.kind === 'night') return e.data.kind
  return inNightWindow(e.started_at, family) ? 'night' : 'nap'
}

export function eventEndMs(e: LeelaEvent, now: number): number {
  if (e.ended_at) return Date.parse(e.ended_at)
  if (e.timer_state) return now
  return Date.parse(e.started_at)
}

export function eventDurationMs(e: LeelaEvent, now: number): number {
  return Math.max(0, eventEndMs(e, now) - Date.parse(e.started_at))
}

/** Left/right nursing seconds; live timers are computed from their segments. */
export function nursingSeconds(
  e: LeelaEvent,
  segments: TimerSegment[],
  now: number,
): { left: number; right: number } {
  if (!e.timer_state && (e.data.left_s !== undefined || e.data.right_s !== undefined)) {
    return { left: e.data.left_s ?? 0, right: e.data.right_s ?? 0 }
  }
  let left = 0
  let right = 0
  for (const s of segments) {
    if (s.event_id !== e.id || !s.side) continue
    const end = s.ended_at ? Date.parse(s.ended_at) : now
    const secs = Math.max(0, (end - Date.parse(s.started_at)) / 1000)
    if (s.side === 'left') left += secs
    else right += secs
  }
  return { left: Math.round(left), right: Math.round(right) }
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

/**
 * Totals for one child between `from` and `to`.
 * Sleep is split at the range edges; everything else counts where it started.
 * Pumping belongs to the family, so it counts for every child view.
 */
export function totalsFor(
  events: LeelaEvent[],
  segments: TimerSegment[],
  childId: string | null,
  from: number,
  to: number,
  family: Pick<Family, 'timezone' | 'night_start' | 'night_end'>,
  now: number,
): Totals {
  const t = emptyTotals()
  for (const e of events) {
    if (e.deleted_at) continue
    if (e.child_id && childId && e.child_id !== childId) continue
    const start = Date.parse(e.started_at)
    const startedIn = start >= from && start < to

    if (e.type === 'sleep') {
      const end = eventEndMs(e, now)
      const ms = overlap(start, end, from, to)
      if (ms > 0) {
        t.sleepMs += ms
        if (sleepKind(e, family) === 'night') t.nightMs += ms
        else t.napMs += ms
      }
      if (startedIn) {
        if (sleepKind(e, family) === 'nap') t.naps += 1
        t.longestSleepMs = Math.max(t.longestSleepMs, end - start)
      }
      continue
    }
    if (!startedIn) continue
    switch (e.type) {
      case 'nursing': {
        t.feeds += 1
        const s = nursingSeconds(e, segments, now)
        t.nursingLeftS += s.left
        t.nursingRightS += s.right
        if (!e.timer_state && e.data.left_s === undefined && e.data.right_s === undefined && typeof e.data.total_s === 'number') t.nursingOtherS += e.data.total_s
        break
      }
      case 'bottle':
        t.feeds += 1
        t.bottleMl += e.data.amount_ml ?? 0
        break
      case 'solids':
        t.solids += 1
        break
      case 'diaper': {
        t.diapers += 1
        const k = e.data.kind
        if (k === 'wet' || k === 'mixed') t.wet += 1
        if (k === 'dirty' || k === 'mixed') t.dirty += 1
        break
      }
      case 'potty':
        t.potty += 1
        break
      case 'pump':
        t.pumpMl += e.data.total_ml ?? (e.data.left_ml ?? 0) + (e.data.right_ml ?? 0)
        break
      case 'medicine':
        t.meds += 1
        break
      default:
        break
    }
  }
  return t
}

export function lastOf(events: LeelaEvent[], childId: string | null, types: string[]): LeelaEvent | undefined {
  let best: LeelaEvent | undefined
  for (const e of events) {
    if (e.deleted_at || !types.includes(e.type)) continue
    if (childId && e.child_id && e.child_id !== childId) continue
    if (!best || e.started_at > best.started_at) best = e
  }
  return best
}

/** The child's current sleep state: asleep since X, or awake since the last sleep ended. */
export function sleepState(
  events: LeelaEvent[],
  childId: string,
  now: number,
): { asleep: boolean; since: number | null; event?: LeelaEvent } {
  let running: LeelaEvent | undefined
  let lastEnded: LeelaEvent | undefined
  for (const e of events) {
    if (e.deleted_at || e.type !== 'sleep' || e.child_id !== childId) continue
    if (e.timer_state) {
      if (!running || e.started_at > running.started_at) running = e
    } else if (e.ended_at && Date.parse(e.ended_at) <= now) {
      if (!lastEnded || e.ended_at > lastEnded.ended_at!) lastEnded = e
    }
  }
  if (running) return { asleep: true, since: Date.parse(running.started_at), event: running }
  if (lastEnded) return { asleep: false, since: Date.parse(lastEnded.ended_at!), event: lastEnded }
  return { asleep: false, since: null }
}
