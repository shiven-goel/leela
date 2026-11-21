// Run with: npx tsx tests/solids.test.ts
import assert from 'node:assert/strict'
import { ALLERGENS, foodsTried, watching } from '../src/lib/solids'
import type { LeelaEvent } from '../src/lib/types'

const meal = (d: string, foods: string[], reaction?: 'liked' | 'disliked'): LeelaEvent => ({
  id: `${d}${foods}`, family_id: 'f', child_id: 'c', type: 'solids', started_at: `2027-01-${d}T09:00:00+05:30`, ended_at: null, timer_state: null,
  data: { foods: foods.map((name) => ({ name })), reaction }, photo_paths: [], notes: null, source: 'app', import_id: null, created_by: 'u', updated_by: 'u', created_at: '', updated_at: '', deleted_at: null,
})
const foods = foodsTried([meal('18', ['Mashed banana'], 'liked'), meal('19', ['mashed banana', 'Dahi']), meal('21', ['Egg yolk'], 'disliked')], 'c')
assert.deepEqual(foods.map((f) => [f.name, f.times]), [['Egg yolk', 1], ['Mashed banana', 2], ['Dahi', 1]])
assert.deepEqual(foods.find((f) => f.name === 'Dahi')!.allergens, ['dairy'])
assert.deepEqual(foods.find((f) => f.name === 'Egg yolk')!.allergens, ['egg'])
assert.equal(foods.find((f) => f.name === 'Mashed banana')!.liked, 1)
assert.deepEqual(watching(foods, Date.parse('2027-01-22T09:00:00+05:30')).map((f) => f.name), ['Egg yolk'])
assert.equal(ALLERGENS.find((a) => a.id === 'wheat')!.words.test('Suji kheer'), true)
assert.equal(ALLERGENS.find((a) => a.id === 'peanut')!.words.test('Pear puree'), false)
console.log('solids: all good')
