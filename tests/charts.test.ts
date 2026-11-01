// Run with: npx tsx tests/charts.test.ts
import assert from 'node:assert/strict'
import { dailyStats, growthPoints, lmsAt, marksBetween, percentileOf, valueAtZ, weekColumns, zOf } from '../src/lib/charts'
import type { Child, LeelaEvent } from '../src/lib/types'

const TZ = 'Asia/Kolkata'
const fam = { timezone: TZ, night_start: '19:00', night_end: '07:00' }
const at = (day: string, hhmm: string) => Date.parse(`${day}T${hhmm}:00+05:30`)
let n = 0
const ev = (type: LeelaEvent['type'], s: number, e: number | null, data: LeelaEvent['data'] = {}, extra: Partial<LeelaEvent> = {}): LeelaEvent => ({
  id: `e${n++}`, family_id: 'f', child_id: 'c', type, started_at: new Date(s).toISOString(), ended_at: e === null ? null : new Date(e).toISOString(), timer_state: null, data, photo_paths: [], notes: null, source: 'app', import_id: null, created_by: 'u', updated_by: 'u', created_at: '', updated_at: '', deleted_at: null, ...extra,
})
const events = [
  ev('sleep', at('2026-10-30', '19:30'), at('2026-10-31', '06:30')), // night, crosses midnight
  ev('sleep', at('2026-10-31', '09:00'), at('2026-10-31', '10:00')), // nap
  ev('bottle', at('2026-10-31', '08:00'), null, { amount_ml: 120 }),
  ev('nursing', at('2026-10-31', '12:00'), null, { left_s: 600, right_s: 300 }),
  ev('diaper', at('2026-10-31', '08:05'), null, { kind: 'mixed' }),
  ev('medicine', at('2026-10-31', '09:30'), null, { name: 'Vitamin D' }),
  ev('note', at('2026-10-31', '11:00'), null, { body: 'hi' }),
  ev('pump', at('2026-10-31', '13:00'), at('2026-10-31', '13:20'), { total_ml: 90 }, { child_id: null, created_by: 'someone-else' }),
  ev('diaper', at('2026-10-31', '15:00'), null, { kind: 'wet' }, { deleted_at: '2026-10-31T10:00:00Z' }),
]
const now = at('2026-11-01', '12:00')

// A column runs 7 AM to 7 AM: the night of the 30th sits whole at the bottom of the 30th.
const cols = weekColumns(events, [], 'c', 'u', fam, at('2026-11-01', '00:00'), 7, '07:00', now)
assert.equal(cols.length, 7)
const col30 = cols.find((c) => new Date(c.day).toISOString().startsWith('2026-10-29T18:30'))!
assert.ok(col30, 'a column for 30 October')
const night = col30.marks.find((m) => m.kind === 'night')!
assert.equal(night.start, at('2026-10-30', '19:30'))
assert.equal(night.end, at('2026-10-31', '06:30'))
const col31 = cols[cols.length - 2]
const kinds = col31.marks.map((m) => `${m.type}:${m.kind}`)
assert.deepEqual(kinds.sort(), ['bottle:feed', 'diaper:diaper', 'medicine:health', 'nursing:feed', 'sleep:nap'].sort(), kinds.join())
// A breastfeed logged with sides lasts as long as its sides.
const nurse = col31.marks.find((m) => m.type === 'nursing')!
assert.equal(nurse.end - nurse.start, 900_000)
// Sleep draws first so feeds and diapers sit on top of it.
assert.equal(col31.marks[0].kind, 'nap')
// Another person's pumping isn't on this person's chart; clipping keeps marks inside the window.
assert.ok(!col31.marks.some((m) => m.type === 'pump'))
const clipped = marksBetween(events, [], 'c', 'u', fam, at('2026-10-31', '00:00'), at('2026-10-31', '03:00'), now)
assert.equal(clipped[0].start, at('2026-10-31', '00:00'))

// Day totals agree with the app's counting: midnight to midnight.
const [d31] = dailyStats(events, [], 'c', fam, [at('2026-10-31', '00:00')], now)
assert.equal(d31.totals.sleepMs, 7.5 * 3_600_000) // 6.5 h of the night after midnight + the 1 h nap
assert.equal(d31.totals.feeds, 2)
assert.equal(d31.totals.bottleMl, 120)
assert.equal(d31.leftMin, 10)
assert.equal(d31.rightMin, 5)
assert.equal(d31.totals.wet, 1)
assert.equal(d31.totals.dirty, 1)
assert.equal(d31.totals.meds, 1)

// WHO growth: published medians and the z-score round trip.
const boys6 = lmsAt('weight', 'male', 6)!
assert.equal(valueAtZ(boys6, 0).toFixed(1), '7.9')
assert.equal(valueAtZ(boys6, 2).toFixed(1), '9.8')
assert.equal(valueAtZ(lmsAt('length', 'female', 12)!, 0).toFixed(1), '74.0')
assert.equal(valueAtZ(lmsAt('head', 'male', 0)!, 0).toFixed(1), '34.5')
assert.ok(Math.abs(zOf(boys6, valueAtZ(boys6, 1.3)) - 1.3) < 1e-9)
assert.equal(Math.round(percentileOf(1.8808)), 97)
assert.equal(Math.round(percentileOf(-1.0364)), 15)
assert.equal(lmsAt('weight', null, 6), null)
assert.equal(lmsAt('weight', 'male', 61), null)

const kid: Child = { id: 'c', family_id: 'f', name: 'Ravi', birth_date: '2026-05-01', due_date: null, sex: 'male', avatar_path: null, settings: {}, created_at: '', deleted_at: null }
const g = growthPoints([ev('growth', Date.parse('2026-11-01T10:00:00+05:30'), null, { weight_kg: 7.9, length_cm: 67.6 })], kid, 'weight')
assert.equal(g.length, 1)
assert.ok(Math.abs(g[0].percentile! - 50) < 5, `about the 50th percentile, got ${g[0].percentile}`)
// Babies born early use corrected age until two.
const early = growthPoints([ev('growth', Date.parse('2026-11-01T10:00:00+05:30'), null, { weight_kg: 7.9 })], { ...kid, due_date: '2026-06-01' }, 'weight')
assert.ok(early[0].months < g[0].months - 0.9, 'corrected age is a month younger')

console.log('charts: all good')
