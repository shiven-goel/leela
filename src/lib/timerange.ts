// Times picked on a clock, in the family's time zone. Kept free of React so the rules can be tested
// (tests/timerange.test.ts): which day a picked clock time means, how a start and an end move
// together, and when a start and end make sense.
import { TZDate } from '@date-fns/tz'
import { dayLabel, fmtTime } from './time'
import type { EventType, LeelaEvent } from './types'

export const MIN = 60_000
const DAY = 86_400_000
/** Entries may be a few minutes ahead, for a phone whose clock runs a little fast. */
export const FUTURE_MS = 5 * MIN

const pad = (n: number) => String(n).padStart(2, '0')

/** A moment as "yyyy-MM-dd" and "HH:mm" in the time zone, as date and time inputs use them. */
export function localParts(ms: number, tz: string): { date: string; time: string } {
  const d = new TZDate(ms, tz)
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}

export function fromParts(date: string, time: string, tz: string): number | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const tm = /^(\d{1,2}):(\d{2})/.exec(time)
  if (!dm || !tm) return null
  return new TZDate(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2], tz).getTime()
}

/** A calendar date some days before or after another ("yyyy-MM-dd"). */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + days * DAY).toISOString().slice(0, 10)
}

/**
 * A clock time picked for a moment: the same day as before, or the day before when that would be
 * in the future. At 7 AM, picking 11:40 PM means last night.
 */
export function withTime(base: number, time: string, tz: string, now: number): number {
  const { date } = localParts(base, tz)
  const same = fromParts(date, time, tz)
  if (same === null) return base
  if (same > now + FUTURE_MS) return fromParts(shiftDate(date, -1), time, tz) ?? same
  return same
}

/** A day picked for a moment: the same clock time on that day. */
export function withDate(base: number, date: string, tz: string): number {
  return fromParts(date, localParts(base, tz).time, tz) ?? base
}

export interface Range {
  start: number
  end: number | null
}

/**
 * The end for a clock time: the first time the clock shows it at or after the start, so a sleep
 * from 11:40 PM to 2:15 AM ends the next morning.
 */
export function endAtTime(start: number, time: string, tz: string): number {
  const { date } = localParts(start, tz)
  const same = fromParts(date, time, tz)
  if (same === null) return start
  return same >= start ? same : (fromParts(shiftDate(date, 1), time, tz) ?? same)
}

/** The end's day was picked: the same clock time on that day. */
export function endOnDate(r: Range, date: string, tz: string): Range {
  if (r.end === null) return r
  return { start: r.start, end: withDate(r.end, date, tz) }
}

/**
 * The start moved. The end stays where it is, so moving the start back to when a feed really
 * began keeps the end. Only an end that no longer works moves: one in the future (picked before
 * the start was set) becomes that clock time after the new start, and one now before the start
 * keeps the length it had, without running into the future.
 */
export function moveStart(r: Range, start: number, tz: string, now: number, fallbackLen: number): Range {
  if (r.end === null) return { start, end: null }
  let end = r.end
  if (end > now + FUTURE_MS) {
    const again = endAtTime(start, localParts(end, tz).time, tz)
    if (again <= now + FUTURE_MS) end = again
  }
  if (end <= start) {
    const len = r.end - r.start > 0 ? r.end - r.start : fallbackLen
    end = Math.max(start, Math.min(start + len, now))
  }
  return { start, end }
}

/** Moves the whole range, keeping its length (for fixing the time of an imported entry). */
export function shiftRange(r: Range, start: number): Range {
  return { start, end: r.end === null ? null : r.end + (start - r.start) }
}

/** "Add end time": the usual length after the start, or, for one that only just started, ending now. */
export function addEnd(r: Range, len: number, now: number): Range {
  const end = Math.min(r.start + len, now)
  if (end - r.start >= MIN) return { start: r.start, end }
  return { start: now - len, end: now }
}

export type TimeIssue = 'start-future' | 'end-future' | 'end-before-start' | 'no-end' | 'before-birth'

export function checkRange(r: Range, now: number, opts: { endRequired?: boolean; earliest?: number | null } = {}): TimeIssue | null {
  if (r.start > now + FUTURE_MS) return 'start-future'
  if (opts.earliest != null && r.start < opts.earliest) return 'before-birth'
  if (r.end === null) return opts.endRequired ? 'no-end' : null
  if (r.end <= r.start) return 'end-before-start'
  if (r.end > now + FUTURE_MS) return 'end-future'
  return null
}

export function issueText(issue: TimeIssue, name = 'the baby', single = false): string {
  switch (issue) {
    case 'start-future':
      return single ? 'That time is in the future.' : 'The start is in the future.'
    case 'end-future':
      return 'The end is in the future.'
    case 'end-before-start':
      return 'The end has to be after the start.'
    case 'no-end':
      return 'Add when it ended.'
    case 'before-birth':
      return `That’s before ${name} was born.`
  }
}

/** Breastfeeding sides can't add up to more than the feed itself (a minute's slack for rounding). */
export function sidesTooLong(leftS: number, rightS: number, spanMs: number): boolean {
  return (leftS + rightS) * 1000 > spanMs + MIN
}

const DEFAULT_MIN: Partial<Record<EventType, number>> = { sleep: 60, nursing: 15, bottle: 15, solids: 20, pump: 15, activity: 15 }

/**
 * How long a new past entry starts out: as long as the last one of its kind, so a fix is usually one
 * or two taps. Sleep always starts at an hour (the last one may well have been a whole night).
 */
export function usualLength(type: EventType, last?: LeelaEvent): number {
  const fallback = (DEFAULT_MIN[type] ?? 15) * MIN
  if (type === 'sleep' || !last?.ended_at || last.timer_state) return fallback
  const ms = Date.parse(last.ended_at) - Date.parse(last.started_at)
  return ms >= MIN && ms <= 4 * 60 * MIN ? Math.round(ms / MIN) * MIN : fallback
}

/** Start of the baby's birth day, for "not before birth". */
export function birthStart(birthDate: string | null | undefined, tz: string): number | null {
  return birthDate ? fromParts(birthDate, '00:00', tz) : null
}

// ---------------------------------------------------------------------------- timers
/** When a timer started or stopped: some minutes ago (0 is just now), or a time picked on the clock. */
export type When = { min: number } | { at: number }

export const whenAt = (w: When, now: number) => ('at' in w ? w.at : now - w.min * MIN)
export const whenIsNow = (w: When) => 'min' in w && w.min === 0

/** "2:10 PM", or "11:40 PM yesterday" when it isn't today. */
export function whenText(at: number, tz: string, now = Date.now()): string {
  const day = dayLabel(at, tz, now)
  return day === 'Today' ? fmtTime(at, tz) : `${fmtTime(at, tz)} ${day === 'Yesterday' ? 'yesterday' : `on ${day}`}`
}
