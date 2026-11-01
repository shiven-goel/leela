// Saving checked entries, spotting ones already in Leela, and undoing an import.
import { TYPES } from '../config'
import { getState } from '../store'
import { supabase } from '../supabase'
import { refresh } from '../sync'
import type { LeelaEvent } from '../types'
import { uuid } from '../uuid'
import type { Draft } from './parse'

const WINDOW_MS = { default: 10 * 60_000, sleep: 25 * 60_000 }

/** Flags drafts that match an entry already logged (same kind, within minutes) or repeat each other. */
export function markDuplicates(drafts: Draft[], existing: LeelaEvent[], childId: string): Draft[] {
  const byType = new Map<string, number[]>()
  for (const e of existing) {
    if (e.deleted_at) continue
    if (!TYPES[e.type]?.familyLevel && e.child_id !== childId) continue
    const list = byType.get(e.type) ?? []
    list.push(Date.parse(e.started_at))
    byType.set(e.type, list)
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
    const dup = near(byType.get(d.type), d.start, w) || seen.has(sig)
    seen.add(sig)
    if (!dup) return { ...d, flags: d.flags.filter((f) => f !== 'duplicate') }
    return { ...d, include: false, flags: [...new Set([...d.flags, 'duplicate' as const])] }
  })
}

export interface ImportRecord {
  id: string
  file_name: string | null
  created_at: string
  created_by: string | null
  counts: Record<string, number>
  status: 'saved' | 'undone'
  reader: string
}

/** Saves the checked drafts as one import, in batches, and returns how many were saved. */
export async function commitImport(opts: {
  drafts: Draft[]
  childId: string
  fileName: string | null
  reader: 'text' | 'columns'
  onProgress?: (done: number, total: number) => void
}): Promise<{ importId: string; saved: number }> {
  const s = getState()
  if (!s.family || !s.userId) throw new Error('Not in a family yet.')
  if (!navigator.onLine) throw new Error('Importing needs a connection. Try again when you’re online.')
  const chosen = opts.drafts.filter((d) => d.include)
  const counts: Record<string, number> = {}
  for (const d of chosen) counts[d.type] = (counts[d.type] ?? 0) + 1
  const importId = uuid()
  const { error: impErr } = await supabase.from('imports').insert({
    id: importId,
    family_id: s.family.id,
    created_by: s.userId,
    file_name: opts.fileName?.slice(0, 200) ?? null,
    reader: opts.reader,
    counts,
    status: 'saved',
  })
  if (impErr) throw new Error(impErr.message)

  const rows = chosen.map((d) => ({
    id: uuid(),
    family_id: s.family!.id,
    child_id: TYPES[d.type].familyLevel ? null : opts.childId,
    type: d.type,
    started_at: new Date(d.start).toISOString(),
    ended_at: d.end ? new Date(d.end).toISOString() : null,
    data: d.data as Record<string, never>,
    notes: d.notes,
    photo_paths: [],
    source: 'import',
    import_id: importId,
  }))
  let saved = 0
  for (let i = 0; i < rows.length; i += 250) {
    const batch = rows.slice(i, i + 250)
    const { data, error } = await supabase.from('events').upsert(batch, { onConflict: 'id', ignoreDuplicates: true }).select('*')
    if (error) throw new Error(`Saved ${saved} of ${rows.length}, then stopped: ${error.message}. You can undo this import from the Family tab.`)
    getState().upsertEvents((data ?? []) as LeelaEvent[], { force: true })
    saved += batch.length
    opts.onProgress?.(saved, rows.length)
  }
  return { importId, saved }
}

export async function undoImport(id: string): Promise<number> {
  const { data, error } = await supabase.rpc('undo_import', { p_import_id: id })
  if (error) throw new Error(error.message)
  await refresh()
  return Number((data as { removed?: number } | null)?.removed ?? 0)
}

export async function listImports(): Promise<ImportRecord[]> {
  const { data } = await supabase.from('imports').select('*').order('created_at', { ascending: false }).limit(20)
  return (data ?? []) as unknown as ImportRecord[]
}
