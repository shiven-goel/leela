// Saving checked entries, spotting ones already in Leela, and undoing an import.
import { TYPES } from '../config'
import { getState } from '../store'
import { supabase } from '../supabase'
import { refresh } from '../sync'
import type { LeelaEvent } from '../types'
import { uuid } from '../uuid'
import type { Draft } from './parse'

export { markDuplicates } from './duplicates'

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
