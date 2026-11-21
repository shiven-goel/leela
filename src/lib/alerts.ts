// Notifications besides the sweet spot: medicine doses, vaccines and the evening summary.
// No libraries, so supabase/functions/sweetspot-push can use the same code: `npm run build:edge`
// bundles this file (and vaccines.ts) into sweetspot-push/alerts.js.
import { localDay, vaccinePlan, vaccineReminder } from './vaccines'

export { localDay, vaccinePlan, vaccineReminder }

const H = 3_600_000

/** Which notifications a person wants, on every phone where they turned notifications on. */
export interface AlertPrefs {
  /** Before each nap and bedtime sweet spot. */
  sweetspot: boolean
  /** When a medicine's next dose is due (only medicines logged with a reminder). */
  medicine: boolean
  /** Two days before and on the day vaccines are due. */
  vaccines: boolean
  /** A short summary of the day, every evening. */
  summary: boolean
  /** When the summary comes, "HH:MM" in the family's time zone. */
  summaryAt: string
  /** When it's time to pump again (off unless turned on: it's for whoever pumps). */
  pump: boolean
  /** In the evening, when a daily vitamin hasn't been given yet. */
  vitamins: boolean
  /** Sunday evening: how the week went, against the week before. */
  weekly: boolean
}

export const DEFAULT_ALERTS: AlertPrefs = { sweetspot: true, medicine: true, vaccines: true, summary: true, summaryAt: '20:30', pump: false, vitamins: true, weekly: true }

export function readAlerts(prefs: object | null | undefined): AlertPrefs {
  const a = ((prefs as { alerts?: unknown } | null | undefined)?.alerts ?? {}) as Record<string, unknown>
  const flag = (k: keyof AlertPrefs) => (typeof a[k] === 'boolean' ? (a[k] as boolean) : (DEFAULT_ALERTS[k] as boolean))
  const at = typeof a.summaryAt === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(a.summaryAt) ? a.summaryAt : DEFAULT_ALERTS.summaryAt
  return { sweetspot: flag('sweetspot'), medicine: flag('medicine'), vaccines: flag('vaccines'), summary: flag('summary'), summaryAt: at, pump: flag('pump'), vitamins: flag('vitamins'), weekly: flag('weekly') }
}

/** Hours between doses that a medicine reminder can be set to. */
export const DOSE_GAPS = [4, 6, 8, 12, 24] as const

interface Ev {
  id: string
  type: string
  child_id: string | null
  started_at: string
  ended_at: string | null
  timer_state: string | null
  deleted_at: string | null
  data: Record<string, unknown>
}

export interface MedicineDue {
  /** The last dose, which carries the reminder. */
  eventId: string
  name: string
  dose: string
  lastAt: number
  dueAt: number
  everyH: number
}

/** Medicines whose last dose was logged with "remind me", and when the next one is due. */
export function medicinesDue(events: Ev[], childId: string): MedicineDue[] {
  const latest = new Map<string, Ev>()
  for (const e of events) {
    if (e.deleted_at || e.type !== 'medicine' || e.child_id !== childId) continue
    const name = typeof e.data?.name === 'string' ? e.data.name.trim() : ''
    if (!name) continue
    const k = name.toLowerCase()
    const cur = latest.get(k)
    if (!cur || e.started_at > cur.started_at) latest.set(k, e)
  }
  const out: MedicineDue[] = []
  for (const e of latest.values()) {
    const every = Number(e.data.every_h)
    if (!Number.isFinite(every) || every <= 0 || every > 72) continue
    const lastAt = Date.parse(e.started_at)
    const dose = [e.data.dose, e.data.unit].filter((x) => typeof x === 'string' && x.trim()).join(' ')
    out.push({ eventId: e.id, name: String(e.data.name).trim(), dose: e.data.dose ? dose : '', lastAt, dueAt: lastAt + every * H, everyH: every })
  }
  return out.sort((a, b) => a.dueAt - b.dueAt)
}

// ------------------------------------------------------------------------- pumping
export type Breast = 'left' | 'right'

export interface PumpDue {
  /** The breast to pump next: the one due first. */
  side: Breast
  /** When it was last emptied: the end of its last breastfeed or pumping. */
  lastAt: number
  lastKind: 'nursing' | 'pump'
  /** Usual time between emptyings of that breast around this time of day, minutes. */
  everyMin: number
  dueAt: number
  /** Learned from the logs, or the usual 3 hours. */
  basis: 'logs' | 'default'
  /** The other breast, when it's known too. */
  other?: Omit<PumpDue, 'other'>
}

const MIN = 60_000
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Which breasts an entry emptied: the sides with time or millilitres, or both when not noted. */
function sidesOf(e: Ev): Breast[] {
  const d = e.data ?? {}
  const l = e.type === 'pump' ? num(d.left_ml) > 0 : num(d.left_s) > 0
  const r = e.type === 'pump' ? num(d.right_ml) > 0 : num(d.right_s) > 0
  return l || r ? [...(l ? ['left' as const] : []), ...(r ? ['right' as const] : [])] : ['left', 'right']
}

/** When an emptying ended: its end, or its start plus its logged length. */
function endOf(e: Ev): number {
  if (e.ended_at) return Date.parse(e.ended_at)
  const d = e.data ?? {}
  const secs = num(d.left_s) + num(d.right_s) || num(d.total_s)
  return Date.parse(e.started_at) + secs * 1000
}

function forSide(all: Ev[], side: Breast, now: number, timeZone: string): Omit<PumpDue, 'other'> | null {
  // Emptyings of this breast; a breastfeed and a pumping within 45 minutes are one.
  const sessions: { start: number; end: number; kind: 'nursing' | 'pump' }[] = []
  for (const e of all) {
    if (!sidesOf(e).includes(side)) continue
    const start = Date.parse(e.started_at)
    const end = Math.max(start, endOf(e))
    const last = sessions[sessions.length - 1]
    if (last && start - last.end < 45 * MIN) {
      if (end >= last.end) Object.assign(last, { end, kind: e.type })
    } else sessions.push({ start, end, kind: e.type as 'nursing' | 'pump' })
  }
  const last = sessions[sessions.length - 1]
  if (!last || last.end < now - 2 * 24 * H) return null
  const t0 = localMinute(last.end, timeZone)
  const xs: { v: number; w: number }[] = []
  for (let i = 0; i + 1 < sessions.length; i++) {
    const gap = (sessions[i + 1].start - sessions[i].end) / MIN
    if (gap < 40 || gap > 10 * 60) continue
    let d = Math.abs(localMinute(sessions[i].end, timeZone) - t0)
    d = Math.min(d, 1440 - d)
    // Gaps that began near this time of day, and recent days, count most.
    const w = Math.exp(-((d / 120) ** 2) / 2) * Math.pow(0.5, (now - sessions[i].end) / (3 * 24 * H))
    if (w > 0.01) xs.push({ v: gap, w })
  }
  const weight = xs.reduce((t, x) => t + x.w, 0)
  let every = 180
  let basis: PumpDue['basis'] = 'default'
  if (xs.length >= 3 && weight > 0.5) {
    xs.sort((a, b) => a.v - b.v)
    let acc = 0
    for (const x of xs) {
      acc += x.w
      if (acc >= weight / 2) {
        every = x.v
        break
      }
    }
    every = Math.min(8 * 60, Math.max(90, Math.round(every / 5) * 5))
    basis = 'logs'
  }
  return { side, lastAt: last.end, lastKind: last.kind, everyMin: every, dueAt: last.end + every * MIN, basis }
}

/**
 * When to pump next, breast by breast: from when each was last emptied (by a breastfeed or by
 * pumping, whichever was later) plus the mother's own usual gap for it at that time of day,
 * learned from the last week. Null while feeding or pumping, or with nothing logged lately.
 */
export function pumpDue(events: Ev[], now: number, timeZone: string): PumpDue | null {
  const all = events
    .filter((e) => !e.deleted_at && (e.type === 'nursing' || e.type === 'pump') && Date.parse(e.started_at) <= now && Date.parse(e.started_at) > now - 8 * 24 * H)
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
  if (all.some((e) => e.timer_state && Date.parse(e.started_at) > now - 3 * H)) return null
  const done = all.filter((e) => !e.timer_state)
  const l = forSide(done, 'left', now, timeZone)
  const r = forSide(done, 'right', now, timeZone)
  if (!l || !r) return l ?? r
  const [first, second] = l.dueAt <= r.dueAt ? [l, r] : [r, l]
  return { ...first, other: second }
}

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** One side pumped in one sitting. */
export interface SideSession {
  at: number
  side: Breast | 'both'
  ml: number
  minutes: number
}

/** Pumping entries as side sessions: each side with its millilitres (a total with no sides is 'both'). */
export function sideSessions(events: Ev[]): SideSession[] {
  const out: SideSession[] = []
  for (const e of events) {
    if (e.deleted_at || e.type !== 'pump' || e.timer_state) continue
    const at = Date.parse(e.started_at)
    const minutes = e.ended_at ? (Date.parse(e.ended_at) - at) / MIN : 0
    const l = num(e.data.left_ml)
    const r = num(e.data.right_ml)
    if (l) out.push({ at, side: 'left', ml: l, minutes: r ? minutes / 2 : minutes })
    if (r) out.push({ at, side: 'right', ml: r, minutes: l ? minutes / 2 : minutes })
    if (!l && !r && num(e.data.total_ml)) out.push({ at, side: 'both', ml: num(e.data.total_ml), minutes })
  }
  return out.sort((a, b) => a.at - b.at)
}

/** Typical millilitres from this side at this time of day, from the last two weeks, if known. */
export function expectedMl(events: Ev[], side: Breast, at: number, tz: string, now: number): number | null {
  const t0 = localMinute(at, tz)
  const xs = sideSessions(events.filter((e) => Date.parse(e.started_at) > now - 14 * 24 * H)).filter((s) => {
    if (s.side !== side) return false
    let d = Math.abs(localMinute(s.at, tz) - t0)
    d = Math.min(d, 1440 - d)
    return d <= 120
  })
  return xs.length >= 3 ? Math.round(median(xs.map((s) => s.ml)) / 5) * 5 : null
}

// ------------------------------------------------------------------------- time zones
/** The parts of a moment on the clock in a time zone. */
function parts(t: number, timeZone: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
  const p: Record<string, number> = {}
  for (const x of f.formatToParts(t)) if (x.type !== 'literal') p[x.type] = Number(x.value)
  return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, min: p.minute, s: p.second }
}

/** Minutes since local midnight. */
export function localMinute(t: number, timeZone: string): number {
  const p = parts(t, timeZone)
  return p.h * 60 + p.min
}

/** The moment local midnight began on the day of `t` (ignores a clock change during that day). */
export function localMidnight(t: number, timeZone: string): number {
  const p = parts(t, timeZone)
  const secs = Math.floor(t / 1000) * 1000
  const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - secs
  return Date.UTC(p.y, p.m - 1, p.d) - offset
}

export function clockText(t: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(t)
}

export function hoursText(ms: number): string {
  const mins = Math.round(ms / 60_000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h ? (m ? `${h} h ${m} m` : `${h} h`) : `${m} m`
}

// ------------------------------------------------------------------------- the day's summary
export interface DayCounts {
  sleepMs: number
  sleeps: number
  feeds: number
  breastfeeds: number
  bottles: number
  bottleMl: number
  solids: number
  nappies: number
  wet: number
  dirty: number
  meds: number
}

/** What happened to one baby from `from` until `to` (sleep is cut at the edges). */
export function dayCounts(events: Ev[], childId: string, from: number, to: number): DayCounts {
  const c: DayCounts = { sleepMs: 0, sleeps: 0, feeds: 0, breastfeeds: 0, bottles: 0, bottleMl: 0, solids: 0, nappies: 0, wet: 0, dirty: 0, meds: 0 }
  for (const e of events) {
    if (e.deleted_at || e.child_id !== childId) continue
    const start = Date.parse(e.started_at)
    const inDay = start >= from && start < to
    if (e.type === 'sleep') {
      const end = e.ended_at ? Date.parse(e.ended_at) : e.timer_state ? to : start
      const ms = Math.max(0, Math.min(end, to) - Math.max(start, from))
      c.sleepMs += ms
      if (inDay) c.sleeps++
    } else if (!inDay) {
      continue
    } else if (e.type === 'nursing') {
      c.feeds++
      c.breastfeeds++
    } else if (e.type === 'bottle') {
      c.feeds++
      c.bottles++
      if (typeof e.data.amount_ml === 'number') c.bottleMl += e.data.amount_ml
    } else if (e.type === 'solids') {
      c.feeds++
      c.solids++
    } else if (e.type === 'diaper') {
      c.nappies++
      const k = e.data.kind
      if (k === 'wet' || k === 'mixed') c.wet++
      if (k === 'dirty' || k === 'mixed') c.dirty++
    } else if (e.type === 'medicine') {
      c.meds++
    }
  }
  return c
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// ------------------------------------------------------------------------- vitamins and the week
/** The baby's daily vitamins (children.settings.supplements) not given yet today. */
export function vitaminsLeft(settings: unknown, events: Ev[], childId: string, from: number, to: number): string[] {
  const list = (settings as { supplements?: unknown } | null)?.supplements
  if (!Array.isArray(list)) return []
  const names = list.map((x) => (x && typeof x === 'object' && typeof (x as { name?: unknown }).name === 'string' ? (x as { name: string }).name.trim() : '')).filter(Boolean)
  const given = new Set(
    events
      .filter((e) => !e.deleted_at && e.type === 'medicine' && e.child_id === childId && Date.parse(e.started_at) >= from && Date.parse(e.started_at) < to)
      .map((e) => String(e.data.name ?? '').trim().toLowerCase()),
  )
  return names.filter((n) => !given.has(n.toLowerCase()))
}

export function vitaminText(name: string, left: string[]): { title: string; body: string } {
  const list = left.length === 1 ? left[0] : `${left.slice(0, -1).join(', ')} and ${left[left.length - 1]}`
  return { title: `${list} not given yet today`, body: `${name}’s ${left.length === 1 ? 'vitamin hasn’t' : 'vitamins haven’t'} been logged today. Tap Vitamins on Today once given.` }
}

/**
 * How the last 7 days went against the 7 before: sleep, feeds and nappies a day (over days with
 * anything logged), pumping, vitamins and firsts. `days(i)` gives the start of the day i days
 * before today's (0 = today); the week is the 7 days before today.
 */
export function weekText(name: string, events: Ev[], childId: string, days: (i: number) => number, settings: unknown): { title: string; body: string } | null {
  const week = (first: number) => {
    const ds: DayCounts[] = []
    for (let i = first; i < first + 7; i++) {
      const c = dayCounts(events, childId, days(i), days(i - 1))
      if (c.sleepMs || c.feeds || c.nappies) ds.push(c)
    }
    const a = (f: (c: DayCounts) => number) => (ds.length ? ds.reduce((t, c) => t + f(c), 0) / ds.length : 0)
    const pumped = events
      .filter((e) => !e.deleted_at && e.type === 'pump' && Date.parse(e.started_at) >= days(first + 6) && Date.parse(e.started_at) < days(first - 1))
      .reduce((t, e) => t + (Number(e.data.left_ml) || 0) + (Number(e.data.right_ml) || 0) + (Number(e.data.total_ml) || 0), 0)
    return { n: ds.length, sleep: a((c) => c.sleepMs), feeds: a((c) => c.feeds), nappies: a((c) => c.nappies), pumped: pumped / 7 }
  }
  const now = week(1)
  if (!now.n) return null
  const before = week(8)
  const d = (x: number, y: number, f: (v: number) => string) => {
    const m = f(Math.abs(x - y))
    return before.n && y && m !== '0' && m !== '0 m' ? ` (${x >= y ? '+' : '−'}${m})` : ''
  }
  const one = (v: number) => (Math.round(v * 10) / 10).toString()
  const bits = [
    `Sleep ${hoursText(now.sleep)} a day${d(now.sleep, before.sleep, (v) => hoursText(v))}`,
    `${one(now.feeds)} feeds a day${d(now.feeds, before.feeds, one)}`,
    `${one(now.nappies)} nappies a day`,
  ]
  if (now.pumped) bits.push(`pumped ${Math.round(now.pumped)} ml a day${before.pumped ? ` (${now.pumped >= before.pumped ? '+' : '−'}${Math.round((Math.abs(now.pumped - before.pumped) / before.pumped) * 100)}%)` : ''}`)
  const list = (settings as { supplements?: unknown } | null)?.supplements
  if (Array.isArray(list) && list.length) {
    let given = 0
    for (let i = 1; i <= 7; i++) if (!vitaminsLeft(settings, events, childId, days(i), days(i - 1)).length) given++
    bits.push(`all vitamins on ${given} of 7 days`)
  }
  const firsts = events.filter((e) => !e.deleted_at && e.type === 'milestone' && e.child_id === childId && Date.parse(e.started_at) >= days(7) && Date.parse(e.started_at) < days(0)).length
  if (firsts) bits.push(plural(firsts, 'new first'))
  return { title: `${name}’s week`, body: `${bits.join(' · ')}.` }
}

export function summaryText(name: string, c: DayCounts): { title: string; body: string } {
  const bits: string[] = []
  bits.push(c.sleepMs > 0 ? `Slept ${hoursText(c.sleepMs)}` : 'No sleep logged')
  if (c.feeds) {
    const kinds = [c.breastfeeds && plural(c.breastfeeds, 'breastfeed'), c.bottles && `${plural(c.bottles, 'bottle')}${c.bottleMl ? ` (${c.bottleMl} ml)` : ''}`, c.solids && plural(c.solids, 'solids meal', 'solids meals')].filter(Boolean)
    bits.push(`${plural(c.feeds, 'feed')}: ${kinds.join(', ')}`)
  } else bits.push('no feeds logged')
  if (c.nappies) bits.push(`${plural(c.nappies, 'nappy', 'nappies')} (${c.wet} wet, ${c.dirty} dirty)`)
  else bits.push('no nappies logged')
  if (c.meds) bits.push(plural(c.meds, 'medicine dose'))
  return { title: `${name}’s day so far`, body: `${bits.join(' · ')}.` }
}
