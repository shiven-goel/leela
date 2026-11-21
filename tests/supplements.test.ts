// Run with: npx tsx tests/supplements.test.ts
import assert from 'node:assert/strict'
import { doseText, givenToday, readSupplements, vitaminsSub } from '../src/lib/supplements'
import type { LeelaEvent } from '../src/lib/types'

const TZ = 'Asia/Kolkata'
const at = (d: string, hhmm: string) => Date.parse(`${d}T${hhmm}:00+05:30`)
const med = (start: number, name: string, extra: Partial<LeelaEvent> = {}): LeelaEvent => ({
  id: `m${start}${name}`, family_id: 'f', child_id: 'c', type: 'medicine', started_at: new Date(start).toISOString(), ended_at: null, timer_state: null,
  data: { name, supplement: true }, photo_paths: [], notes: null, source: 'app', import_id: null, created_by: 'u', updated_by: 'u', created_at: '', updated_at: '', deleted_at: null, ...extra,
})

// Reading the list: bad rows and duplicates are dropped.
const list = readSupplements({ supplements: [{ id: 'd', name: 'Vitamin D', dose: '1', unit: 'drops' }, { id: 'i', name: ' Iron ', dose: '0.5', unit: 'ml' }, { id: 'd', name: 'Again' }, { name: 'No id' }, 'junk'] })
assert.deepEqual(list.map((s) => s.name), ['Vitamin D', 'Iron'])
assert.deepEqual(readSupplements(null), [])
assert.deepEqual(readSupplements({ supplements: 'x' }), [])

// Doses read naturally.
assert.equal(doseText(list[0]), '1 drop')
assert.equal(doseText({ dose: '2', unit: 'drops' }), '2 drops')
assert.equal(doseText({ dose: '0.5', unit: 'ml' }), '0.5 ml')
assert.equal(doseText({}), '')

// Given today: same name in any case, today in India time only, not deleted, not another baby's.
const now = at('2026-11-21', '20:00')
const events = [
  med(at('2026-11-20', '23:50'), 'Vitamin D'), // yesterday
  med(at('2026-11-21', '09:10'), 'vitamin d'),
  med(at('2026-11-21', '10:00'), 'Iron', { deleted_at: 'x' }),
  med(at('2026-11-21', '10:05'), 'Iron', { child_id: 'other' }),
]
assert.equal(givenToday(events, 'c', list[0], now, TZ)?.started_at, new Date(at('2026-11-21', '09:10')).toISOString())
assert.equal(givenToday(events, 'c', list[1], now, TZ), undefined)
// Just after midnight, yesterday's doses no longer count.
assert.equal(givenToday(events, 'c', list[0], at('2026-11-22', '00:05'), TZ), undefined)

// The line under the Vitamins button.
const given = (names: string[]) => (s: { name: string }) => names.includes(s.name)
assert.equal(vitaminsSub([], given([])), 'Vitamin D, iron…')
assert.equal(vitaminsSub(list, given([])), '0 of 2 today')
assert.equal(vitaminsSub(list, given(['Vitamin D'])), 'Iron left')
assert.equal(vitaminsSub(list, given(['Vitamin D', 'Iron'])), 'All given today')
assert.equal(vitaminsSub([list[0]], given([])), 'Vitamin D due')
assert.equal(vitaminsSub([list[0]], given(['Vitamin D'])), 'Vitamin D given')

console.log('supplements: all good')
