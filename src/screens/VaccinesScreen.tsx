import clsx from 'clsx'
import { Check, Syringe } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { Overlay } from '../components/Overlay'
import { Sheet } from '../components/Sheet'
import { Button, Choices, TextInput } from '../components/ui'
import { deleteEvent, logEvent, saveChildSettings } from '../lib/actions'
import { activeChild, useLeela } from '../lib/store'
import { loadAllHistory } from '../lib/sync'
import { atLocalTime, fmtShortDate } from '../lib/time'
import { type PlannedVisit, inDaysText, localDay, nextVisit, readVaccineSettings, vaccinePlan } from '../lib/vaccines'

const dateText = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** Leela's vaccine schedule: what's coming, what's been given, and marking a visit as done. */
export function VaccinesScreen({ open, onClose }: { open: boolean; onClose: () => void }) {
  const family = useLeela((s) => s.family)!
  const events = useLeela((s) => s.events)
  useLeela((s) => s.children)
  const child = activeChild()
  const tz = family.timezone
  const today = localDay(Date.now(), tz)
  const [marking, setMarking] = useState<PlannedVisit | null>(null)
  const [changing, setChanging] = useState<PlannedVisit | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [askedBefore, setAskedBefore] = useState(false)

  useEffect(() => {
    // Vaccine entries can be months old: make sure every one is on the phone.
    if (open) void loadAllHistory()
  }, [open])

  const all = useMemo(() => Object.values(events), [events])
  const plan = useMemo(() => (child && open ? vaccinePlan(child, all, today) : []), [child, all, today, open])
  if (!child) return null

  const settings = readVaccineSettings(child.settings)
  const loggedAny = all.some((e) => !e.deleted_at && e.type === 'symptom' && e.child_id === child.id && Array.isArray(e.data.vax))
  const older = all
    .filter((e) => !e.deleted_at && e.type === 'symptom' && e.child_id === child.id && e.data.kind === 'vaccine' && !Array.isArray(e.data.vax))
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
  const overdue = plan.filter((p) => !p.done && p.inDays < 0)
  const todo = plan.filter((p) => !p.done)
  const done = plan.filter((p) => p.done)
  const next = nextVisit(plan)

  // First time here with past visits not marked: offer to mark them all as already given.
  const offerBefore = !askedBefore && !loggedAny && !settings.before?.length && overdue.length > 0
  const markBefore = async () => {
    const ids = overdue.flatMap((p) => p.left.map((d) => d.id))
    await saveChildSettings(child.id, 'vaccines', { ...settings, before: [...new Set([...(settings.before ?? []), ...ids])] })
    setAskedBefore(true)
    useLeela.getState().toast({ text: 'Marked as already given.' })
  }

  return (
    <Overlay open={open} onClose={onClose} title={`${child.name}’s vaccines`}>
      {!child.birth_date ? (
        <p className="rounded-3xl bg-card px-5 py-6 text-[16px]">Add {child.name}’s birth date on the Family tab and Leela will work out when each vaccine is due.</p>
      ) : (
        <>
          <p className="mb-4 text-[15px] leading-snug text-ink-2">
            India’s IAP schedule (2023), from {child.name}’s birth date. Your doctor’s card comes first: tap <strong>Change</strong> to match any date or dose to it.
          </p>

          {next && !offerBefore && (
            <div className="mb-5 rounded-[26px] p-4" style={{ background: 'var(--health-soft)' }}>
              <div className="text-[14px] font-semibold" style={{ color: 'var(--health)' }}>
                {next.inDays < 0 ? 'Overdue' : 'Next'}
              </div>
              <div className="font-display text-[22px] font-bold leading-tight">
                {next.visit.label} · {inDaysText(next.inDays)}
              </div>
              <div className="text-[15px] text-ink-2">{next.left.map((d) => d.name).join(', ')}</div>
            </div>
          )}

          {offerBefore && (
            <div className="mb-5 rounded-[26px] bg-card p-4 shadow-lift">
              <h2 className="font-display text-[19px] font-bold leading-tight">Already had the earlier ones?</h2>
              <p className="mt-1 text-[15px] text-ink-2">
                {overdue.length === 1 ? `The ${overdue[0].visit.label} visit is` : `${overdue.length} visits (up to ${overdue[overdue.length - 1].visit.label}) are`} before today. If {child.name} has had them, mark them done in one tap.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button size="md" onClick={() => void markBefore()}>
                  Yes, all given
                </Button>
                <Button size="md" variant="secondary" onClick={() => setAskedBefore(true)}>
                  I’ll mark them
                </Button>
              </div>
            </div>
          )}

          <h2 className="mb-2 font-display text-[20px] font-bold">To do</h2>
          {todo.length === 0 && <p className="mb-4 text-[15px] text-ink-2">Everything on the schedule is done.</p>}
          <ul className="mb-6 space-y-3">
            {todo.slice(0, 8).map((p) => (
              <VisitCard key={p.visit.id} p={p} onMark={() => setMarking(p)} onChange={() => setChanging(p)} />
            ))}
          </ul>
          {todo.length > 8 && <p className="-mt-3 mb-6 text-[14px] text-ink-2">And {todo.length - 8} more visits later on, up to age 18.</p>}

          {done.length > 0 && (
            <>
              <button type="button" onClick={() => setShowDone((v) => !v)} className="mb-2 flex min-h-11 w-full items-center justify-between font-display text-[20px] font-bold">
                Done ({done.length}) <span className="font-sans text-[15px] font-semibold text-brand">{showDone ? 'Hide' : 'Show'}</span>
              </button>
              {showDone && (
                <ul className="mb-6 space-y-3">
                  {done.map((p) => (
                    <VisitCard key={p.visit.id} p={p} onMark={() => setMarking(p)} onChange={() => setChanging(p)} />
                  ))}
                </ul>
              )}
            </>
          )}

          {older.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-1 font-display text-[18px] font-bold">Logged before this list</h2>
              <ul className="text-[15px] text-ink-2">
                {older.map((e) => (
                  <li key={e.id}>
                    {fmtShortDate(e.started_at, tz)}: {e.data.vaccine || 'Vaccine'}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="text-[13px] text-ink-3">Leela only keeps track. Which vaccines and when is always your doctor’s call.</p>
        </>
      )}

      {marking && <MarkSheet p={marking} tz={tz} today={today} childId={child.id} onClose={() => setMarking(null)} />}
      {changing && <ChangeSheet p={changing} settings={settings} childId={child.id} onClose={() => setChanging(null)} />}
    </Overlay>
  )
}

function VisitCard({ p, onMark, onChange }: { p: PlannedVisit; onMark: () => void; onChange: () => void }) {
  const late = !p.done && p.inDays < 0
  return (
    <li className="rounded-[22px] bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-display text-[19px] font-bold leading-tight">{p.visit.label}</div>
          <div className={clsx('text-[14px]', late ? 'font-semibold text-[var(--health)]' : 'text-ink-2')}>
            {p.done ? 'Done' : `${dateText(p.due)}${p.until ? ` – ${dateText(p.until)}` : ''} · ${inDaysText(p.inDays)}`}
            {p.moved && !p.done ? ' · your date' : ''}
          </div>
        </div>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl" style={{ background: 'var(--health-soft)', color: 'var(--health)' }}>
          {p.done ? <Check size={22} weight="bold" /> : <Syringe size={22} />}
        </span>
      </div>
      <ul className="mt-2 space-y-1">
        {p.doses.map((x) => (
          <li key={x.dose.id} className="flex items-baseline justify-between gap-2 text-[15px]">
            <span className={clsx(x.status === 'skipped' && 'text-ink-3 line-through')}>
              <strong className="font-semibold">{x.dose.name}</strong> <span className="text-ink-2">· {x.dose.about}</span>
            </span>
            <span className="shrink-0 text-[13px] text-ink-2">
              {x.status === 'given' && x.givenAt ? `Given ${new Date(x.givenAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : x.status === 'before' ? 'Given' : x.status === 'skipped' ? 'Not having' : ''}
            </span>
          </li>
        ))}
      </ul>
      {p.visit.note && <p className="mt-2 text-[13px] text-ink-3">{p.visit.note}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {!p.done ? (
          <Button size="md" tone="health" onClick={onMark}>
            Mark given
          </Button>
        ) : (
          <span />
        )}
        <Button size="md" variant="secondary" onClick={onChange}>
          Change
        </Button>
      </div>
    </li>
  )
}

/** Marks a visit's doses as given today (or another day), as a Vaccine entry. */
function MarkSheet({ p, tz, today, childId, onClose }: { p: PlannedVisit; tz: string; today: string; childId: string; onClose: () => void }) {
  const [day, setDay] = useState(today)
  const [ids, setIds] = useState<string[]>(p.left.map((d) => d.id))
  const save = async () => {
    const doses = p.left.filter((d) => ids.includes(d.id))
    if (!doses.length) return
    const at = day === today ? new Date() : atLocalTime(new Date(`${day}T12:00:00Z`), '11:00', tz)
    const e = await logEvent(
      { type: 'symptom', childId, startedAt: at.toISOString(), data: { kind: 'vaccine', vaccine: `${p.visit.label}: ${doses.map((d) => d.name).join(', ')}`, vax: doses.map((d) => d.id) } },
      { quiet: true },
    )
    useLeela.getState().toast({ text: 'Vaccines marked as given.', action: { label: 'Undo', run: () => void deleteEvent(e.id, { quiet: true }) } })
    onClose()
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title={`${p.visit.label} vaccines`}
      tone="health"
      footer={
        <Button tone="health" className="w-full" onClick={() => void save()} disabled={!ids.length || !day}>
          Save as given
        </Button>
      }
    >
      <TextInput label="Given on" type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} />
      <div className="mb-2 text-[15px] font-semibold text-ink-2">Which ones (tap to leave one out)</div>
      <div className="mb-4 flex flex-wrap gap-2">
        {p.left.map((d) => {
          const on = ids.includes(d.id)
          return (
            <button
              key={d.id}
              type="button"
              role="switch"
              aria-checked={on}
              onClick={() => setIds((v) => (on ? v.filter((x) => x !== d.id) : [...v, d.id]))}
              className={clsx('min-h-11 rounded-full px-4 text-[15px] font-semibold', !on && 'bg-card-2 text-ink-2 ring-1 ring-line')}
              style={on ? { background: 'var(--health)', color: '#fff' } : undefined}
            >
              {d.name}
            </button>
          )
        })}
      </div>
      <p className="text-[14px] text-ink-2">It’s saved as a Vaccine entry in the timeline and the diary book. Anything left out stays on the to-do list.</p>
    </Sheet>
  )
}

type DoseChoice = 'todo' | 'before' | 'skip'

/** A different date for a visit, and doses that were had already or aren't being given. */
function ChangeSheet({ p, settings, childId, onClose }: { p: PlannedVisit; settings: ReturnType<typeof readVaccineSettings>; childId: string; onClose: () => void }) {
  const [day, setDay] = useState(p.due)
  const [choice, setChoice] = useState<Record<string, DoseChoice>>(() =>
    Object.fromEntries(p.doses.filter((x) => x.status !== 'given').map((x) => [x.dose.id, x.status === 'before' ? 'before' : x.status === 'skipped' ? 'skip' : 'todo'])),
  )
  const save = async () => {
    const dates = { ...(settings.dates ?? {}) }
    if (day && day !== p.due) dates[p.visit.id] = day
    const ids = Object.keys(choice)
    const before = (settings.before ?? []).filter((x) => !ids.includes(x)).concat(ids.filter((x) => choice[x] === 'before'))
    const skip = (settings.skip ?? []).filter((x) => !ids.includes(x)).concat(ids.filter((x) => choice[x] === 'skip'))
    await saveChildSettings(childId, 'vaccines', { dates, before, skip })
    onClose()
  }
  const reset = async () => {
    const dates = { ...(settings.dates ?? {}) }
    delete dates[p.visit.id]
    await saveChildSettings(childId, 'vaccines', { ...settings, dates })
    onClose()
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Change ${p.visit.label}`}
      tone="health"
      footer={
        <Button tone="health" className="w-full" onClick={() => void save()}>
          Save
        </Button>
      }
    >
      <TextInput label="Due on" type="date" value={day} onChange={(e) => setDay(e.target.value)} hint="The date on your doctor’s card, if it’s different." />
      {p.moved && (
        <Button variant="secondary" size="md" className="-mt-2 mb-5" onClick={() => void reset()}>
          Back to the schedule’s date
        </Button>
      )}
      {p.doses
        .filter((x) => x.status !== 'given')
        .map((x) => (
          <div key={x.dose.id} className="mb-4">
            <div className="mb-1.5 text-[15px] font-semibold">
              {x.dose.name} <span className="font-normal text-ink-2">· {x.dose.about}</span>
            </div>
            <Choices<DoseChoice>
              options={[
                { id: 'todo', label: 'To do' },
                { id: 'before', label: 'Had already' },
                { id: 'skip', label: 'Not having' },
              ]}
              value={choice[x.dose.id]}
              onChange={(v) => v && setChoice((c) => ({ ...c, [x.dose.id]: v }))}
              tone="health"
              compact
            />
          </div>
        ))}
      {p.doses.some((x) => x.status === 'given') && <p className="text-[14px] text-ink-2">Doses saved as given are entries in the timeline: delete the entry there to undo one.</p>}
    </Sheet>
  )
}
