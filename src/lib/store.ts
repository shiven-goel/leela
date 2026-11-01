import { create } from 'zustand'
import type { Child, Family, LeelaEvent, Member, Prefs, Profile, TimerSegment } from './types'

export type Tab = 'today' | 'history' | 'notes' | 'diary' | 'family'
export type OverlayState = { kind: 'import' } | { kind: 'note'; id?: string } | { kind: 'book' } | null
export type Status = 'loading' | 'signed_out' | 'no_family' | 'ready'

export interface Toast {
  id: number
  text: string
  action?: { label: string; run: () => void }
  tone?: 'info' | 'error'
}

export interface Conflict {
  eventId: string
  patch: Record<string, unknown>
  byName: string
}

export interface LeelaState {
  status: Status
  userId: string | null
  email: string | null
  family: Family | null
  members: Member[]
  profiles: Record<string, Profile>
  children: Child[]
  activeChildId: string | null
  events: Record<string, LeelaEvent>
  segments: Record<string, TimerSegment>
  /** Rows with changes still waiting to reach the server. */
  pending: Record<string, number>
  pendingCount: number
  online: boolean
  lastSyncAt: string | null
  /** When I last opened the app before this visit; drives the catch-up card. */
  catchUpSince: string | null
  catchUpDismissed: boolean
  tab: Tab
  toasts: Toast[]
  conflict: Conflict | null
  removedNotice: boolean
  /** Keeps the setup screens up until the new family has its baby and invite. */
  onboarding: boolean
  /** A full screen open over the tabs: importing, writing a note, the diary book. */
  overlay: OverlayState

  set: (patch: Partial<LeelaState>) => void
  upsertEvents: (rows: LeelaEvent[], opts?: { force?: boolean }) => void
  upsertSegments: (rows: TimerSegment[]) => void
  toast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: number) => void
  reset: () => void
}

let toastSeq = 1

const initial = {
  status: 'loading' as Status,
  userId: null,
  email: null,
  family: null,
  members: [],
  profiles: {},
  children: [],
  activeChildId: null,
  events: {},
  segments: {},
  pending: {},
  pendingCount: 0,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  lastSyncAt: null,
  catchUpSince: null,
  catchUpDismissed: false,
  tab: 'today' as Tab,
  toasts: [],
  conflict: null,
  removedNotice: false,
  onboarding: false,
  overlay: null as OverlayState,
}

export const useLeela = create<LeelaState>((set, get) => ({
  ...initial,
  set: (patch) => set(patch),
  upsertEvents: (rows, opts) => {
    if (!rows.length) return
    const { events, pending } = get()
    const next = { ...events }
    let changed = false
    for (const r of rows) {
      const cur = next[r.id]
      if (!opts?.force) {
        // Keep the phone's own unsent change until the server has it.
        if (pending[r.id] && cur) continue
        // Between two server versions, the newer one wins. A server row always replaces a local draft.
        if (cur && !cur._local && Date.parse(cur.updated_at) > Date.parse(r.updated_at)) continue
      }
      next[r.id] = { ...r, data: r.data ?? {}, photo_paths: r.photo_paths ?? [] }
      changed = true
    }
    if (changed) set({ events: next })
  },
  upsertSegments: (rows) => {
    if (!rows.length) return
    const { segments, pending } = get()
    const next = { ...segments }
    for (const r of rows) {
      if (pending[r.event_id] && next[r.id]) continue
      next[r.id] = r
    }
    set({ segments: next })
  },
  toast: (t) => {
    const id = toastSeq++
    set({ toasts: [...get().toasts.slice(-2), { ...t, id }] })
    window.setTimeout(() => get().dismissToast(id), t.action ? 6000 : 3200)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  reset: () => set({ ...initial, online: navigator.onLine }),
}))

export const getState = () => useLeela.getState()

export function myPrefs(): Prefs {
  const s = getState()
  return (s.userId && s.profiles[s.userId]?.prefs) || {}
}

export function displayName(userId: string | null | undefined): string {
  if (!userId) return 'Someone'
  const s = getState()
  if (userId === s.userId) return 'You'
  return s.profiles[userId]?.display_name || 'Family member'
}

export function activeChild(): Child | null {
  const s = getState()
  return s.children.find((c) => c.id === s.activeChildId) ?? s.children[0] ?? null
}
