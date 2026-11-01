// Every change goes through here: applied on the phone instantly, then queued for the server.
import { getState } from './store'
import { enqueue } from './sync'
import { supabase } from './supabase'
import { TYPES } from './config'
import { nursingSeconds } from './counting'
import type { Child, EventData, EventType, LeelaEvent, Prefs, Side, TimerSegment } from './types'
import { uuid } from './uuid'
import type { RpcName } from './database.types'

const nowIso = () => new Date().toISOString()

function serverRow(e: LeelaEvent): Record<string, unknown> {
  return {
    id: e.id,
    family_id: e.family_id,
    child_id: e.child_id,
    type: e.type,
    started_at: e.started_at,
    ended_at: e.ended_at,
    timer_state: e.timer_state,
    data: e.data,
    photo_paths: e.photo_paths,
    notes: e.notes,
  }
}

function putLocal(e: LeelaEvent) {
  const s = getState()
  s.set({ events: { ...s.events, [e.id]: { ...e, _local: true } } })
}

export interface NewEventInput {
  type: EventType
  childId: string | null
  startedAt?: string
  endedAt?: string | null
  data?: EventData
  notes?: string | null
  photoPaths?: string[]
  timerState?: 'running' | 'paused' | null
}

export function buildEvent(input: NewEventInput): LeelaEvent {
  const s = getState()
  if (!s.family || !s.userId) throw new Error('Not in a family yet')
  const t = nowIso()
  return {
    id: uuid(),
    family_id: s.family.id,
    child_id: TYPES[input.type].familyLevel ? null : input.childId,
    type: input.type,
    started_at: input.startedAt ?? t,
    ended_at: input.endedAt ?? null,
    timer_state: input.timerState ?? null,
    data: input.data ?? {},
    photo_paths: input.photoPaths ?? [],
    notes: input.notes?.trim() ? input.notes.trim() : null,
    source: 'app',
    import_id: null,
    created_by: s.userId,
    updated_by: s.userId,
    created_at: t,
    updated_at: t,
    deleted_at: null,
  }
}

export async function logEvent(input: NewEventInput, opts?: { quiet?: boolean }): Promise<LeelaEvent> {
  const e = buildEvent(input)
  putLocal(e)
  await enqueue({ kind: 'insert', table: 'events', rowId: e.id, row: serverRow(e) })
  if (!opts?.quiet) {
    getState().toast({ text: `${TYPES[e.type].label} saved.`, action: { label: 'Undo', run: () => void deleteEvent(e.id, { quiet: true }) } })
  }
  return e
}

/**
 * Changes an entry. `base` is the version the person was looking at when they started editing:
 * if someone else saved a change since then, the server refuses and the conflict dialog asks
 * which version should stay.
 */
export async function editEvent(
  id: string,
  patch: Partial<Pick<LeelaEvent, 'started_at' | 'ended_at' | 'data' | 'notes' | 'photo_paths' | 'child_id'>>,
  opts?: { force?: boolean; base?: string },
) {
  const s = getState()
  const cur = s.events[id]
  if (!cur) return
  const loaded = opts?.base ?? cur.updated_at
  putLocal({ ...cur, ...patch, updated_by: s.userId })
  await enqueue({ kind: 'update', table: 'events', rowId: id, patch, ifUpdatedAt: opts?.force || cur._local ? undefined : loaded })
}

export async function deleteEvent(id: string, opts?: { quiet?: boolean }) {
  const s = getState()
  const cur = s.events[id]
  if (!cur) return
  const patch = { deleted_at: nowIso(), timer_state: null }
  putLocal({ ...cur, ...patch })
  await enqueue({ kind: 'update', table: 'events', rowId: id, patch })
  if (!opts?.quiet) {
    getState().toast({ text: `${TYPES[cur.type].label} deleted.`, action: { label: 'Undo', run: () => void restoreEvent(id, cur.timer_state) } })
  }
}

export async function restoreEvent(id: string, timerState: LeelaEvent['timer_state'] = null) {
  const s = getState()
  const cur = s.events[id]
  if (!cur) return
  const patch = { deleted_at: null, timer_state: timerState }
  putLocal({ ...cur, ...patch })
  await enqueue({ kind: 'update', table: 'events', rowId: id, patch })
}

// ---------------------------------------------------------------------------
// Shared timers
// ---------------------------------------------------------------------------
export function runningTimer(type: EventType, childId: string | null): LeelaEvent | undefined {
  const s = getState()
  const familyLevel = TYPES[type].familyLevel
  return Object.values(s.events).find(
    (e) =>
      e.type === type &&
      e.timer_state &&
      !e.deleted_at &&
      (familyLevel ? e.created_by === s.userId : e.child_id === childId),
  )
}

export async function startTimer(
  type: EventType,
  childId: string | null,
  opts?: { startedAt?: string; side?: Side; data?: EventData },
): Promise<LeelaEvent> {
  const existing = runningTimer(type, childId)
  if (existing) return existing
  const e = buildEvent({
    type,
    childId,
    startedAt: opts?.startedAt,
    timerState: 'running',
    data: { ...(opts?.data ?? {}), ...(type === 'nursing' ? { last_side: opts?.side ?? 'left' } : {}) },
  })
  putLocal(e)
  await enqueue({ kind: 'insert', table: 'events', rowId: e.id, row: serverRow(e) })
  if (type === 'nursing') {
    const seg: TimerSegment = {
      id: uuid(),
      event_id: e.id,
      family_id: e.family_id,
      side: opts?.side ?? 'left',
      started_at: e.started_at,
      ended_at: null,
    }
    getState().upsertSegments([seg])
    await enqueue({
      kind: 'insert',
      table: 'timer_segments',
      rowId: e.id,
      row: { id: seg.id, event_id: seg.event_id, family_id: seg.family_id, side: seg.side, started_at: seg.started_at },
    })
  }
  return e
}

function closeOpenSegment(eventId: string, at: string) {
  const s = getState()
  const segs = Object.values(s.segments).filter((x) => x.event_id === eventId && !x.ended_at)
  if (!segs.length) return
  const next = { ...s.segments }
  for (const seg of segs) next[seg.id] = { ...seg, ended_at: at < seg.started_at ? seg.started_at : at }
  s.set({ segments: next })
}

export async function stopTimer(id: string, at: string = nowIso(), extra?: { data?: EventData; notes?: string | null }) {
  const s = getState()
  const cur = s.events[id]
  if (!cur || !cur.timer_state) return
  const end = at < cur.started_at ? cur.started_at : at
  closeOpenSegment(id, end)
  let data = { ...cur.data, ...(extra?.data ?? {}) }
  if (cur.type === 'nursing') {
    const secs = nursingSeconds({ ...cur, timer_state: null, data: {} }, Object.values(getState().segments), Date.parse(end))
    data = { ...data, left_s: secs.left, right_s: secs.right }
  }
  putLocal({ ...cur, ended_at: end, timer_state: null, data })
  await enqueue({ kind: 'rpc', fn: 'timer_stop', rowId: id, args: { p_event_id: id, p_at: end } })
  if (extra?.data || extra?.notes !== undefined) {
    const patch: Record<string, unknown> = {}
    if (extra.data) patch.data = data
    if (extra.notes !== undefined) patch.notes = extra.notes
    await enqueue({ kind: 'update', table: 'events', rowId: id, patch })
  }
  // Ended by mistake? Undo carries the timer on as if it was never stopped (not for breastfeeding,
  // whose sides are already tallied).
  getState().toast({
    text: `${TYPES[cur.type].label} saved.`,
    action: cur.type === 'nursing' ? undefined : { label: 'Undo', run: () => void resumeTimer(id) },
  })
}

/** Restarts a timer that was just stopped, keeping its original start. */
export async function resumeTimer(id: string) {
  const s = getState()
  const cur = s.events[id]
  if (!cur || cur.timer_state || cur.deleted_at || cur.type === 'nursing') return
  if (runningTimer(cur.type, cur.child_id)) {
    s.toast({ text: `Another ${TYPES[cur.type].label.toLowerCase()} timer is already running.` })
    return
  }
  putLocal({ ...cur, ended_at: null, timer_state: 'running' })
  await enqueue({ kind: 'update', table: 'events', rowId: id, patch: { ended_at: null, timer_state: 'running' } })
}

export async function nursingSwitch(id: string, side: Side) {
  const s = getState()
  const cur = s.events[id]
  if (!cur || !cur.timer_state) return
  const at = nowIso()
  closeOpenSegment(id, at)
  const seg: TimerSegment = { id: uuid(), event_id: id, family_id: cur.family_id, side, started_at: at, ended_at: null }
  getState().upsertSegments([seg])
  putLocal({ ...cur, timer_state: 'running', data: { ...cur.data, last_side: side } })
  await enqueue({ kind: 'rpc', fn: 'nursing_set', rowId: id, args: { p_event_id: id, p_side: side, p_at: at, p_segment_id: seg.id } })
}

export async function nursingPause(id: string) {
  const s = getState()
  const cur = s.events[id]
  if (!cur || cur.timer_state !== 'running') return
  const at = nowIso()
  closeOpenSegment(id, at)
  putLocal({ ...cur, timer_state: 'paused' })
  await enqueue({ kind: 'rpc', fn: 'nursing_set', rowId: id, args: { p_event_id: id, p_side: null, p_at: at } })
}

// ---------------------------------------------------------------------------
// Children, profile and family settings
// ---------------------------------------------------------------------------
export async function saveChild(child: Partial<Child> & { name: string }): Promise<void> {
  const s = getState()
  if (!s.family) return
  if (child.id) {
    const patch = {
      name: child.name,
      birth_date: child.birth_date ?? null,
      due_date: child.due_date ?? null,
      sex: child.sex ?? null,
      settings: child.settings ?? {},
    }
    s.set({ children: s.children.map((c) => (c.id === child.id ? { ...c, ...patch } : c)) })
    await enqueue({ kind: 'update', table: 'children', rowId: child.id, patch })
    return
  }
  const row: Child = {
    id: uuid(),
    family_id: s.family.id,
    name: child.name,
    birth_date: child.birth_date ?? null,
    due_date: child.due_date ?? null,
    sex: child.sex ?? null,
    avatar_path: null,
    settings: {},
    created_at: nowIso(),
    deleted_at: null,
  }
  s.set({ children: [...s.children, row], activeChildId: s.activeChildId ?? row.id })
  await enqueue({
    kind: 'insert',
    table: 'children',
    rowId: row.id,
    row: { id: row.id, family_id: row.family_id, name: row.name, birth_date: row.birth_date, due_date: row.due_date, sex: row.sex },
  })
}

/** Changes one part of a baby's settings (shared with the family), keeping the rest. */
export async function saveChildSettings(childId: string, key: string, value: unknown) {
  const s = getState()
  const child = s.children.find((c) => c.id === childId)
  if (!child) return
  const settings = { ...(child.settings ?? {}), [key]: value }
  s.set({ children: s.children.map((c) => (c.id === childId ? { ...c, settings } : c)) })
  await enqueue({ kind: 'update', table: 'children', rowId: childId, patch: { settings } })
}

export async function savePrefs(prefs: Prefs) {
  const s = getState()
  if (!s.userId) return
  const me = s.profiles[s.userId]
  const next = { ...(me?.prefs ?? {}), ...prefs }
  s.set({ profiles: { ...s.profiles, [s.userId]: { ...(me ?? { id: s.userId, display_name: '', avatar_path: null }), prefs: next } } })
  await enqueue({ kind: 'update', table: 'profiles', rowId: s.userId, patch: { prefs: next } })
}

export async function saveDisplayName(name: string) {
  const s = getState()
  if (!s.userId) return
  const me = s.profiles[s.userId]
  s.set({ profiles: { ...s.profiles, [s.userId]: { ...(me ?? { id: s.userId, avatar_path: null, prefs: {} }), display_name: name } } })
  await enqueue({ kind: 'update', table: 'profiles', rowId: s.userId, patch: { display_name: name } })
}

export async function saveFamilySettings(patch: { name?: string; timezone?: string; night_start?: string; night_end?: string }) {
  const s = getState()
  if (!s.family) return
  s.set({ family: { ...s.family, ...patch } })
  await enqueue({ kind: 'update', table: 'families', rowId: s.family.id, patch })
}

// ---------------------------------------------------------------------------
// Family code (needs a connection; these are one-off actions)
// ---------------------------------------------------------------------------
export type RpcResult = { ok: boolean; error?: string; [k: string]: unknown }

export async function rpc(fn: RpcName, args: Record<string, unknown> = {}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(fn, args as never)
  if (error) return { ok: false, error: error.message }
  return (data ?? { ok: true }) as RpcResult
}
