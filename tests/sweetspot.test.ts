// Run with: npx tsx tests/sweetspot.test.ts
import assert from 'node:assert/strict'
import { feedForecast, phase, sweetSpot } from '../src/lib/sweetspot'
import type { Child, LeelaEvent } from '../src/lib/types'

const TZ = 'Asia/Kolkata'
const fam = { timezone: TZ, night_start: '19:00', night_end: '07:00' }
const DAY0 = '2026-11-01'
const MIN = 60_000

/** A moment on a day relative to 1 Nov 2026, in India time. */
function at(dayOffset: number, hhmm: string): number {
  const d = new Date(Date.parse(`${DAY0}T00:00:00Z`) + dayOffset * 86_400_000).toISOString().slice(0, 10)
  return Date.parse(`${d}T${hhmm}:00+05:30`)
}
const clock = (t: number) => new Date(t).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })

let seq = 0
function ev(type: LeelaEvent['type'], start: number, end: number | null, extra: Partial<LeelaEvent> = {}): LeelaEvent {
  return {
    id: `e${++seq}`, family_id: 'f', child_id: 'c', type, started_at: new Date(start).toISOString(), ended_at: end === null ? null : new Date(end).toISOString(),
    timer_state: null, data: {}, photo_paths: [], notes: null, source: 'app', import_id: null, created_by: 'u', updated_by: 'u', created_at: '', updated_at: '', deleted_at: null, ...extra,
  }
}
const sleep = (s: number, e: number | null, kind?: 'nap' | 'night') => ev('sleep', s, e, { data: kind ? { kind } : {}, timer_state: e === null ? 'running' : null })
const baby = (birth: string, settings: Record<string, unknown> = {}): Child => ({ id: 'c', family_id: 'f', name: 'Asha', birth_date: birth, due_date: null, sex: 'female', avatar_path: null, settings, created_at: '', deleted_at: null })

/** A six-month-old's steady week: up at 7, naps at 9:10, 12:40 and 16:10, in bed at 7:15. */
function steadyWeek(): LeelaEvent[] {
  const out: LeelaEvent[] = []
  for (let d = -8; d <= -1; d++) {
    out.push(sleep(at(d - 1, '19:15'), at(d, '07:00')))
    out.push(sleep(at(d, '09:10'), at(d, '10:10')))
    out.push(sleep(at(d, '12:40'), at(d, '13:40')))
    out.push(sleep(at(d, '16:10'), at(d, '16:50')))
  }
  out.push(sleep(at(-1, '19:15'), at(0, '07:00')))
  return out
}
const SIX_MONTHS = baby('2026-05-01')
const near = (t: number | undefined, hhmm: string, tol = 10) => {
  assert.ok(t !== undefined, `expected about ${hhmm}, got nothing`)
  const diff = Math.abs(t! - at(Math.round((t! - at(0, '00:00')) / 86_400_000 - 0.49), hhmm)) / MIN
  assert.ok(diff <= tol, `expected about ${hhmm}, got ${clock(t!)}`)
}

// 1. A steady week: the next nap, the rest of the day and bedtime follow the baby's own rhythm.
{
  const events = [...steadyWeek(), sleep(at(0, '09:10'), at(0, '10:10'))]
  const s = sweetSpot(events, SIX_MONTHS, fam, at(0, '11:00'))
  assert.equal(s.status, 'ok')
  assert.equal(s.basis, 'logs')
  assert.equal(s.guide.label, '6 months')
  assert.equal(s.next?.kind, 'nap')
  assert.equal(s.next?.napNumber, 2)
  near(s.next?.center, '12:40')
  assert.ok(s.next!.start < s.next!.center && s.next!.end > s.next!.center, 'the window surrounds its centre')
  const nap3 = s.later.find((w) => w.kind === 'nap')
  near(nap3?.center, '16:10', 15)
  assert.equal(nap3?.lengthMin, 40)
  near(s.later.at(-1)?.center, '19:15', 15)
  assert.equal(s.later.at(-1)?.kind, 'bedtime')
  assert.equal(s.pattern.naps, 3)
  assert.ok(s.pattern.days >= 6, `learned from ${s.pattern.days} days`)
  assert.equal(phase(s.next!, at(0, '11:00')), 'soon')
  assert.equal(phase(s.next!, s.next!.center), 'now')
  assert.equal(phase(s.next!, s.next!.end + MIN), 'late')
}

// 2. Asleep for the night: wakes around the usual time.
{
  const events = [...steadyWeek(), sleep(at(0, '09:10'), at(0, '10:10')), sleep(at(0, '12:40'), at(0, '13:40')), sleep(at(0, '16:10'), at(0, '16:50')), sleep(at(0, '19:15'), null)]
  const s = sweetSpot(events, SIX_MONTHS, fam, at(0, '20:00'))
  assert.equal(s.status, 'night')
  near(s.wakeAround, '07:00')
  assert.ok(s.wakeAround! > at(0, '20:00'), 'tomorrow morning, not this morning')
}

// 3. No history yet: a four-month-old's first window comes from their age.
{
  const s = sweetSpot([sleep(at(-1, '19:30'), at(0, '07:00'))], baby('2026-07-01'), fam, at(0, '08:00'))
  assert.equal(s.status, 'ok')
  assert.equal(s.basis, 'age')
  assert.equal(s.guide.label, '4–5 months')
  assert.equal(clock(s.next!.center), '08:40') // 90–150 min range: the first window of the day is the shortest
  assert.equal(clock(s.next!.start), '08:30')
  assert.equal(clock(s.next!.end), '08:50')
}

// 4. Newborns get the newborn guide.
{
  const s = sweetSpot([sleep(at(0, '08:30'), at(0, '10:00'))], baby('2026-10-11'), fam, at(0, '10:10'))
  assert.equal(s.status, 'newborn')
  assert.equal(clock(s.next!.start), '10:30')
  assert.equal(clock(s.next!.end), '11:00')
}

// 5. A short nap brings the next one forward.
{
  const normal = sweetSpot([...steadyWeek(), sleep(at(0, '09:10'), at(0, '10:10'))], SIX_MONTHS, fam, at(0, '10:20'))
  const short = sweetSpot([...steadyWeek(), sleep(at(0, '09:10'), at(0, '09:35'))], SIX_MONTHS, fam, at(0, '10:00'))
  const gap = (x: typeof normal, woke: string) => (x.next!.center - at(0, woke)) / MIN
  assert.ok(gap(short, '09:35') < gap(normal, '10:10') - 15, `short nap: ${gap(short, '09:35')} min, normal ${gap(normal, '10:10')} min`)
}

// 6. The family's own settings: fixed naps, their own wake windows and a nudge.
{
  const kid = baby('2026-05-01', { sweetspot: { naps: 2, custom: { first: 150, middle: 180, last: 210 }, adjust: 15 } })
  const s = sweetSpot([sleep(at(-1, '19:30'), at(0, '07:00'))], kid, fam, at(0, '07:30'))
  assert.equal(s.basis, 'custom')
  assert.equal(s.napsPlanned, 2)
  assert.equal(clock(s.next!.center), '09:45') // 7:00 + 150 + 15
  assert.equal(s.later.filter((w) => w.kind === 'nap').length, 1)
}

// 7. Feeds every three hours: the next one is three hours after the last.
{
  const feeds: LeelaEvent[] = []
  for (let d = -2; d <= 0; d++) for (const t of ['07:00', '10:00', '13:00', '16:00']) if (d < 0 || t <= '13:00') feeds.push(ev('bottle', at(d, t), null, { data: { amount_ml: 150 } }))
  const f = feedForecast(feeds, SIX_MONTHS, fam, at(0, '14:00'), 184)
  assert.ok(f, 'a feed forecast')
  assert.equal(f!.basis, 'logs')
  assert.equal(f!.everyMin, 180)
  assert.equal(clock(f!.at), '16:00')
  // A top-up ten minutes later is the same feed.
  const f2 = feedForecast([...feeds, ev('bottle', at(0, '13:10'), null)], SIX_MONTHS, fam, at(0, '14:00'), 184)
  assert.equal(clock(f2!.at), '16:00')
  // Feeding right now: nothing to forecast.
  assert.equal(feedForecast([...feeds, ev('nursing', at(0, '13:55'), null, { timer_state: 'running' })], SIX_MONTHS, fam, at(0, '14:00'), 184), undefined)
}

// 8. After the last nap, the next sleep is bedtime.
{
  const events = [...steadyWeek(), sleep(at(0, '09:10'), at(0, '10:10')), sleep(at(0, '12:40'), at(0, '13:40')), sleep(at(0, '16:10'), at(0, '16:50'))]
  const s = sweetSpot(events, SIX_MONTHS, fam, at(0, '17:30'))
  assert.equal(s.next?.kind, 'bedtime')
  near(s.next?.center, '19:15', 15)
  assert.equal(s.later.length, 0)
}

// 9. Too late in the day for another full nap: bedtime instead.
{
  const events = [...steadyWeek(), sleep(at(0, '09:10'), at(0, '10:10')), sleep(at(0, '13:20'), at(0, '16:30'))]
  const s = sweetSpot(events, SIX_MONTHS, fam, at(0, '17:00'))
  assert.equal(s.next?.kind, 'bedtime', `got a ${s.next?.kind} at ${clock(s.next!.center)}`)
  near(s.next?.center, '19:00', 20)
}

// 10. Napping now: likely to wake after a usual-length nap, then the day goes on.
{
  const events = [...steadyWeek(), sleep(at(0, '09:10'), at(0, '10:10')), sleep(at(0, '12:40'), null)]
  const s = sweetSpot(events, SIX_MONTHS, fam, at(0, '13:00'))
  assert.equal(s.status, 'napping')
  near(s.wakeAround, '13:40')
  assert.equal(s.later[0].kind, 'nap')
  assert.equal(s.later.at(-1)?.kind, 'bedtime')
}

// 11. However the baby has been doing, predictions stay in the normal range for their age.
{
  const events: LeelaEvent[] = []
  for (let d = -7; d <= -1; d++) {
    events.push(sleep(at(d - 1, '20:00'), at(d, '06:00')))
    events.push(sleep(at(d, '11:30'), at(d, '12:30'))) // 5.5 hours up: far above 2–3 hours
  }
  events.push(sleep(at(-1, '20:00'), at(0, '06:00')))
  const s = sweetSpot(events, SIX_MONTHS, fam, at(0, '07:00'))
  const first = (s.next!.center - at(0, '06:00')) / MIN
  // One nap a day is how older babies sleep, so the next age band's range applies: 2½–3½ hours.
  assert.equal(s.guide.wake[1], 210)
  assert.ok(first <= 210 * 1.15 + 1 && first < 330, `first window ${first} min`)
}

// 12. Awake in the night: back to sleep, with the morning wake-up ahead.
{
  const events = [...steadyWeek(), sleep(at(0, '09:10'), at(0, '10:10')), sleep(at(0, '12:40'), at(0, '13:40')), sleep(at(0, '19:15'), at(0, '23:00'))]
  const s = sweetSpot(events, SIX_MONTHS, fam, at(0, '23:20'))
  assert.equal(s.status, 'night')
  near(s.wakeAround, '07:00')
}

// 13. Naps logged yesterday but no night or morning since: nothing to go on.
{
  const events = [sleep(at(-1, '09:00'), at(-1, '10:00')), sleep(at(-1, '13:00'), at(-1, '14:00'))]
  assert.equal(sweetSpot(events, SIX_MONTHS, fam, at(0, '08:30')).status, 'needs-sleep')
  assert.equal(sweetSpot([], SIX_MONTHS, fam, at(0, '08:30')).status, 'needs-sleep')
}

// 14. No birth date: Leela asks for it.
assert.equal(sweetSpot([], { ...SIX_MONTHS, birth_date: null }, fam, at(0, '08:30')).status, 'needs-birthday')

// 15. Asleep a little before the night window, after the day's naps: that's bedtime, not a nap.
{
  const events = [...steadyWeek(), sleep(at(0, '09:10'), at(0, '10:10')), sleep(at(0, '12:40'), at(0, '13:40')), sleep(at(0, '16:10'), at(0, '16:50')), sleep(at(0, '18:30'), null)]
  assert.equal(sweetSpot(events, SIX_MONTHS, fam, at(0, '18:45')).status, 'night')
}

// 16. A three-year-old who has stopped napping: just bedtime, at their usual time.
{
  const events: LeelaEvent[] = []
  for (let d = -6; d <= 0; d++) events.push(sleep(at(d - 1, '19:45'), at(d, '06:45')))
  const s = sweetSpot(events, baby('2023-06-01'), fam, at(0, '12:00'))
  assert.equal(s.napsPlanned, 0)
  assert.equal(s.next?.kind, 'bedtime')
  near(s.next?.center, '19:45', 10)
}

// 17. Changing the bedtime setting moves bedtime.
{
  const kid = baby('2026-05-01', { sweetspot: { bedtime: '20:30' } })
  const events = [sleep(at(-1, '20:30'), at(0, '07:00')), sleep(at(0, '09:10'), at(0, '10:10')), sleep(at(0, '12:40'), at(0, '13:40')), sleep(at(0, '16:10'), at(0, '16:50'))]
  const s = sweetSpot(events, kid, fam, at(0, '17:00'))
  assert.equal(s.next?.kind, 'bedtime')
  assert.ok(s.next!.center >= at(0, '19:30'), `bedtime ${clock(s.next!.center)}`)
}

// 18. Bad settings are ignored rather than breaking the forecast.
{
  const kid = baby('2026-05-01', { sweetspot: { naps: 'lots', bedtime: '7pm', adjust: 9999, custom: { first: -5 } } })
  const s = sweetSpot([sleep(at(-1, '19:30'), at(0, '07:00'))], kid, fam, at(0, '07:30'))
  assert.deepEqual(s.settings, {})
  assert.equal(s.status, 'ok')
}

console.log('sweetspot: all good')
