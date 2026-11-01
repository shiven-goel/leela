// Gathers everything since birth into the chapters of the printable diary book.
import { TZDate } from '@date-fns/tz'
import { MILESTONE_KINDS } from './config'
import { totalsFor, type Totals } from './counting'
import { eventTitle, noteBody } from './describe'
import type { Child, Family, LeelaEvent, TimerSegment } from './types'

export interface BookMemory {
  id: string
  kind: 'note' | 'milestone' | 'photo'
  at: string
  title: string
  text: string
  photos: string[]
}

export interface BookMonth {
  n: number
  from: number
  to: number
  days: number
  totals: Totals
  firsts: string[]
  newFoods: string[]
  health: string[]
  growth: { weight_kg?: number; length_cm?: number; head_cm?: number } | null
  memories: BookMemory[]
}

export interface Book {
  title: string
  birth: { date: string | null; weight_kg?: number; length_cm?: number; head_cm?: number }
  coverPhoto: string | null
  months: BookMonth[]
  growth: { at: string; weight_kg?: number; length_cm?: number; head_cm?: number }[]
  counts: { notes: number; photos: number; firsts: number; entries: number }
}

const MONTH_MS = 30.4375 * 86_400_000

export function buildBook(all: LeelaEvent[], segments: TimerSegment[], child: Child, family: Family, now = Date.now()): Book {
  const tz = family.timezone
  const events = all.filter((e) => !e.deleted_at && (e.child_id === child.id || (e.child_id === null && e.type === 'pump')))
  const mine = events.filter((e) => e.child_id === child.id)
  const birthMs = child.birth_date ? new TZDate(`${child.birth_date}T00:00:00`, tz).getTime() : Math.min(now, ...mine.map((e) => Date.parse(e.started_at)))
  const growthAll = mine
    .filter((e) => e.type === 'growth')
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
    .map((e) => ({ at: e.started_at, weight_kg: e.data.weight_kg, length_cm: e.data.length_cm, head_cm: e.data.head_cm }))
  const firstGrowth = growthAll.find((g) => Date.parse(g.at) - birthMs < 7 * 86_400_000)

  const toMemory = (e: LeelaEvent): BookMemory | null => {
    if (e.type === 'note') return { id: e.id, kind: 'note', at: e.started_at, title: typeof e.data.title === 'string' ? e.data.title.trim() : '', text: noteBody(e), photos: e.photo_paths }
    if (e.type === 'milestone') return { id: e.id, kind: 'milestone', at: e.started_at, title: eventTitle(e, family), text: e.notes ?? '', photos: e.photo_paths }
    if (e.photo_paths.length) return { id: e.id, kind: 'photo', at: e.started_at, title: eventTitle(e, family), text: e.notes ?? '', photos: e.photo_paths }
    return null
  }

  const months: BookMonth[] = []
  const lastMs = Math.max(now, ...mine.map((e) => Date.parse(e.started_at)))
  const count = Math.max(1, Math.ceil((Math.min(lastMs, now) - birthMs + 1) / MONTH_MS))
  const triedBefore = new Set<string>()
  for (let i = 0; i < count; i++) {
    const from = birthMs + Math.round(i * MONTH_MS)
    const to = Math.min(birthMs + Math.round((i + 1) * MONTH_MS), now)
    if (to <= from) break
    const inMonth = mine.filter((e) => {
      const t = Date.parse(e.started_at)
      return t >= from && t < to
    })
    const days = Math.max(1, (to - from) / 86_400_000)
    const totals = totalsFor(events, segments, child.id, from, to, family, now)
    const firsts = inMonth
      .filter((e) => e.type === 'milestone')
      .sort((a, b) => a.started_at.localeCompare(b.started_at))
      .map((e) => MILESTONE_KINDS.find((k) => k.id === e.data.kind)?.label ?? e.data.label ?? 'A first')
    const newFoods: string[] = []
    for (const e of inMonth.filter((x) => x.type === 'solids').sort((a, b) => a.started_at.localeCompare(b.started_at))) {
      for (const f of e.data.foods ?? []) {
        const k = f.name.toLowerCase()
        if (!triedBefore.has(k)) {
          triedBefore.add(k)
          newFoods.push(f.name)
        }
      }
    }
    const health = inMonth
      .filter((e) => e.type === 'symptom' && (e.data.kind === 'vaccine' || e.data.kind === 'visit'))
      .sort((a, b) => a.started_at.localeCompare(b.started_at))
      .map((e) => (e.data.kind === 'vaccine' ? `Vaccines${e.data.vaccine ? `: ${e.data.vaccine}` : ''}` : 'Doctor visit'))
    const g = growthAll.filter((x) => Date.parse(x.at) >= from && Date.parse(x.at) < to)
    const growth = g.length ? { weight_kg: lastDefined(g, 'weight_kg'), length_cm: lastDefined(g, 'length_cm'), head_cm: lastDefined(g, 'head_cm') } : null
    const memories = inMonth
      .map(toMemory)
      .filter((m): m is BookMemory => m !== null)
      .sort((a, b) => a.at.localeCompare(b.at))
    months.push({ n: i + 1, from, to, days, totals, firsts, newFoods, health, growth, memories })
  }

  const before = mine
    .filter((e) => Date.parse(e.started_at) < birthMs)
    .map(toMemory)
    .filter((m): m is BookMemory => m !== null)
  if (before.length) months.unshift({ n: 0, from: Math.min(...before.map((m) => Date.parse(m.at))), to: birthMs, days: 1, totals: totalsFor([], [], child.id, 0, 0, family, now), firsts: [], newFoods: [], health: [], growth: null, memories: before })

  const photos = mine.flatMap((e) => e.photo_paths)
  const coverPhoto = mine.filter((e) => e.type === 'note' || e.type === 'milestone').flatMap((e) => e.photo_paths)[0] ?? photos[0] ?? null
  return {
    title: `${child.name}’s diary`,
    birth: { date: child.birth_date, weight_kg: firstGrowth?.weight_kg, length_cm: firstGrowth?.length_cm, head_cm: firstGrowth?.head_cm },
    coverPhoto,
    months,
    growth: growthAll,
    counts: { notes: mine.filter((e) => e.type === 'note').length, photos: photos.length, firsts: mine.filter((e) => e.type === 'milestone').length, entries: mine.length },
  }
}

function lastDefined<K extends 'weight_kg' | 'length_cm' | 'head_cm'>(rows: { [P in K]?: number }[], k: K): number | undefined {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i][k] !== undefined) return rows[i][k]
  return undefined
}
