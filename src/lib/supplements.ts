// Daily vitamins and supplements: the family's list lives in children.settings.supplements and
// each one given is a Medicine entry (data.supplement true), so it shows on the timeline, in the
// doctor report and in Ghar like any other medicine.
import type { LeelaEvent } from './types'
import { dayKey } from './time'

export interface Supplement {
  id: string
  name: string
  /** What's given each time, as the family wrote it ("1", "0.5"). */
  dose?: string
  unit?: string
}

export const SUPPLEMENT_UNITS = ['drops', 'ml', 'mg', 'tablet', 'sachet'] as const

/** Common ones for babies, to add with one tap. Doses always come from the family. */
export const SUPPLEMENT_PRESETS: { name: string; unit: string }[] = [
  { name: 'Vitamin D', unit: 'drops' },
  { name: 'Iron', unit: 'ml' },
  { name: 'Multivitamin', unit: 'ml' },
  { name: 'Calcium', unit: 'ml' },
  { name: 'Probiotic', unit: 'drops' },
  { name: 'Zinc', unit: 'ml' },
]

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)

/** The baby's list, ignoring anything malformed. */
export function readSupplements(settings: Record<string, unknown> | null | undefined): Supplement[] {
  const raw = settings?.supplements
  if (!Array.isArray(raw)) return []
  const out: Supplement[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const name = str(o.name, 40)
    const id = str(o.id, 40)
    if (!name || !id || out.some((s) => s.id === id)) continue
    out.push({ id, name, dose: str(o.dose, 12), unit: str(o.unit, 12) })
  }
  return out.slice(0, 12)
}

export const sameName = (a: string | undefined, b: string | undefined) => Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase())

/** The latest entry today (in the family's time zone) for this supplement, if it's been given. */
export function givenToday(events: LeelaEvent[], childId: string, sup: Pick<Supplement, 'name'>, now: number, tz: string): LeelaEvent | undefined {
  const today = dayKey(now, tz)
  let best: LeelaEvent | undefined
  for (const e of events) {
    if (e.deleted_at || e.type !== 'medicine' || e.child_id !== childId || !sameName(e.data.name, sup.name)) continue
    if (Date.parse(e.started_at) > now + 60_000 || dayKey(e.started_at, tz) !== today) continue
    if (!best || e.started_at > best.started_at) best = e
  }
  return best
}

/** "Vitamin D · 1 drop", for lists and the timeline. */
export function doseText(s: Pick<Supplement, 'dose' | 'unit'>): string {
  if (!s.dose) return ''
  const one = Number(s.dose) === 1
  const unit = s.unit === 'drops' && one ? 'drop' : s.unit === 'tablet' && !one ? 'tablets' : s.unit === 'sachet' && !one ? 'sachets' : s.unit
  return [s.dose, unit].filter(Boolean).join(' ')
}

/** The line under the Vitamins button on Today. */
export function vitaminsSub(list: Supplement[], given: (s: Supplement) => boolean): string {
  if (!list.length) return 'Vitamin D, iron…'
  const left = list.filter((s) => !given(s))
  if (!left.length) return list.length === 1 ? `${list[0].name} given` : 'All given today'
  if (left.length === 1 && list.length > 1) return `${left[0].name} left`
  return list.length === 1 ? `${list[0].name} due` : `${list.length - left.length} of ${list.length} today`
}
