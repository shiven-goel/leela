// Run with: npx tsx tests/duplicates.test.ts
import assert from 'node:assert/strict'
import { markDuplicates } from '../src/lib/import/duplicates'
import type { Draft } from '../src/lib/import/parse'
import type { LeelaEvent } from '../src/lib/types'

const t0 = Date.parse('2026-11-01T08:00:00Z')
const ev = (type: LeelaEvent['type'], minutes: number, data: LeelaEvent['data']): LeelaEvent => ({
  id: `${type}-${minutes}`, family_id: 'f', child_id: 'c', type, started_at: new Date(t0 + minutes * 60_000).toISOString(), ended_at: null,
  timer_state: null, data, photo_paths: [], notes: null, source: 'app', import_id: null, created_by: 'u', updated_by: 'u', created_at: '', updated_at: '', deleted_at: null,
})
const draft = (key: string, type: Draft['type'], minutes: number, data: Draft['data']): Draft => ({ key, type, start: t0 + minutes * 60_000, end: null, data, notes: null, source: '', line: 1, include: true, flags: [] })
const existing = [ev('milestone', 0, { kind: 'steps' }), ev('medicine', 0, { name: 'Calpol', dose: '5', unit: 'ml' }), ev('diaper', 0, { kind: 'wet' }), ev('symptom', 0, { kind: 'vaccine', vaccine: 'MMR' })]
const out = markDuplicates(
  [
    draft('rolled over', 'milestone', 3, { kind: 'roll' }),
    draft('first steps again', 'milestone', 4, { kind: 'steps' }),
    draft('vitamin d', 'medicine', 5, { name: 'Vitamin D', dose: '1', unit: 'ml' }),
    draft('calpol again', 'medicine', 6, { name: 'calpol', dose: '5', unit: 'ml' }),
    draft('diaper', 'diaper', 5, { kind: 'dirty' }),
    draft('varicella', 'symptom', 2, { kind: 'vaccine', vaccine: 'Varicella' }),
    draft('mmr again', 'symptom', 2, { kind: 'vaccine', vaccine: 'mmr' }),
    draft('steps later', 'milestone', 30, { kind: 'steps' }),
  ],
  existing,
  'c',
)
const dup = Object.fromEntries(out.map((d) => [d.key, d.flags.includes('duplicate')]))
assert.deepEqual(dup, {
  'rolled over': false, // a different first
  'first steps again': true, // the same first, minutes apart
  'vitamin d': false, // a different medicine
  'calpol again': true, // the same medicine again
  diaper: true, // diapers minutes apart are the same change
  varicella: false, // a second vaccine at the same visit
  'mmr again': true, // the same vaccine again
  'steps later': false, // half an hour later is a new entry
})
console.log('duplicates: all good')
