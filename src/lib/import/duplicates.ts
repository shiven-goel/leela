// Spotting entries that are already in Leela, for imports and for what notes suggest.
import { TYPES } from '../config'
import type { LeelaEvent } from '../types'
import type { Draft } from './parse'

const WINDOW_MS = { default: 10 * 60_000, sleep: 25 * 60_000 }

/** What makes two entries of a type the same thing: Calpol and Vitamin D five minutes apart are
 * two medicines, and "rolled over" isn't a repeat of "first steps". */
function sameThing(type: string, data: LeelaEvent['data']): string {
  const word = (v: unknown) => String(v ?? '').trim().toLowerCase()
  switch (type) {
    case 'milestone':
    case 'activity':
      return word(data.kind ?? data.label)
    case 'medicine':
      return word(data.name)
    case 'symptom':
      return `${word(data.kind)}|${word(data.vaccine)}`
    default:
      return ''
  }
}

/** Flags drafts that match an entry already logged (same kind, within minutes) or repeat each other. */
export function markDuplicates(drafts: Draft[], existing: LeelaEvent[], childId: string): Draft[] {
  const byType = new Map<string, number[]>()
  for (const e of existing) {
    if (e.deleted_at) continue
    if (!TYPES[e.type]?.familyLevel && e.child_id !== childId) continue
    const key = `${e.type}|${sameThing(e.type, e.data)}`
    const list = byType.get(key) ?? []
    list.push(Date.parse(e.started_at))
    byType.set(key, list)
  }
  for (const list of byType.values()) list.sort((a, b) => a - b)
  const near = (list: number[] | undefined, t: number, w: number) => {
    if (!list?.length) return false
    let lo = 0
    let hi = list.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (list[mid] < t - w) lo = mid + 1
      else if (list[mid] > t + w) hi = mid - 1
      else return true
    }
    return false
  }
  const seen = new Set<string>()
  return drafts.map((d) => {
    const w = d.type === 'sleep' ? WINDOW_MS.sleep : WINDOW_MS.default
    const sig = `${d.type}|${Math.round(d.start / 60_000)}|${JSON.stringify(d.data)}`
    const dup = near(byType.get(`${d.type}|${sameThing(d.type, d.data)}`), d.start, w) || seen.has(sig)
    seen.add(sig)
    if (!dup) return { ...d, flags: d.flags.filter((f) => f !== 'duplicate') }
    return { ...d, include: false, flags: [...new Set([...d.flags, 'duplicate' as const])] }
  })
}
