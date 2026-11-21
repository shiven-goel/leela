// Starting solids: every food tried so far, the common allergens, the wait after a new food and
// readiness before six months. Food names are free text, so allergens are recognised by word.
import type { LeelaEvent } from './types'

export const ALLERGENS: { id: string; label: string; words: RegExp }[] = [
  { id: 'egg', label: 'Egg', words: /\b(egg|eggs|anda|omelette)\b/i },
  { id: 'dairy', label: 'Milk products', words: /\b(milk|curd|dahi|yogh?urt|paneer|cheese|kheer|lassi)\b/i },
  { id: 'wheat', label: 'Wheat', words: /\b(wheat|atta|roti|chapati|phulka|suji|sooji|semolina|daliya|dalia|bread|upma)\b/i },
  { id: 'peanut', label: 'Peanut', words: /\b(peanuts?|groundnuts?|moong ?phali|mungfali)\b/i },
  { id: 'nuts', label: 'Tree nuts', words: /\b(almonds?|badam|cashews?|kaju|walnuts?|akhrot|pistachios?|pista)\b/i },
  { id: 'soy', label: 'Soy', words: /\b(soya?|tofu)\b/i },
  { id: 'sesame', label: 'Sesame', words: /\b(sesame|til)\b/i },
  { id: 'fish', label: 'Fish', words: /\b(fish|machli|machhli|salmon|rohu)\b/i },
  { id: 'shellfish', label: 'Shellfish', words: /\b(prawns?|shrimps?|crabs?|jhinga)\b/i },
]

export const READY_SIGNS: { id: string; label: string }[] = [
  { id: 'sits', label: 'Sits up with a little support and holds her head steady' },
  { id: 'interest', label: 'Watches you eat and reaches for food' },
  { id: 'mouth', label: 'Opens her mouth when a spoon comes near' },
  { id: 'swallow', label: 'Keeps food in and swallows instead of pushing it out' },
]

/** Common first foods in Indian homes, for ideas (not advice: the doctor knows her best). */
export const FIRST_FOODS = ['Mashed banana', 'Rice khichdi', 'Moong dal khichdi', 'Ragi porridge', 'Mashed sweet potato', 'Apple puree', 'Mashed carrot', 'Pear puree', 'Mashed avocado', 'Suji kheer']

export interface Food {
  name: string
  times: number
  first: number
  last: number
  liked: number
  disliked: number
  allergens: string[]
  /** Any reaction or note logged with it. */
  notes: string[]
}

const reactionOf = (e: LeelaEvent) => e.data.reaction

export function foodsTried(events: LeelaEvent[], childId: string): Food[] {
  const by = new Map<string, Food>()
  for (const e of events) {
    if (e.deleted_at || e.type !== 'solids' || e.child_id !== childId) continue
    const at = Date.parse(e.started_at)
    for (const f of e.data.foods ?? []) {
      const k = f.name.trim().toLowerCase()
      if (!k) continue
      const cur = by.get(k) ?? { name: f.name.trim(), times: 0, first: at, last: at, liked: 0, disliked: 0, allergens: [], notes: [] }
      cur.times++
      cur.first = Math.min(cur.first, at)
      cur.last = Math.max(cur.last, at)
      if (reactionOf(e) === 'liked') cur.liked++
      if (reactionOf(e) === 'disliked') cur.disliked++
      for (const a of ALLERGENS) if (a.words.test(f.name) && !cur.allergens.includes(a.id)) cur.allergens.push(a.id)
      if (f.allergen && !cur.allergens.length) cur.allergens.push('other')
      if (e.notes) cur.notes.push(e.notes)
      by.set(k, cur)
    }
  }
  return [...by.values()].sort((a, b) => b.last - a.last)
}

/** Foods first tried in the last three days: the usual wait before the next new one. */
export function watching(foods: Food[], now: number): Food[] {
  return foods.filter((f) => now - f.first < 3 * 86_400_000)
}
