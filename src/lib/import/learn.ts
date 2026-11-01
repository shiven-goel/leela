// What Leela has learned about how this family writes, kept in each parent's profile so it
// follows them to every phone and helps the other parent's imports too.
import { savePrefs } from '../actions'
import { getState, myPrefs } from '../store'
import type { Vocab } from './vocab'

/** Everyone's words, with the current parent's own meaning winning on a clash. */
export function familyVocab(): Vocab {
  const s = getState()
  const out: Vocab = {}
  for (const m of s.members) {
    if (m.user_id === s.userId) continue
    Object.assign(out, s.profiles[m.user_id]?.prefs?.vocab ?? {})
  }
  return { ...out, ...(myPrefs().vocab ?? {}) }
}

export async function learnWords(words: Vocab): Promise<void> {
  if (!Object.keys(words).length) return
  await savePrefs({ vocab: { ...(myPrefs().vocab ?? {}), ...words } })
}

export async function forgetWord(term: string): Promise<void> {
  const next = { ...(myPrefs().vocab ?? {}) }
  delete next[term]
  await savePrefs({ vocab: next })
}

/** The baby's and the family's names: never asked about. */
export function namesToSkip(): string[] {
  const s = getState()
  return [...s.children.map((c) => c.name), ...Object.values(s.profiles).map((p) => p.display_name), s.family?.name ?? ''].filter(Boolean)
}
