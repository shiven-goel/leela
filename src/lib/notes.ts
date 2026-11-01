// Notes are long, free-form memories. Leela also reads them for anything worth logging
// ("she rolled over!", "Calpol 2.5 ml at 9") and offers to add those entries.
import { TZDate } from '@date-fns/tz'
import { deleteEvent, logEvent } from './actions'
import { TYPES } from './config'
import { familyVocab, namesToSkip } from './import/learn'
import { parseLog, type Draft, type ParseResult } from './import/parse'
import { markDuplicates } from './import/save'
import { getState, myPrefs } from './store'

/** Kinds that make sense with only a date, so they're ticked even when the note gives no time. */
const DATE_LEVEL = new Set(['milestone', 'growth', 'symptom', 'temperature', 'medicine', 'activity', 'solids'])

export function interpretNote(body: string, at: Date, childId: string): { result: ParseResult; drafts: Draft[] } {
  const s = getState()
  const family = s.family!
  const child = s.children.find((c) => c.id === childId)
  const prefs = myPrefs()
  const d = new TZDate(at.getTime(), family.timezone)
  const result = parseLog(
    { kind: 'text', text: body },
    {
      timeZone: family.timezone,
      birthDate: child?.birth_date ?? null,
      order: prefs.dateOrder,
      fallbackOrder: family.timezone.startsWith('America/') ? 'mdy' : 'dmy',
      undatedDay: { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() },
      now: Date.now(),
      vocab: familyVocab(),
      feedDefault: prefs.feedDefault,
      skipWords: namesToSkip(),
    },
  )
  const now = Date.now()
  let drafts = result.drafts
    // Without a time, an entry happened when the note says it did, not at noon.
    .map((x) => (x.flags.includes('no_time') ? { ...x, start: at.getTime(), end: x.end ? at.getTime() + (x.end - x.start) : null } : x))
    .map((x) => ({ ...x, flags: x.flags.filter((f) => f !== 'future' || x.start > now + 10 * 60_000) }))
    .filter((x) => x.type !== 'note' && !x.flags.includes('future') && !x.flags.includes('before_birth'))
  drafts = markDuplicates(drafts, Object.values(s.events), childId).map((x) => ({
    ...x,
    include: !x.flags.includes('duplicate') && (!x.flags.some((f) => f === 'no_time' || f === 'approx_time') || DATE_LEVEL.has(x.type)),
  }))
  return { result, drafts }
}

/** Logs the chosen entries from a note, linked back to it; returns an undo. */
export async function logFromNote(noteId: string, childId: string, drafts: Draft[]): Promise<() => void> {
  const ids: string[] = []
  for (const d of drafts) {
    if (!d.include) continue
    const e = await logEvent(
      {
        type: d.type,
        childId: TYPES[d.type].familyLevel ? null : childId,
        startedAt: new Date(d.start).toISOString(),
        endedAt: d.end ? new Date(d.end).toISOString() : null,
        data: { ...d.data, from_note: noteId },
        notes: d.notes,
      },
      { quiet: true },
    )
    ids.push(e.id)
  }
  return () => {
    for (const id of ids) void deleteEvent(id, { quiet: true })
  }
}

const DRAFT_KEY = (id: string | undefined) => `leela-note-draft:${id ?? 'new'}`

export interface NoteDraft {
  title: string
  body: string
  at: number
  photos: string[]
}

/** An unsaved note survives the app closing; kept only on this phone. */
export function loadNoteDraft(id: string | undefined): NoteDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(id))
    return raw ? (JSON.parse(raw) as NoteDraft) : null
  } catch {
    return null
  }
}

export function saveNoteDraft(id: string | undefined, d: NoteDraft) {
  try {
    if (!d.title.trim() && !d.body.trim() && !d.photos.length) localStorage.removeItem(DRAFT_KEY(id))
    else localStorage.setItem(DRAFT_KEY(id), JSON.stringify(d))
  } catch {
    /* storage unavailable: the note still saves normally */
  }
}

export function clearNoteDraft(id: string | undefined) {
  try {
    localStorage.removeItem(DRAFT_KEY(id))
  } catch {
    /* ignore */
  }
}
