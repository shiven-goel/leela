// Run with: npx tsx tests/alerts.test.ts
// Vaccines, medicine reminders and the evening summary (src/lib/vaccines.ts, src/lib/alerts.ts).
// The phone is set to New York while the family is in India: everything follows the family's clock.
process.env.TZ = 'America/New_York'
import assert from 'node:assert/strict'
import { dayCounts, localMidnight, localMinute, medicinesDue, readAlerts, summaryText } from '../src/lib/alerts'
import { SCHEDULE, inDaysText, localDay, nextVisit, vaccinePlan, vaccineReminder, visitDueDate } from '../src/lib/vaccines'

const TZ = 'Asia/Kolkata'
const H = 3_600_000
const ev = (id: string, type: string, started: string, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  child_id: 'c',
  started_at: new Date(Date.parse(started)).toISOString(),
  ended_at: null as string | null,
  timer_state: null as string | null,
  deleted_at: null as string | null,
  data,
  ...extra,
})

// ---------------------------------------------------------------- schedule dates
const visit = (id: string) => SCHEDULE.find((v) => v.id === id)!
assert.equal(visitDueDate(visit('w6'), '2026-08-20'), '2026-10-01')
assert.equal(visitDueDate(visit('m6'), '2026-08-31'), '2027-02-28') // no 31 February
assert.equal(visitDueDate(visit('y2'), '2024-02-29'), '2026-02-28')
// Every dose id is unique.
const ids = SCHEDULE.flatMap((v) => v.doses.map((d) => d.id))
assert.equal(new Set(ids).size, ids.length)

// ---------------------------------------------------------------- the plan
const child = { id: 'c', birth_date: '2026-08-20', settings: { vaccines: { dates: { w14: '2026-12-01' }, skip: ['rota3'], before: ['bcg', 'opv0', 'hepb1'] } } }
const given = [ev('v1', 'symptom', '2026-10-02T11:00:00+05:30', { kind: 'vaccine', vax: ['dtp1', 'ipv1', 'hib1', 'hepb2', 'rota1', 'pcv1'] })]
const plan = vaccinePlan(child, given, '2026-11-21')
assert.equal(plan.find((p) => p.visit.id === 'birth')!.done, true) // given before Leela
assert.equal(plan.find((p) => p.visit.id === 'w6')!.done, true)
const w10 = plan.find((p) => p.visit.id === 'w10')!
assert.equal(w10.done, false)
assert.equal(w10.inDays, -23)
const w14 = plan.find((p) => p.visit.id === 'w14')!
assert.equal(w14.due, '2026-12-01')
assert.equal(w14.moved, true)
assert.ok(!w14.left.some((d) => d.id === 'rota3')) // not having it
assert.equal(nextVisit(plan)!.visit.id, 'w10') // overdue first
// A deleted entry doesn't count.
assert.equal(vaccinePlan(child, [{ ...given[0], deleted_at: '2026-10-03T00:00:00Z' }], '2026-11-21').find((p) => p.visit.id === 'w6')!.done, false)
// No birth date: no plan.
assert.deepEqual(vaccinePlan({ id: 'c', birth_date: null }, [], '2026-11-21'), [])

// Reminders two days before and on the day only.
assert.equal(vaccineReminder(vaccinePlan(child, given, '2026-11-28'), 'Leela'), null)
const r2 = vaccineReminder(vaccinePlan({ ...child, settings: { vaccines: { ...child.settings.vaccines, dates: { w10: '2026-11-30', w14: '2026-12-01' } } } }, given, '2026-11-28'), 'Leela')!
assert.equal(r2.title, 'Leela’s vaccines are due in 2 days')
assert.ok(r2.body.startsWith('10 weeks:'))
assert.ok(r2.slot.length <= 60)

assert.equal(inDaysText(0), 'today')
assert.equal(inDaysText(1), 'tomorrow')
assert.equal(inDaysText(5), 'in 5 days')
assert.equal(inDaysText(-3), '3 days ago')

// ---------------------------------------------------------------- the family's clock
const t = Date.parse('2026-11-21T04:00:00Z') // 9:30 am in India
assert.equal(localDay(t, TZ), '2026-11-21')
assert.equal(localMinute(t, TZ), 570)
assert.equal(new Date(localMidnight(t, TZ)).toISOString(), '2026-11-20T18:30:00.000Z')
assert.equal(localDay(Date.parse('2026-11-20T19:00:00Z'), TZ), '2026-11-21') // after midnight there

// ---------------------------------------------------------------- medicine
const meds = [
  ev('m0', 'medicine', '2026-11-21T00:30:00+05:30', { name: 'calpol', dose: '2.5', unit: 'ml', every_h: 6 }),
  ev('m1', 'medicine', '2026-11-21T06:30:00+05:30', { name: 'Calpol', dose: '2.5', unit: 'ml', every_h: 6 }),
  ev('m2', 'medicine', '2026-11-21T08:00:00+05:30', { name: 'Vitamin D', dose: '1', unit: 'ml' }),
  ev('m3', 'medicine', '2026-11-21T08:00:00+05:30', { name: 'Zinc', every_h: 24 }, { deleted_at: '2026-11-21T03:00:00Z' }),
]
const due = medicinesDue(meds, 'c')
assert.equal(due.length, 1) // only the latest Calpol; Vitamin D has no reminder; Zinc was deleted
assert.equal(due[0].eventId, 'm1')
assert.equal(due[0].dueAt, Date.parse('2026-11-21T12:30:00+05:30'))
assert.equal(due[0].dose, '2.5 ml')
// Logging the next dose without a reminder stops them.
assert.equal(medicinesDue([...meds, ev('m4', 'medicine', '2026-11-21T12:40:00+05:30', { name: 'CALPOL ', dose: '2.5', every_h: null })], 'c').length, 0)

// ---------------------------------------------------------------- the day so far
const from = localMidnight(t, TZ)
const day = [
  ev('s1', 'sleep', '2026-11-20T20:00:00+05:30', {}, { ended_at: '2026-11-21T06:00:00+05:30' }), // 6 h after midnight
  ev('s2', 'sleep', '2026-11-21T09:00:00+05:30', {}, { timer_state: 'running' }), // 30 min so far
  ev('n1', 'nursing', '2026-11-21T06:10:00+05:30'),
  ev('b1', 'bottle', '2026-11-21T08:00:00+05:30', { amount_ml: 90 }),
  ev('d1', 'diaper', '2026-11-21T06:20:00+05:30', { kind: 'mixed' }),
  ev('d2', 'diaper', '2026-11-21T08:20:00+05:30', { kind: 'wet' }),
  ev('d0', 'diaper', '2026-11-20T23:00:00+05:30', { kind: 'wet' }), // yesterday
  ...meds,
]
const c = dayCounts(day, 'c', from, t)
assert.equal(c.sleepMs, 6.5 * H)
assert.equal(c.sleeps, 1)
assert.equal(c.feeds, 2)
assert.equal(c.bottleMl, 90)
assert.deepEqual([c.nappies, c.wet, c.dirty], [2, 2, 1])
assert.equal(c.meds, 3) // m0, m1, m2 (m3 deleted)
const text = summaryText('Leela', c)
assert.equal(text.title, 'Leela’s day so far')
assert.equal(text.body, 'Slept 6 h 30 m · 2 feeds: 1 breastfeed, 1 bottle (90 ml) · 2 nappies (2 wet, 1 dirty) · 3 medicine doses.')

// ---------------------------------------------------------------- choices
assert.deepEqual(readAlerts({}), { sweetspot: true, medicine: true, vaccines: true, summary: true, summaryAt: '20:30', pump: false })
assert.equal(readAlerts({ alerts: { summaryAt: '25:00' } }).summaryAt, '20:30')
assert.equal(readAlerts({ alerts: { medicine: false } }).medicine, false)

console.log('alerts: all good')
