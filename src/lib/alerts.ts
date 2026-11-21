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
}

export const DEFAULT_ALERTS: AlertPrefs = { sweetspot: true, medicine: true, vaccines: true, summary: true, summaryAt: '20:30' }

export function readAlerts(prefs: object | null | undefined): AlertPrefs {
  const a = ((prefs as { alerts?: unknown } | null | undefined)?.alerts ?? {}) as Record<string, unknown>
  const flag = (k: keyof AlertPrefs) => (typeof a[k] === 'boolean' ? (a[k] as boolean) : (DEFAULT_ALERTS[k] as boolean))
  const at = typeof a.summaryAt === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(a.summaryAt) ? a.summaryAt : DEFAULT_ALERTS.summaryAt
  return { sweetspot: flag('sweetspot'), medicine: flag('medicine'), vaccines: flag('vaccines'), summary: flag('summary'), summaryAt: at }
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
