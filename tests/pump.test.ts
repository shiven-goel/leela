// Run with: npx tsx tests/pump.test.ts
import assert from 'node:assert/strict'
import { pumpDue, readAlerts } from '../src/lib/alerts'

const TZ = 'Asia/Kolkata'
const at = (d: string, hhmm: string) => Date.parse(`2026-11-${d}T${hhmm}:00+05:30`)
let n = 0
const ev = (type: string, start: number, end: number | null, extra: Record<string, unknown> = {}) => ({
  id: `e${++n}`, type, child_id: type === 'pump' ? null : 'c', started_at: new Date(start).toISOString(), ended_at: end === null ? null : new Date(end).toISOString(), timer_state: null, deleted_at: null, data: {}, ...extra,
})

// A steady week: a breastfeed every 3 hours from 8 AM, 20 minutes each.
const events = []
for (let d = 14; d <= 20; d++) for (let h = 8; h <= 23; h += 3) events.push(ev('nursing', at(String(d), `${String(h).padStart(2, '0')}:00`), at(String(d), `${String(h).padStart(2, '0')}:20`)))
// Today: fed at 11, then pumped straight after (one emptying), ending 11:45.
events.push(ev('nursing', at('21', '11:00'), at('21', '11:20')))
events.push(ev('pump', at('21', '11:30'), at('21', '11:45')))

const p = pumpDue(events, at('21', '12:30'), TZ)!
assert.equal(p.lastKind, 'pump')
assert.equal(p.lastAt, at('21', '11:45'))
assert.equal(p.basis, 'logs')
// Her gaps are 2h 40m (from the end of one feed to the start of the next).
assert.equal(p.everyMin, 160)
assert.equal(p.dueAt, at('21', '14:25'))

// While feeding or pumping there's nothing to predict.
assert.equal(pumpDue([...events, ev('pump', at('21', '14:20'), null, { timer_state: 'running' })], at('21', '14:30'), TZ), null)
// Nothing recent: nothing to say.
assert.equal(pumpDue(events, at('21', '12:30') + 5 * 86_400_000, TZ), null)
// Too little logged: the usual 3 hours.
const few = pumpDue([ev('nursing', at('21', '10:00'), at('21', '10:15'))], at('21', '11:00'), TZ)!
assert.equal(few.basis, 'default')
assert.equal(few.dueAt, at('21', '13:15'))
// Off unless turned on.
assert.equal(readAlerts({}).pump, false)
assert.equal(readAlerts({ alerts: { pump: true } }).pump, true)

console.log('pump: all good')
