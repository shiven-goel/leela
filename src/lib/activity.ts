// The family's activity log: every change stored on the server, in plain words.
import { TYPES } from './config'
import { eventDetail, eventTitle } from './describe'
import { meaningById } from './import/vocab'
import { getState } from './store'
import { supabase } from './supabase'
import { fmtShortDate, fmtTime } from './time'
import type { LeelaEvent } from './types'

export interface AuditEntry {
  id: number
  at: string
  family_id: string | null
  actor: string | null
  table_name: string
  row_id: string
  action: 'insert' | 'update' | 'delete'
  changes: Record<string, unknown>
}

/** Newest first, a page at a time. Timer side-switches are left out as noise. */
export async function fetchActivity(before?: number, limit = 60): Promise<AuditEntry[]> {
  let q = supabase.from('audit_log').select('*').neq('table_name', 'timer_segments').order('id', { ascending: false }).limit(limit)
  if (before) q = q.lt('id', before)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as AuditEntry[]
}

const FIELD: Record<string, string> = {
  started_at: 'time',
  ended_at: 'end time',
  data: 'details',
  notes: 'notes',
  photo_paths: 'photos',
  child_id: 'baby',
  type: 'kind',
}

function name(userId: string | null | undefined): string {
  if (!userId) return 'Someone'
  const s = getState()
  if (userId === s.userId) return 'You'
  return s.profiles[userId]?.display_name || 'A family member'
}

function eventWords(row: Partial<LeelaEvent>): string {
  if (!row.type || !TYPES[row.type]) return 'an entry'
  const s = getState()
  const e = { photo_paths: [], data: {}, notes: null, timer_state: null, ended_at: null, deleted_at: null, ...row } as LeelaEvent
  const title = e.type === 'note' ? 'a note' : eventTitle(e, s.family).toLowerCase()
  const detail = e.type === 'note' ? '' : eventDetail(e, [], {}, Date.now()).replace(/, by .*$/, '')
  const when = e.started_at && s.family ? ` (${fmtShortDate(e.started_at, s.family.timezone)}, ${fmtTime(e.started_at, s.family.timezone)})` : ''
  return `${title}${detail ? `, ${detail}` : ''}${when}`
}

export function describeActivity(a: AuditEntry): { who: string; text: string } | null {
  const s = getState()
  const who = name(a.actor)
  const c = a.changes as Record<string, unknown>
  const diff = c as Record<string, [unknown, unknown]>
  switch (a.table_name) {
    case 'events': {
      if (a.action === 'insert') {
        const row = c as Partial<LeelaEvent>
        const imported = row.source === 'import'
        return { who, text: `${imported ? 'imported' : row.timer_state ? 'started' : 'logged'} ${eventWords(row)}` }
      }
      const current = s.events[a.row_id]
      const what = current ? eventWords(current) : 'an entry'
      if (a.action === 'delete') return { who, text: `permanently removed ${what}` }
      if ('deleted_at' in diff) return { who, text: diff.deleted_at[1] ? `deleted ${what}` : `restored ${what}` }
      if ('timer_state' in diff && diff.timer_state[1] === null && 'ended_at' in diff) return { who, text: `stopped ${what}` }
      if ('timer_state' in diff && diff.timer_state[1] === 'paused') return { who, text: `paused ${what}` }
      if ('timer_state' in diff && diff.timer_state[1] === 'running') return { who, text: `switched sides on ${what}` }
      const fields = [...new Set(Object.keys(diff).map((k) => FIELD[k]).filter(Boolean))]
      return { who, text: `edited ${what}${fields.length ? `: ${fields.join(', ')}` : ''}` }
    }
    case 'children': {
      const nameNow = (a.action === 'update' ? (diff.name?.[1] as string) : (c.name as string)) ?? s.children.find((k) => k.id === a.row_id)?.name ?? 'the baby'
      if (a.action === 'insert') return { who, text: `added ${nameNow}` }
      if ('deleted_at' in diff) return { who, text: diff.deleted_at[1] ? `removed ${nameNow}` : `brought back ${nameNow}` }
      return { who, text: `updated ${nameNow}’s details` }
    }
    case 'families': {
      if (a.action === 'insert') return { who, text: 'created the family' }
      if ('code' in diff) return { who, text: 'reset the family code' }
      if ('owner_id' in diff) return { who, text: `made ${name(diff.owner_id[1] as string)} the owner` }
      if ('deleted_at' in diff) return { who, text: 'closed the family' }
      if ('name' in diff) return { who, text: `renamed the family to “${diff.name[1]}”` }
      if ('night_start' in diff || 'night_end' in diff) return { who, text: 'changed the night hours' }
      if ('timezone' in diff) return { who, text: `changed the time zone to ${diff.timezone[1]}` }
      return { who, text: 'changed family settings' }
    }
    case 'family_members': {
      const member = name(a.row_id)
      if (a.action === 'insert') return { who: member, text: 'joined the family' }
      if ('removed_at' in diff) return diff.removed_at[1] ? (a.actor === a.row_id ? { who: member, text: 'left the family' } : { who, text: `removed ${member}` }) : { who: member, text: 'rejoined the family' }
      return null
    }
    case 'profiles': {
      if ('display_name' in diff) return { who, text: `changed their name to “${diff.display_name[1]}”` }
      if ('prefs' in diff) {
        const [before, after] = diff.prefs as [{ vocab?: Record<string, string> } | null, { vocab?: Record<string, string> } | null]
        const added = Object.entries(after?.vocab ?? {}).filter(([k, v]) => before?.vocab?.[k] !== v)
        if (added.length) return { who, text: `taught Leela ${added.map(([k, v]) => `“${k}” = ${meaningById(v)?.label.toLowerCase() ?? v}`).join(', ')}` }
        return { who, text: 'changed their settings' }
      }
      if (a.action === 'insert') return null
      return null
    }
    case 'imports': {
      if (a.action === 'insert') {
        const counts = (c.counts ?? {}) as Record<string, number>
        const n = Object.values(counts).reduce((x, y) => x + y, 0)
        return { who, text: `imported ${n} ${n === 1 ? 'entry' : 'entries'} from ${c.file_name ?? 'pasted text'}` }
      }
      if ('status' in diff && diff.status[1] === 'undone') return { who, text: 'undid an import' }
      return null
    }
    default:
      return null
  }
}
