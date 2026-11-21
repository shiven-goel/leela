// Run with: npx tsx tests/history.test.ts
import assert from 'node:assert/strict'
import { bucketsOf, customPeriod, daysOf, grain, lifeMonths, makePeriod, periodLabel, previousPeriod, shiftPeriod } from '../src/lib/period'
import { activityKey, bucketValue, categoriesFor, categoryById, change, dayAggs, detailNote, detailStats, entriesOf, headline, medianClock, clockOf, usualHour } from '../src/lib/insights'
import type { LeelaEvent } from '../src/lib/types'

const TZ = 'Asia/Kolkata'
const fam = { timezone: TZ, night_start: '19:00', night_end: '07:00' }
const at = (d: string, hhmm = '00:00') => Date.parse(`${d}T${hhmm}:00+05:30`)
const now = at('2026-11-21', '15:00')
const birth = at('2026-07-18')

// ---------------------------------------------------------------------------- periods
{
  const day = makePeriod('day', now, TZ, birth, now)
  assert.equal(day.from, at('2026-11-21'))
  assert.equal(day.to, at('2026-11-22'))
  assert.equal(periodLabel(day, TZ, now), 'Today')
  assert.equal(periodLabel(shiftPeriod(day, -1, TZ, now), TZ, now), 'Yesterday')
  // Can't step into the future.
  assert.deepEqual(shiftPeriod(day, 1, TZ, now), day)

  const week = makePeriod('week', now, TZ, birth, now)
  assert.equal(week.from, at('2026-11-15'))
  assert.equal(periodLabel(week, TZ, now), 'Last 7 days')
  assert.equal(periodLabel(shiftPeriod(week, -1, TZ, now), TZ, now), '8 – 14 Nov')
  assert.equal(daysOf(week, TZ, now).length, 7)
  assert.equal(previousPeriod(week, TZ).from, at('2026-11-08'))

  const month = makePeriod('month', now, TZ, birth, now)
  assert.equal(month.from, at('2026-11-01'))
  assert.equal(month.to, at('2026-12-01'))
  assert.equal(periodLabel(month, TZ, now), 'November')
  assert.equal(daysOf(month, TZ, now).length, 21, 'only the days so far')
  assert.equal(periodLabel(shiftPeriod(month, -1, TZ, now), TZ, now), 'October')
  assert.equal(previousPeriod(month, TZ).from, at('2026-10-01'))

  const all = makePeriod('all', now, TZ, birth, now)
  assert.equal(all.from, birth)
  assert.equal(periodLabel(all, TZ, now, { birth: true }), 'Since birth')
  assert.equal(daysOf(all, TZ, now).length, 127)
  assert.equal(grain(all, TZ, now), 'week')

  const custom = customPeriod(at('2026-11-09', '13:00'), at('2026-10-03'), TZ)
  assert.equal(custom.from, at('2026-10-03'))
  assert.equal(custom.to, at('2026-11-10'))
  assert.equal(periodLabel(custom, TZ, now), '3 Oct – 9 Nov')
}

// Chart buckets: days up to five weeks, then weeks (the newest a whole week), then months.
{
  const week = bucketsOf(makePeriod('week', now, TZ, birth, now), TZ, now)
  assert.equal(week.length, 7)
  assert.equal(week[6].tick, 'Sa')
  const all = bucketsOf(makePeriod('all', now, TZ, birth, now), TZ, now)
  assert.equal(all.at(-1)!.from, at('2026-11-15'))
  assert.equal(all.at(-1)!.to, at('2026-11-22'))
  assert.equal(all[0].from, birth, 'the first week starts at birth')
  for (let i = 1; i < all.length; i++) assert.equal(all[i].from, all[i - 1].to, 'buckets touch')
  const year = bucketsOf(customPeriod(at('2025-11-01'), at('2026-11-21'), TZ), TZ, now)
  assert.equal(grain(customPeriod(at('2025-11-01'), at('2026-11-21'), TZ), TZ, now), 'month')
  assert.equal(year[0].tick, 'Nov')
  assert.equal(year.length, 13)
}

// Months of life: month 1 starts on the birthday.
{
  const ms = lifeMonths('2026-07-18', TZ, now)
  assert.equal(ms.length, 5)
  assert.equal(ms[0].period.from, birth)
  assert.equal(ms[3].period.from, at('2026-10-18'))
  assert.equal(ms[3].period.to, at('2026-11-18'))
}

// ---------------------------------------------------------------------------- figures
let seq = 0
const ev = (type: LeelaEvent['type'], start: number, end: number | null, data: LeelaEvent['data'] = {}, extra: Partial<LeelaEvent> = {}): LeelaEvent => ({
  id: `e${++seq}`, family_id: 'f', child_id: type === 'pump' ? null : 'c', type, started_at: new Date(start).toISOString(), ended_at: end === null ? null : new Date(end).toISOString(),
  timer_state: null, data, photo_paths: [], notes: null, source: 'import', import_id: null, created_by: 'u', updated_by: 'u', created_at: '', updated_at: '', deleted_at: null, ...extra,
})

const events: LeelaEvent[] = []
for (let i = 0; i < 7; i++) {
  const d = `2026-11-${String(15 + i).padStart(2, '0')}`
  events.push(ev('sleep', at(d, '02:00'), at(d, '10:00'))) // 8 h night
  events.push(ev('sleep', at(d, '13:00'), at(d, '15:00'))) // 2 h nap
  events.push(ev('nursing', at(d, '10:15'), at(d, '10:35'), { left_s: 600, right_s: 600 }))
  events.push(ev('bottle', at(d, '18:00'), at(d, '18:15'), { amount_ml: 90, contents: 'breast' }))
  events.push(ev('diaper', at(d, '10:40'), null, { kind: i % 2 ? 'wet' : 'mixed' }))
  // Imported baths have no length; two were timed.
  events.push(ev('activity', at(d, '11:00'), i < 2 ? at(d, '11:20') : null, { kind: 'bath' }))
  if (i % 3 === 0) events.push(ev('activity', at(d, '10:50'), null, { label: 'Massage' }))
}
events.push(ev('medicine', at('2026-11-20', '09:00'), null, { name: 'Vitamin D', supplement: true }))
events.push(ev('medicine', at('2026-11-21', '09:00'), null, { name: 'Vitamin D', supplement: true }))
events.push(ev('activity', at('2026-11-21', '12:00'), null, { kind: 'bath' }, { deleted_at: 'x' }))
events.push(ev('activity', at('2026-11-20', '12:00'), null, { kind: 'bath' }, { child_id: 'someone-else' }))

assert.equal(activityKey({ data: { label: 'Massage' } }), 'massage', 'an imported label matches the kind')
assert.equal(activityKey({ data: { label: 'Car ride' } }), 'label:Car ride')

const cats = categoriesFor(events, 'c', 'u')
assert.deepEqual(cats.map((c) => c.id), ['sleep', 'feeds', 'diaper', 'activity:bath', 'activity:massage', 'vitamins'])

const week = makePeriod('week', now, TZ, birth, now)
const days = daysOf(week, TZ, now)
const ds = dayAggs(events, [], 'c', 'u', fam, days, now)
const sleep = categoryById('sleep')!
const feeds = categoryById('feeds')!
const bath = categoryById('activity:bath')!
const massage = categoryById('activity:massage')!
const vit = categoryById('vitamins')!

// Today's sleep runs to 3 PM: 8 h + 2 h; every day the same, so 10 h a day.
assert.equal(headline(sleep, ds).value, '10h')
assert.equal(headline(sleep, ds).unit, 'a day')
assert.equal(headline(feeds, ds).value, '2')
assert.match(headline(feeds, ds).sub, /1 breast · 1 bottle \(90 ml\)/)
// Every bath counts, timed or not; others' and deleted ones don't.
assert.equal(headline(bath, ds).value, '7 times')
assert.match(headline(bath, ds).sub, /on 7 of 7 days · 20m each/)
assert.equal(headline(massage, ds).value, '3 times')
assert.equal(bucketValue(massage, ds), 3)
assert.match(detailNote(bath, ds)!, /2 of 7 were logged with a length/)
assert.equal(detailNote(massage, ds)?.includes('None were logged with a length'), true)
assert.equal(headline(vit, ds).value, '2 of 7')
assert.match(headline(vit, ds).sub, /Vitamin D 2\/7/)

const bathEntries = entriesOf(bath, events, 'c', 'u', week.from, week.to)
assert.equal(bathEntries.length, 7)
const stats = detailStats(bath, ds, bathEntries, TZ)
assert.deepEqual(stats.find((s) => s.label === 'Most often'), { label: 'Most often', value: '11 AM – 12 PM' })
assert.deepEqual(stats.find((s) => s.label === 'Usually lasts'), { label: 'Usually lasts', value: '20m' })

const sleepStats = detailStats(sleep, ds, entriesOf(sleep, events, 'c', 'u', week.from, week.to), TZ)
assert.deepEqual(sleepStats.find((s) => s.label === 'Night usually starts'), { label: 'Night usually starts', value: '2:00 AM' })
assert.deepEqual(sleepStats.find((s) => s.label === 'Up for the day'), { label: 'Up for the day', value: '10:00 AM' })

// Compared with the week before (nothing logged then): no comparison.
const before = dayAggs(events, [], 'c', 'u', fam, daysOf(previousPeriod(week, TZ), TZ, now), now)
assert.equal(change(sleep, ds, before), null)

// Bedtimes either side of midnight average sensibly.
assert.equal(clockOf(medianClock([at('2026-11-20', '23:30'), at('2026-11-21', '00:30'), at('2026-11-22', '01:00')], TZ)!), '12:30 AM')
assert.equal(usualHour([at('2026-11-20', '10:10')], TZ), null, 'too few to say')

console.log('history: all good')
