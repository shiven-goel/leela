// Development-only sample data for design reviews (?preview). Never shipped: imported only in dev.
import { getState } from '../lib/store'
import type { Child, Family, LeelaEvent, TimerSegment } from '../lib/types'

const MIN = 60_000
const H = 60 * MIN

export function seed(variant: string) {
  const now = Date.now()
  const tz = 'Asia/Kolkata'
  const family: Family = {
    id: 'f1',
    name: 'Our family',
    code: 'LEELA-7KQ2-9XPM',
    owner_id: 'u1',
    timezone: tz,
    night_start: '19:00',
    night_end: '07:00',
  }
  const birth = new Date(now - 108 * 24 * H).toISOString().slice(0, 10)
  const child: Child = {
    id: 'c1',
    family_id: 'f1',
    name: 'Mira',
    birth_date: birth,
    due_date: null,
    sex: 'female',
    avatar_path: null,
    settings: {},
    created_at: new Date(now - 100 * 24 * H).toISOString(),
    deleted_at: null,
  }
  const events: Record<string, LeelaEvent> = {}
  const segments: Record<string, TimerSegment> = {}
  let n = 0
  const add = (type: LeelaEvent['type'], start: number, end: number | null, data: LeelaEvent['data'] = {}, by = 'u1', extra: Partial<LeelaEvent> = {}) => {
    if (start > now) return
    const id = `e${n++}`
    const created = new Date(Math.min(now, (end ?? start) + 2 * MIN)).toISOString()
    events[id] = {
      id,
      family_id: 'f1',
      child_id: type === 'pump' ? null : 'c1',
      type,
      started_at: new Date(start).toISOString(),
      ended_at: end ? new Date(Math.min(end, now)).toISOString() : null,
      timer_state: null,
      data,
      photo_paths: [],
      notes: null,
      source: 'app',
      import_id: null,
      created_by: by,
      updated_by: by,
      created_at: created,
      updated_at: created,
      deleted_at: null,
      ...extra,
    }
    return events[id]
  }

  // Local midnight in India for today.
  const offset = 5.5 * H
  const midnight = Math.floor((now + offset) / (24 * H)) * 24 * H - offset
  for (let d = -3; d <= 0; d++) {
    const day = midnight + d * 24 * H
    const by = (h: number) => (h % 2 ? 'u2' : 'u1')
    // night that started the previous evening
    add('sleep', day - 2.5 * H, day + 2.2 * H, {}, 'u2')
    add('sleep', day + 2.7 * H, day + 6.6 * H, {}, 'u1')
    const naps = [
      [8.3, 9.4],
      [11.5, 12.8],
      [15.0, 15.7],
      [17.7, 18.2],
    ]
    for (const [a, b] of naps) add('sleep', day + a * H, day + b * H, { place: a > 15 ? 'carrier' : 'crib' }, by(Math.round(a)))
    const feeds = [2.4, 6.8, 9.8, 13.0, 16.0, 18.5, 21.0]
    feeds.forEach((h, i) => {
      if (i % 3 === 1) add('bottle', day + h * H, null, { amount_ml: 110 + (i % 2) * 20, contents: i % 2 ? 'breast' : 'formula' }, by(i))
      else add('nursing', day + h * H, day + h * H + 22 * MIN, { left_s: 600 + i * 30, right_s: 540, last_side: i % 2 ? 'left' : 'right' }, by(i))
    })
    ;[3, 7, 10, 12.9, 15.8, 18.4, 20.5, 23].forEach((h, i) =>
      add('diaper', day + h * H, null, { kind: i % 3 === 0 ? 'dirty' : i % 4 === 0 ? 'mixed' : 'wet' }, by(i)),
    )
    add('activity', day + 10.2 * H, day + 10.45 * H, { kind: 'tummy' }, 'u2')
  }
  add('pump', midnight + 7.5 * H, midnight + 7.9 * H, { left_ml: 70, right_ml: 60 }, 'u1')
  add('temperature', midnight - 20 * H, null, { temp_c: 37.1, method: 'armpit' }, 'u2')
  add('milestone', midnight - 40 * H, null, { kind: 'laugh' }, 'u1', { notes: 'Giggled at the ceiling fan for a full minute.' })
  add('note', midnight - 60 * H, null, {}, 'u2', { notes: 'First visit to Nani’s house. Slept through the whole car ride.' })
  add('note', midnight - 9 * 24 * H, null, {
    title: 'The longest night',
    body: 'Up every two hours with a blocked nose. We took turns walking her up and down the hallway, humming the song Papa made up.\n\nBy 5 am she finally settled on my chest and we both slept until the sun came in.',
  }, 'u1')
  add('milestone', midnight - 30 * 24 * H, null, { kind: 'smile' }, 'u2', { notes: 'A real smile, at Papa, during the morning feed.' })
  add('note', midnight - 70 * 24 * H, null, { body: 'Home from the hospital today. Everyone cried, including the cat.' }, 'u2')

  // Remove anything in the future relative to the chosen scenario, then add the live timers.
  if (variant === 'asleep') {
    for (const e of Object.values(events)) if (e.type === 'sleep' && Date.parse(e.ended_at ?? e.started_at) > now - 50 * MIN) delete events[e.id]
    add('sleep', now - 42 * MIN, null, {}, 'u2', { timer_state: 'running' })
  }
  if (variant === 'feeding') {
    const e = add('nursing', now - 9 * MIN, null, { last_side: 'right' }, 'u1', { timer_state: 'running' })!
    segments.s1 = { id: 's1', event_id: e.id, family_id: 'f1', side: 'left', started_at: new Date(now - 9 * MIN).toISOString(), ended_at: new Date(now - 4 * MIN).toISOString() }
    segments.s2 = { id: 's2', event_id: e.id, family_id: 'f1', side: 'right', started_at: new Date(now - 4 * MIN).toISOString(), ended_at: null }
  }

  getState().set({
    status: 'ready',
    userId: 'u1',
    email: 'parent@example.com',
    family,
    members: [
      { family_id: 'f1', user_id: 'u1', joined_at: new Date(now - 100 * 24 * H).toISOString(), last_seen_at: new Date(now - 7 * H).toISOString() },
      { family_id: 'f1', user_id: 'u2', joined_at: new Date(now - 99 * 24 * H).toISOString(), last_seen_at: new Date(now - 10 * MIN).toISOString() },
    ],
    profiles: {
      u1: { id: 'u1', display_name: 'Shiven', avatar_path: null, prefs: {} },
      u2: { id: 'u2', display_name: 'Mom', avatar_path: null, prefs: {} },
    },
    children: [child],
    activeChildId: 'c1',
    events,
    segments,
    catchUpSince: new Date(now - 7 * H).toISOString(),
    tab: (new URLSearchParams(window.location.search).get('tab') as 'today') ?? 'today',
    overlay: ((): import('../lib/store').OverlayState => {
      const o = new URLSearchParams(window.location.search).get('overlay')
      return o === 'import' || o === 'book' ? { kind: o } : o === 'note' ? { kind: 'note' } : null
    })(),
  })
}
