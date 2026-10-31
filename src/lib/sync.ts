// Keeps every phone in the family in step: initial load, live updates, catch-up refreshes,
// and an offline outbox that replays changes in order once the connection is back.
import type { RealtimeChannel } from '@supabase/supabase-js'
import { db, type OutboxOp } from './db'
import { getState, useLeela } from './store'
import { isNetworkError, supabase } from './supabase'
import type { Child, Family, LeelaEvent, Member, Profile, TimerSegment } from './types'

const HISTORY_DAYS = 120
const SNAPSHOT_KEY = (uid: string) => `snapshot:${uid}`

let channel: RealtimeChannel | null = null
let refreshTimer: number | null = null
let retryTimer: number | null = null
let snapshotTimer: number | null = null
let flushing = false

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
export async function bootstrap(): Promise<void> {
  const { set } = getState()
  const { data } = await supabase.auth.getSession()
  const session = data.session
  if (!session) {
    teardown()
    getState().reset()
    set({ status: 'signed_out' })
    return
  }
  const uid = session.user.id
  set({ userId: uid, email: session.user.email ?? null })

  // Show the last known state instantly, even offline.
  const snap = (await db.cache.get(SNAPSHOT_KEY(uid)))?.value as Snapshot | undefined
  if (snap?.family) {
    applySnapshot(snap)
    set({ status: 'ready' })
  }

  const { data: me, error } = await supabase
    .from('family_members')
    .select('*')
    .eq('user_id', uid)
    .maybeSingle<Member>()

  if (error) {
    if (isNetworkError(error) && snap?.family) {
      set({ online: false })
      return
    }
    if (!snap?.family) set({ status: 'no_family' })
    return
  }
  if (!me) {
    teardown()
    set({ status: 'no_family', family: null, events: {}, segments: {}, children: [], members: [] })
    await db.cache.delete(SNAPSHOT_KEY(uid))
    return
  }

  if (!getState().catchUpSince) set({ catchUpSince: me.last_seen_at })
  await loadFamily(me.family_id)
  subscribe(me.family_id)
  void flush()
  void touchLastSeen()
  startRefreshLoop()
}

interface Snapshot {
  family: Family | null
  members: Member[]
  profiles: Record<string, Profile>
  children: Child[]
  events: Record<string, LeelaEvent>
  segments: Record<string, TimerSegment>
  activeChildId: string | null
  lastSyncAt: string | null
}

function applySnapshot(s: Snapshot) {
  getState().set({
    family: s.family,
    members: s.members,
    profiles: s.profiles,
    children: s.children,
    events: s.events,
    segments: s.segments,
    activeChildId: s.activeChildId,
    lastSyncAt: s.lastSyncAt,
  })
}

export function saveSnapshotSoon() {
  if (snapshotTimer) window.clearTimeout(snapshotTimer)
  snapshotTimer = window.setTimeout(() => {
    const s = getState()
    if (!s.userId || !s.family) return
    const snap: Snapshot = {
      family: s.family,
      members: s.members,
      profiles: s.profiles,
      children: s.children,
      events: s.events,
      segments: s.segments,
      activeChildId: s.activeChildId,
      lastSyncAt: s.lastSyncAt,
    }
    void db.cache.put({ key: SNAPSHOT_KEY(s.userId), value: snap })
  }, 800)
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
export async function loadFamily(familyId: string): Promise<void> {
  const { set, upsertEvents, upsertSegments } = getState()
  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString()
  const syncStart = new Date().toISOString()

  const [fam, mem, kids, recent, running] = await Promise.all([
    supabase.from('families').select('*').eq('id', familyId).single<Family>(),
    supabase.from('family_members').select('*').eq('family_id', familyId).order('joined_at'),
    supabase.from('children').select('*').eq('family_id', familyId).is('deleted_at', null).order('created_at'),
    fetchAll<LeelaEvent>((from, to) =>
      supabase.from('events').select('*').eq('family_id', familyId).gte('started_at', since).order('started_at').range(from, to),
    ),
    supabase.from('events').select('*').eq('family_id', familyId).not('timer_state', 'is', null),
  ])

  if (fam.error || mem.error || kids.error || running.error) {
    const err = fam.error || mem.error || kids.error || running.error
    if (isNetworkError(err)) set({ online: false })
    return
  }

  const members = (mem.data ?? []) as Member[]
  const { data: profs } = await supabase
    .from('profiles')
    .select('*')
    .in(
      'id',
      members.map((m) => m.user_id),
    )
  const profiles: Record<string, Profile> = {}
  for (const p of (profs ?? []) as Profile[]) profiles[p.id] = { ...p, prefs: p.prefs ?? {} }

  const children = (kids.data ?? []) as Child[]
  const current = getState().activeChildId
  set({
    family: fam.data,
    members,
    profiles,
    children,
    activeChildId: children.some((c) => c.id === current) ? current : children[0]?.id ?? null,
    status: 'ready',
    online: true,
  })

  const allEvents = [...recent, ...((running.data ?? []) as LeelaEvent[])]
  upsertEvents(allEvents)

  const nursingIds = allEvents.filter((e) => e.type === 'nursing').map((e) => e.id)
  if (nursingIds.length) {
    const segs = await fetchSegments(nursingIds)
    upsertSegments(segs)
  }
  set({ lastSyncAt: syncStart })
  saveSnapshotSoon()
}

/** Older history, for the Baby Diary and long-range trends. */
export async function loadAllHistory(): Promise<void> {
  const s = getState()
  if (!s.family) return
  const rows = await fetchAll<LeelaEvent>((from, to) =>
    supabase.from('events').select('*').eq('family_id', s.family!.id).order('started_at').range(from, to),
  )
  getState().upsertEvents(rows)
  saveSnapshotSoon()
}

async function fetchSegments(eventIds: string[]): Promise<TimerSegment[]> {
  const out: TimerSegment[] = []
  for (let i = 0; i < eventIds.length; i += 150) {
    const { data } = await supabase.from('timer_segments').select('*').in('event_id', eventIds.slice(i, i + 150))
    out.push(...((data ?? []) as TimerSegment[]))
  }
  return out
}

async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const size = 1000
  const out: T[] = []
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1)
    if (error || !Array.isArray(data)) break
    out.push(...(data as T[]))
    if (data.length < size) break
  }
  return out
}

/** Pull everything changed since the last sync; catches anything realtime missed. */
export async function refresh(): Promise<void> {
  const s = getState()
  if (!s.family || !s.userId) return
  const fid = s.family.id
  const since = s.lastSyncAt ? new Date(Date.parse(s.lastSyncAt) - 15_000).toISOString() : new Date(0).toISOString()
  const syncStart = new Date().toISOString()

  const { data: me, error: meErr } = await supabase.from('family_members').select('*').eq('user_id', s.userId).maybeSingle()
  if (meErr) {
    if (isNetworkError(meErr)) s.set({ online: false })
    return
  }
  if (!me) {
    // Removed from the family (or left on another device).
    teardown()
    s.set({ status: 'no_family', family: null, events: {}, segments: {}, children: [], members: [], removedNotice: true })
    await db.cache.delete(SNAPSHOT_KEY(s.userId))
    return
  }

  const [changed, fam, mem, kids] = await Promise.all([
    fetchAll<LeelaEvent>((from, to) =>
      supabase.from('events').select('*').eq('family_id', fid).gt('updated_at', since).order('updated_at').range(from, to),
    ),
    supabase.from('families').select('*').eq('id', fid).single<Family>(),
    supabase.from('family_members').select('*').eq('family_id', fid).order('joined_at'),
    supabase.from('children').select('*').eq('family_id', fid).is('deleted_at', null).order('created_at'),
  ])
  getState().upsertEvents(changed)
  const nursing = changed.filter((e) => e.type === 'nursing').map((e) => e.id)
  const runningNursing = Object.values(getState().events)
    .filter((e) => e.type === 'nursing' && e.timer_state)
    .map((e) => e.id)
  const segIds = [...new Set([...nursing, ...runningNursing])]
  if (segIds.length) getState().upsertSegments(await fetchSegments(segIds))

  const patch: Partial<ReturnType<typeof getState>> = { online: true, lastSyncAt: syncStart }
  if (fam.data) patch.family = fam.data
  if (mem.data) {
    patch.members = mem.data as Member[]
    const missing = (mem.data as Member[]).map((m) => m.user_id).filter((id) => !getState().profiles[id])
    if (missing.length) {
      const { data: profs } = await supabase.from('profiles').select('*').in('id', missing)
      const profiles = { ...getState().profiles }
      for (const p of (profs ?? []) as Profile[]) profiles[p.id] = { ...p, prefs: p.prefs ?? {} }
      patch.profiles = profiles
    }
  }
  if (kids.data) {
    patch.children = kids.data as Child[]
    const active = getState().activeChildId
    if (!(kids.data as Child[]).some((c) => c.id === active)) patch.activeChildId = (kids.data as Child[])[0]?.id ?? null
  }
  getState().set(patch)
  saveSnapshotSoon()
}

// ---------------------------------------------------------------------------
// Live updates
// ---------------------------------------------------------------------------
function subscribe(familyId: string) {
  if (channel) void supabase.removeChannel(channel)
  const filter = `family_id=eq.${familyId}`
  const onEvent = (payload: { new: unknown }) => {
    getState().upsertEvents([payload.new as LeelaEvent])
    saveSnapshotSoon()
  }
  const onSegment = (payload: { new: unknown }) => {
    getState().upsertSegments([payload.new as TimerSegment])
    saveSnapshotSoon()
  }
  const onChild = (payload: { new: unknown }) => {
    const row = payload.new as Child
    const kids = getState().children.filter((c) => c.id !== row.id)
    const children = row.deleted_at ? kids : [...kids, row].sort((a, b) => a.created_at.localeCompare(b.created_at))
    getState().set({ children, activeChildId: getState().activeChildId ?? row.id })
  }
  channel = supabase
    .channel(`family:${familyId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events', filter }, onEvent)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events', filter }, onEvent)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'timer_segments', filter }, onSegment)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'timer_segments', filter }, onSegment)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'children', filter }, onChild)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'children', filter }, onChild)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'families', filter: `id=eq.${familyId}` }, (p) =>
      getState().set({ family: p.new as Family }),
    )
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'family_members', filter }, () => void refresh())
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (p) => {
      const row = p.new as Profile
      if (getState().profiles[row.id]) {
        getState().set({ profiles: { ...getState().profiles, [row.id]: { ...row, prefs: row.prefs ?? {} } } })
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') void refresh()
    })
}

function startRefreshLoop() {
  if (refreshTimer) window.clearInterval(refreshTimer)
  refreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') void refresh()
  }, 60_000)
}

export function teardown() {
  if (channel) void supabase.removeChannel(channel)
  channel = null
  if (refreshTimer) window.clearInterval(refreshTimer)
  refreshTimer = null
}

let lastTouch = 0
export async function touchLastSeen() {
  const s = getState()
  if (!s.userId || Date.now() - lastTouch < 5 * 60_000) return
  lastTouch = Date.now()
  await supabase.from('family_members').update({ last_seen_at: new Date().toISOString() }).eq('user_id', s.userId)
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------
async function updatePending() {
  const ops = await db.outbox.toArray()
  const pending: Record<string, number> = {}
  for (const op of ops) pending[op.rowId] = (pending[op.rowId] ?? 0) + 1
  getState().set({ pending, pendingCount: ops.length })
}

export async function enqueue(op: Omit<OutboxOp, 'createdAt'>): Promise<void> {
  await db.outbox.add({ ...op, createdAt: Date.now() })
  await updatePending()
  void flush()
}

export async function flush(): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    for (;;) {
      const op = await db.outbox.orderBy('seq').first()
      if (!op) break
      const result = await runOp(op)
      if (result === 'retry') {
        getState().set({ online: false })
        if (retryTimer) window.clearTimeout(retryTimer)
        retryTimer = window.setTimeout(() => void flush(), 5000)
        break
      }
      await db.outbox.delete(op.seq!)
      await updatePending()
      getState().set({ online: true })
      if (!getState().pending[op.rowId]) await pullRow(op)
    }
  } finally {
    flushing = false
    await updatePending()
  }
}

/** After a row's last queued change lands, take the server's version of it. */
async function pullRow(op: OutboxOp): Promise<void> {
  const s = getState()
  if (op.table === 'children' || op.table === 'families' || op.table === 'profiles') {
    void refresh()
    return
  }
  const { data } = await supabase.from('events').select('*').eq('id', op.rowId).maybeSingle<LeelaEvent>()
  if (!data) return
  s.upsertEvents([data], { force: true })
  if (data.type === 'nursing') s.upsertSegments(await fetchSegments([data.id]))
}

type OpResult = 'done' | 'retry'

async function runOp(op: OutboxOp): Promise<OpResult> {
  try {
    if (op.kind === 'insert' && op.table) {
      const { error } = await supabase.from(op.table).upsert(op.row!, { onConflict: 'id', ignoreDuplicates: true })
      return error ? handleError(op, error) : 'done'
    }
    if (op.kind === 'update' && op.table) {
      let q = supabase.from(op.table).update(op.patch!).eq('id', op.rowId)
      if (op.ifUpdatedAt) q = q.eq('updated_at', op.ifUpdatedAt)
      const { data, error } = await q.select('*')
      if (error) return handleError(op, error)
      if (op.table === 'events' && Array.isArray(data)) {
        if (data.length) {
          getState().upsertEvents(data as LeelaEvent[], { force: true })
        } else if (op.ifUpdatedAt) {
          await onEditConflict(op)
        }
      }
      return 'done'
    }
    if (op.kind === 'rpc' && op.fn) {
      const { error } = await supabase.rpc(op.fn, op.args)
      return error ? handleError(op, error) : 'done'
    }
    return 'done'
  } catch {
    return 'retry'
  }
}

function handleError(op: OutboxOp, error: { message?: string; code?: string }): OpResult {
  if (isNetworkError(error)) return 'retry'
  const s = getState()
  if (error.code === '23505' && op.table === 'events') {
    // Someone else started the same timer first. Drop ours and show theirs.
    const events = { ...s.events }
    delete events[op.rowId]
    s.set({ events })
    s.toast({ text: 'That timer was already running on another phone. Showing it now.' })
    void db.outbox.where('rowId').equals(op.rowId).delete()
    void refresh()
    return 'done'
  }
  if (error.code === 'PGRST301' || error.message?.toLowerCase().includes('jwt')) {
    void supabase.auth.refreshSession()
    return 'retry'
  }
  s.toast({ text: `Couldn't save that change: ${error.message ?? 'unknown error'}`, tone: 'error' })
  void refresh()
  return 'done'
}

async function onEditConflict(op: OutboxOp) {
  const { data } = await supabase.from('events').select('*').eq('id', op.rowId).maybeSingle<LeelaEvent>()
  if (!data) return
  const s = getState()
  const name = data.updated_by && data.updated_by !== s.userId ? s.profiles[data.updated_by]?.display_name || 'Someone' : 'Someone'
  s.upsertEvents([data], { force: true })
  s.set({ conflict: { eventId: op.rowId, patch: op.patch ?? {}, byName: name } })
}

export function watchConnectivity() {
  window.addEventListener('online', () => {
    getState().set({ online: true })
    void flush()
    void refresh()
  })
  window.addEventListener('offline', () => getState().set({ online: false }))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void refresh()
      void flush()
      void touchLastSeen()
    }
  })
  useLeela.subscribe((s, prev) => {
    if (s.events !== prev.events || s.children !== prev.children) saveSnapshotSoon()
  })
  void updatePending()
}
