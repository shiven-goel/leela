// Run with: npx tsx tests/timerange.test.ts
// The phone is set to New York while the family is in India: every rule must follow the family's clock.
process.env.TZ = 'America/New_York'
import assert from 'node:assert/strict'
import {
  FUTURE_MS,
  MIN,
  addEnd,
  birthStart,
  checkRange,
  endAtTime,
  endOnDate,
  fromParts,
  localParts,
  moveStart,
  shiftDate,
  shiftRange,
  sidesTooLong,
  usualLength,
  withDate,
  withTime,
} from '../src/lib/timerange'
import type { LeelaEvent } from '../src/lib/types'

const TZ = 'Asia/Kolkata'
const at = (day: string, hhmm: string) => Date.parse(`${day}T${hhmm}:00+05:30`)
const H = 60 * MIN

// Parts round trip in the family's zone, whatever the phone says.
assert.deepEqual(localParts(at('2026-11-02', '23:40'), TZ), { date: '2026-11-02', time: '23:40' })
assert.equal(fromParts('2026-11-02', '23:40', TZ), at('2026-11-02', '23:40'))
assert.equal(fromParts('2026-11-02', '', TZ), null)
assert.equal(shiftDate('2026-03-01', -1), '2026-02-28')
assert.equal(shiftDate('2026-12-31', 1), '2027-01-01')
// A zone with daylight saving: the clock time survives the change.
assert.deepEqual(localParts(fromParts('2026-03-08', '09:30', 'America/New_York')!, 'America/New_York'), { date: '2026-03-08', time: '09:30' })

// Picking a clock time for a moment.
const now = at('2026-11-02', '07:00')
assert.equal(withTime(now, '06:10', TZ, now), at('2026-11-02', '06:10'), 'earlier today')
assert.equal(withTime(now, '23:40', TZ, now), at('2026-11-01', '23:40'), 'at 7 AM, 11:40 PM means last night')
assert.equal(withTime(now, '07:04', TZ, now), at('2026-11-02', '07:04'), 'a few minutes ahead is fine')
assert.equal(withTime(at('2026-10-29', '12:00'), '18:30', TZ, now), at('2026-10-29', '18:30'), 'an old entry keeps its day')
assert.equal(withDate(at('2026-11-02', '06:10'), '2026-10-30', TZ), at('2026-10-30', '06:10'))

// The end for a clock time: the first time it comes round after the start.
assert.equal(endAtTime(at('2026-11-01', '23:40'), '02:15', TZ), at('2026-11-02', '02:15'), 'a night sleep ends the next morning')
assert.equal(endAtTime(at('2026-11-01', '23:40'), '02:15', TZ) - at('2026-11-01', '23:40'), 2 * H + 35 * MIN)
assert.equal(endAtTime(at('2026-11-02', '09:10'), '09:35', TZ), at('2026-11-02', '09:35'), 'same day')
assert.equal(endAtTime(at('2026-11-02', '09:10'), '09:10', TZ), at('2026-11-02', '09:10'), 'the same time is the same moment')
assert.deepEqual(endOnDate({ start: at('2026-11-02', '05:00'), end: at('2026-11-02', '06:00') }, '2026-11-01', TZ), {
  start: at('2026-11-02', '05:00'),
  end: at('2026-11-01', '06:00'),
})

// Moving the start leaves a good end alone: the feed began earlier than logged, it still ended now.
const r = { start: at('2026-11-02', '06:45'), end: at('2026-11-02', '07:00') }
assert.deepEqual(moveStart(r, at('2026-11-02', '06:20'), TZ, now, 15 * MIN), { start: at('2026-11-02', '06:20'), end: r.end })
// Past the end: the end keeps the old length, but never goes into the future.
assert.deepEqual(moveStart({ start: at('2026-11-01', '09:00'), end: at('2026-11-01', '09:40') }, at('2026-11-01', '10:00'), TZ, now, 15 * MIN), {
  start: at('2026-11-01', '10:00'),
  end: at('2026-11-01', '10:40'),
})
assert.deepEqual(moveStart(r, at('2026-11-02', '07:00'), TZ, now, 15 * MIN), { start: now, end: now }, 'capped at now')
// End picked first (it landed tomorrow morning), then the start set to last night: the end follows.
const endFirst = { start: at('2026-11-02', '06:00'), end: endAtTime(at('2026-11-02', '06:00'), '02:15', TZ) }
assert.equal(endFirst.end, at('2026-11-03', '02:15'))
assert.equal(checkRange(endFirst, now), 'end-future')
const fixed = moveStart(endFirst, withTime(endFirst.start, '23:40', TZ, now), TZ, now, H)
assert.deepEqual(fixed, { start: at('2026-11-01', '23:40'), end: at('2026-11-02', '02:15') })
assert.equal(checkRange(fixed, now), null)
assert.deepEqual(moveStart({ start: 5, end: null }, 9, TZ, now, H), { start: 9, end: null })
assert.deepEqual(shiftRange({ start: at('2026-11-01', '13:00'), end: at('2026-11-01', '15:00') }, at('2026-11-01', '14:00')), {
  start: at('2026-11-01', '14:00'),
  end: at('2026-11-01', '16:00'),
})

// "Add end time".
assert.deepEqual(addEnd({ start: at('2026-11-02', '06:00'), end: null }, 15 * MIN, now), { start: at('2026-11-02', '06:00'), end: at('2026-11-02', '06:15') })
assert.deepEqual(addEnd({ start: now, end: null }, 15 * MIN, now), { start: now - 15 * MIN, end: now }, 'a bottle that just finished')
assert.deepEqual(addEnd({ start: now - 5 * MIN, end: null }, 15 * MIN, now), { start: now - 5 * MIN, end: now })

// What makes sense.
assert.equal(checkRange({ start: now - H, end: now }, now), null)
assert.equal(checkRange({ start: now - H, end: now - H }, now), 'end-before-start')
assert.equal(checkRange({ start: now - H, end: now - 2 * H }, now), 'end-before-start')
assert.equal(checkRange({ start: now - H, end: now + FUTURE_MS }, now), null, 'five minutes ahead is fine')
assert.equal(checkRange({ start: now - H, end: now + FUTURE_MS + MIN }, now), 'end-future')
assert.equal(checkRange({ start: now + 10 * MIN, end: null }, now), 'start-future')
assert.equal(checkRange({ start: now - H, end: null }, now, { endRequired: true }), 'no-end')
assert.equal(checkRange({ start: now - H, end: null }, now), null)
const born = birthStart('2026-05-01', TZ)!
assert.equal(born, at('2026-05-01', '00:00'))
assert.equal(checkRange({ start: at('2026-04-30', '23:00'), end: null }, now, { earliest: born }), 'before-birth')
assert.equal(checkRange({ start: at('2026-05-01', '00:30'), end: null }, now, { earliest: born }), null)
assert.equal(birthStart(null, TZ), null)

// Breastfeeding sides against the feed.
assert.equal(sidesTooLong(12 * 60, 8 * 60, 20 * MIN), false)
assert.equal(sidesTooLong(12 * 60, 8 * 60, 15 * MIN), true)
assert.equal(sidesTooLong(10 * 60 + 30, 10 * 60 + 20, 20 * MIN), false, 'rounding slack')
assert.equal(sidesTooLong(0, 0, 0), false)

// How long a new past entry starts out.
const last = (start: number, end: number | null, extra: Partial<LeelaEvent> = {}) => ({ started_at: new Date(start).toISOString(), ended_at: end === null ? null : new Date(end).toISOString(), timer_state: null, ...extra }) as LeelaEvent
assert.equal(usualLength('nursing', last(now - 22 * MIN, now)), 22 * MIN)
assert.equal(usualLength('nursing'), 15 * MIN)
assert.equal(usualLength('solids'), 20 * MIN)
assert.equal(usualLength('sleep', last(now - 10 * H, now)), H, 'a sleep starts at an hour, not last night’s length')
assert.equal(usualLength('pump', last(now - 6 * H, now)), 15 * MIN, 'an odd one is ignored')
assert.equal(usualLength('bottle', last(now, null)), 15 * MIN)

console.log('timerange: all good')
