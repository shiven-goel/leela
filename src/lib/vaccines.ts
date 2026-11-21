// Baby vaccines: India's IAP schedule (IAP-ACVIP 2023, birth to 18 years), worked out from the
// baby's birth date. Pure date maths with no libraries, so the reminder function on the server
// can use exactly the same code (bundled into supabase/functions/sweetspot-push/alerts.js).
//
// What's been given comes from the entries themselves: a "Vaccine" entry (type symptom, kind
// vaccine) lists the dose ids it covers in data.vax. The family's own changes (a different date
// the doctor gave, a dose they're not having) live in the baby's settings under "vaccines".

export interface Dose {
  id: string
  /** Short name, as on a vaccination card. */
  name: string
  /** What it protects against, in plain words. */
  about: string
  /** Only for some babies, or a choice to make with the doctor. */
  optional?: boolean
}

export interface Visit {
  id: string
  /** "6 weeks", "9 months"… */
  label: string
  /** When it's due, counted from birth. */
  weeks?: number
  months?: number
  years?: number
  /** Last sensible day, counted from birth (for ranges like 6–9 months), if any. */
  untilMonths?: number
  doses: Dose[]
  note?: string
}

const d = (id: string, name: string, about: string, optional?: boolean): Dose => ({ id, name, about, ...(optional ? { optional } : {}) })

export const SCHEDULE: Visit[] = [
  {
    id: 'birth',
    label: 'At birth',
    weeks: 0,
    doses: [d('bcg', 'BCG', 'tuberculosis'), d('opv0', 'OPV 0', 'polio (drops)'), d('hepb1', 'Hep B 1', 'hepatitis B')],
    note: 'Usually given in the hospital before going home.',
  },
  {
    id: 'w6',
    label: '6 weeks',
    weeks: 6,
    doses: [
      d('dtp1', 'DTwP/DTaP 1', 'diphtheria, tetanus, whooping cough'),
      d('ipv1', 'IPV 1', 'polio (injection)'),
      d('hib1', 'Hib 1', 'Hib meningitis and pneumonia'),
      d('hepb2', 'Hep B 2', 'hepatitis B'),
      d('rota1', 'Rotavirus 1', 'rotavirus diarrhoea (drops)'),
      d('pcv1', 'PCV 1', 'pneumococcal pneumonia and meningitis'),
    ],
    note: 'Often one combined "hexavalent" injection plus PCV and rotavirus drops.',
  },
  {
    id: 'w10',
    label: '10 weeks',
    weeks: 10,
    doses: [
      d('dtp2', 'DTwP/DTaP 2', 'diphtheria, tetanus, whooping cough'),
      d('ipv2', 'IPV 2', 'polio (injection)'),
      d('hib2', 'Hib 2', 'Hib meningitis and pneumonia'),
      d('hepb3', 'Hep B 3', 'hepatitis B'),
      d('rota2', 'Rotavirus 2', 'rotavirus diarrhoea (drops)'),
      d('pcv2', 'PCV 2', 'pneumococcal pneumonia and meningitis'),
    ],
  },
  {
    id: 'w14',
    label: '14 weeks',
    weeks: 14,
    doses: [
      d('dtp3', 'DTwP/DTaP 3', 'diphtheria, tetanus, whooping cough'),
      d('ipv3', 'IPV 3', 'polio (injection)'),
      d('hib3', 'Hib 3', 'Hib meningitis and pneumonia'),
      d('hepb4', 'Hep B 4', 'hepatitis B'),
      d('rota3', 'Rotavirus 3', 'rotavirus diarrhoea (drops)', true),
      d('pcv3', 'PCV 3', 'pneumococcal pneumonia and meningitis'),
    ],
    note: 'The third rotavirus dose depends on the brand used.',
  },
  { id: 'm6', label: '6 months', months: 6, doses: [d('flu1', 'Influenza 1', 'flu')] },
  { id: 'm7', label: '7 months', months: 7, doses: [d('flu2', 'Influenza 2', 'flu')], note: 'Four weeks after the first flu dose.' },
  {
    id: 'm6to9',
    label: '6–9 months',
    months: 6,
    untilMonths: 9,
    doses: [d('tcv', 'Typhoid conjugate', 'typhoid')],
    note: 'One dose any time from 6 to 9 months.',
  },
  { id: 'm9', label: '9 months', months: 9, doses: [d('mmr1', 'MMR 1', 'measles, mumps, rubella')] },
  { id: 'm12', label: '12 months', months: 12, doses: [d('hepa1', 'Hep A 1', 'hepatitis A')] },
  {
    id: 'm15',
    label: '15 months',
    months: 15,
    doses: [d('mmr2', 'MMR 2', 'measles, mumps, rubella'), d('var1', 'Varicella 1', 'chickenpox'), d('pcvb', 'PCV booster', 'pneumococcal pneumonia and meningitis')],
  },
  {
    id: 'm16',
    label: '16–18 months',
    months: 16,
    untilMonths: 18,
    doses: [
      d('dtpb1', 'DTwP/DTaP booster 1', 'diphtheria, tetanus, whooping cough'),
      d('hibb1', 'Hib booster', 'Hib meningitis and pneumonia'),
      d('ipvb1', 'IPV booster 1', 'polio (injection)'),
    ],
  },
  {
    id: 'm18',
    label: '18–19 months',
    months: 18,
    untilMonths: 19,
    doses: [d('hepa2', 'Hep A 2', 'hepatitis A', true), d('var2', 'Varicella 2', 'chickenpox')],
    note: 'Hep A 2 is only needed with the inactivated Hep A vaccine. Varicella 2 is 3–6 months after the first.',
  },
  { id: 'y2', label: '2 years', years: 2, doses: [d('flu_y2', 'Influenza (yearly)', 'flu')], note: 'Once a year until 5, ideally before the monsoon.' },
  { id: 'y3', label: '3 years', years: 3, doses: [d('flu_y3', 'Influenza (yearly)', 'flu')] },
  { id: 'y4', label: '4 years', years: 4, doses: [d('flu_y4', 'Influenza (yearly)', 'flu')] },
  {
    id: 'y4to6',
    label: '4–6 years',
    years: 4,
    untilMonths: 72,
    doses: [
      d('dtpb2', 'DTwP/DTaP booster 2', 'diphtheria, tetanus, whooping cough'),
      d('ipvb2', 'IPV booster 2', 'polio (injection)'),
      d('mmr3', 'MMR 3', 'measles, mumps, rubella'),
    ],
  },
  { id: 'y5', label: '5 years', years: 5, doses: [d('flu_y5', 'Influenza (yearly)', 'flu')] },
  { id: 'y9', label: '9–14 years', years: 9, untilMonths: 168, doses: [d('hpv1', 'HPV 1', 'HPV (cervical and other cancers)'), d('hpv2', 'HPV 2', 'HPV, 6 months after the first')] },
  { id: 'y10', label: '10 years', years: 10, doses: [d('tdap', 'Tdap', 'tetanus, diphtheria, whooping cough')] },
  { id: 'y16', label: '16–18 years', years: 16, untilMonths: 216, doses: [d('td', 'Td', 'tetanus, diphtheria')] },
]

const DOSE_BY_ID = new Map(SCHEDULE.flatMap((v) => v.doses.map((x) => [x.id, { dose: x, visit: v }] as const)))
export const doseById = (id: string) => DOSE_BY_ID.get(id)?.dose

// ------------------------------------------------------------------------- dates (yyyy-mm-dd)
function parseDay(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null
}
const dayStr = (d: Date) => d.toISOString().slice(0, 10)

/** Adds calendar months, keeping the day (31 Jan + 1 month = 28/29 Feb). */
function addMonths(d: Date, n: number): Date {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + n
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last)))
}

export function visitDueDate(v: Visit, birth: string): string | null {
  const b = parseDay(birth)
  if (!b) return null
  if (v.weeks !== undefined) return dayStr(new Date(b.getTime() + v.weeks * 7 * 86_400_000))
  return dayStr(addMonths(b, (v.months ?? 0) + (v.years ?? 0) * 12))
}

/** The last day of a visit's window, if it has one (6–9 months: the 9-month day). */
export function visitUntilDate(v: Visit, birth: string): string | null {
  const b = parseDay(birth)
  return b && v.untilMonths !== undefined ? dayStr(addMonths(b, v.untilMonths)) : null
}

/** Whole days from `from` to `to` (both yyyy-mm-dd). */
export function daysUntil(to: string, from: string): number {
  const a = parseDay(to)
  const b = parseDay(from)
  return a && b ? Math.round((a.getTime() - b.getTime()) / 86_400_000) : 0
}

/** Today's date (yyyy-mm-dd) in a time zone. */
export function localDay(t: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(t)
  } catch {
    return new Date(t).toISOString().slice(0, 10)
  }
}

// ------------------------------------------------------------------------- the family's plan
export interface VaccineSettings {
  /** A different date for a visit (what the doctor wrote on the card). */
  dates?: Record<string, string>
  /** Doses the family isn't having. */
  skip?: string[]
  /** Doses given before the family started marking them in Leela (no date known). */
  before?: string[]
}

export function readVaccineSettings(settings: Record<string, unknown> | null | undefined): VaccineSettings {
  const v = (settings?.vaccines ?? {}) as Record<string, unknown>
  const dates: Record<string, string> = {}
  if (v.dates && typeof v.dates === 'object') {
    for (const [k, val] of Object.entries(v.dates as Record<string, unknown>)) if (typeof val === 'string' && parseDay(val)) dates[k] = val
  }
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((y): y is string => typeof y === 'string') : [])
  return { dates, skip: list(v.skip), before: list(v.before) }
}

interface VaxEvent {
  id: string
  type: string
  child_id: string | null
  started_at: string
  deleted_at: string | null
  data: Record<string, unknown>
}

export type DoseStatus = 'given' | 'before' | 'skipped' | 'due'

export interface PlannedVisit {
  visit: Visit
  /** When it's due: the family's own date if they set one, otherwise from the schedule. */
  due: string
  until: string | null
  /** The family changed the date. */
  moved: boolean
  doses: { dose: Dose; status: DoseStatus; givenAt?: string; eventId?: string }[]
  /** Every dose given or skipped. */
  done: boolean
  /** Doses still to give. */
  left: Dose[]
  /** Days from today to the due date (negative: overdue). */
  inDays: number
}

/** Each dose id that a Vaccine entry covers, with when and which entry. */
export function givenDoses(events: VaxEvent[], childId: string): Map<string, { at: string; eventId: string }> {
  const out = new Map<string, { at: string; eventId: string }>()
  for (const e of events) {
    if (e.deleted_at || e.type !== 'symptom' || e.child_id !== childId || e.data?.kind !== 'vaccine') continue
    const ids = Array.isArray(e.data.vax) ? (e.data.vax as unknown[]) : []
    for (const id of ids) if (typeof id === 'string' && !out.has(id)) out.set(id, { at: e.started_at, eventId: e.id })
  }
  return out
}

export function vaccinePlan(
  child: { id: string; birth_date: string | null; settings?: Record<string, unknown> | null },
  events: VaxEvent[],
  today: string,
): PlannedVisit[] {
  if (!child.birth_date) return []
  const cfg = readVaccineSettings(child.settings)
  const given = givenDoses(events, child.id)
  const skip = new Set(cfg.skip)
  const before = new Set(cfg.before)
  return SCHEDULE.map((visit) => {
    const own = cfg.dates?.[visit.id]
    const due = own ?? visitDueDate(visit, child.birth_date!)!
    const doses = visit.doses.map((dose) => {
      const g = given.get(dose.id)
      if (g) return { dose, status: 'given' as const, givenAt: g.at, eventId: g.eventId }
      if (before.has(dose.id)) return { dose, status: 'before' as const }
      return { dose, status: skip.has(dose.id) ? ('skipped' as const) : ('due' as const) }
    })
    const left = doses.filter((x) => x.status === 'due').map((x) => x.dose)
    return {
      visit,
      due,
      until: own ? null : visitUntilDate(visit, child.birth_date!),
      moved: Boolean(own),
      doses,
      done: left.length === 0,
      left,
      inDays: daysUntil(due, today),
    }
  })
}

/** The next visit with doses still to give (overdue ones first), or null. */
export function nextVisit(plan: PlannedVisit[]): PlannedVisit | null {
  return plan.find((p) => !p.done) ?? null
}

/** "today", "tomorrow", "in 5 days", "3 days ago". */
export function inDaysText(n: number): string {
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n === -1) return 'yesterday'
  if (n > 1) return n < 14 ? `in ${n} days` : n < 60 ? `in ${Math.round(n / 7)} weeks` : `in ${Math.round(n / 30.4)} months`
  const a = -n
  return a < 14 ? `${a} days ago` : a < 60 ? `${Math.round(a / 7)} weeks ago` : `${Math.round(a / 30.4)} months ago`
}

/** Vaccine reminders: two days before a visit and on the day itself, while doses are left. */
export function vaccineReminder(plan: PlannedVisit[], name: string): { slot: string; title: string; body: string } | null {
  for (const p of plan) {
    if (p.done) continue
    if (p.inDays !== 2 && p.inDays !== 0) continue
    const when = p.inDays === 0 ? 'today' : 'in 2 days'
    return {
      slot: `vax/${p.visit.id}/${p.due}/${p.inDays}`,
      title: `${name}’s vaccines are due ${when}`,
      body: `${p.visit.label}: ${p.left.map((x) => x.name).join(', ')}. Tap to see them or mark them given.`,
    }
  }
  return null
}
