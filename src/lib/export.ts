// "Download all our data": everything the family has stored, as one JSON file and a CSV of entries.
import { TYPES } from './config'
import { eventDetail, eventTitle, noteBody } from './describe'
import { getState } from './store'
import { supabase } from './supabase'
import { fmtTime } from './time'
import type { Family, LeelaEvent } from './types'

async function all<T>(make: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make(from, from + 999)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < 1000) return out
  }
}

export interface ExportFiles {
  json: Blob
  csv: Blob
  baseName: string
  counts: { entries: number; changes: number }
}

export async function exportFamilyData(): Promise<ExportFiles> {
  const s = getState()
  if (!s.family) throw new Error('Join a family first.')
  if (!navigator.onLine) throw new Error('Exporting needs a connection, so it can include everything on the server.')
  const fid = s.family.id
  const [family, members, children, events, segments, imports, audit] = await Promise.all([
    supabase.from('families').select('*').eq('id', fid).single(),
    supabase.from('family_members').select('*').eq('family_id', fid),
    all((a, b) => supabase.from('children').select('*').eq('family_id', fid).order('created_at').range(a, b)),
    all<LeelaEvent>((a, b) => supabase.from('events').select('*').eq('family_id', fid).order('started_at').order('id').range(a, b)),
    all((a, b) => supabase.from('timer_segments').select('*').eq('family_id', fid).order('started_at').order('id').range(a, b)),
    all((a, b) => supabase.from('imports').select('*').eq('family_id', fid).order('created_at').range(a, b)),
    all((a, b) => supabase.from('audit_log').select('*').eq('family_id', fid).order('id').range(a, b)),
  ])
  if (family.error) throw new Error(family.error.message)
  const memberIds = (members.data ?? []).map((m) => m.user_id)
  const { data: profiles } = await supabase.from('profiles').select('id, display_name, created_at').in('id', memberIds.length ? memberIds : ['00000000-0000-0000-0000-000000000000'])

  const exportedAt = new Date().toISOString()
  const payload = {
    about: 'Everything your family has stored in Leela, exported from the server. Entries marked deleted_at were deleted in the app and are kept for history.',
    exported_at: exportedAt,
    family: family.data,
    members: members.data ?? [],
    profiles: profiles ?? [],
    children,
    events,
    timer_segments: segments,
    imports,
    activity_log: audit,
  }
  const json = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' })
  const csv = new Blob(['﻿' + eventsCsv(events, s.family, Object.fromEntries((profiles ?? []).map((p) => [p.id, p.display_name])), Object.fromEntries(children.map((c) => [(c as { id: string }).id, (c as { name: string }).name])))], {
    type: 'text/csv;charset=utf-8',
  })
  const safe = (s.family.name || 'family').replace(/[^\p{L}\d]+/gu, '-').replace(/^-|-$/g, '').toLowerCase()
  return { json, csv, baseName: `leela-${safe}-${exportedAt.slice(0, 10)}`, counts: { entries: events.length, changes: audit.length } }
}

function eventsCsv(events: LeelaEvent[], family: Family, people: Record<string, string>, kids: Record<string, string>): string {
  const tz = family.timezone
  const cell = (v: unknown) => {
    const t = v === null || v === undefined ? '' : String(v)
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const date = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz })
  const rows = [['Date', 'Time', 'Ended', 'Kind', 'What', 'Details', 'Notes', 'Baby', 'Logged by', 'Source', 'Deleted'].join(',')]
  for (const e of events) {
    const title = eventTitle(e, family)
    const detail = e.type === 'note' ? noteBody(e) : eventDetail(e, [], {}, Date.now())
    rows.push(
      [
        date(e.started_at),
        fmtTime(e.started_at, tz),
        e.ended_at ? `${date(e.ended_at)} ${fmtTime(e.ended_at, tz)}` : '',
        TYPES[e.type]?.label ?? e.type,
        title,
        detail,
        e.type === 'note' ? '' : (e.notes ?? ''),
        e.child_id ? (kids[e.child_id] ?? '') : '',
        e.created_by ? (people[e.created_by] ?? '') : '',
        e.source,
        e.deleted_at ? 'yes' : '',
      ]
        .map(cell)
        .join(','),
    )
  }
  return rows.join('\r\n')
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
