import { CaretRight, Pill, Syringe } from '@phosphor-icons/react'
import { useMemo } from 'react'
import { editEvent } from '../lib/actions'
import { medicinesDue } from '../lib/alerts'
import { useLeela } from '../lib/store'
import { durationText, fmtTime } from '../lib/time'
import type { Child, LeelaEvent } from '../lib/types'
import { inDaysText, localDay, nextVisit, vaccinePlan } from '../lib/vaccines'
import { Button } from './ui'

/**
 * On Today: medicines with a reminder (when the next dose is due) and the next vaccines, when
 * they're coming up within a month or are overdue.
 */
export function HealthCards({ child, events, now, tz, onGiveDose }: { child: Child; events: LeelaEvent[]; now: number; tz: string; onGiveDose: (last: LeelaEvent) => void }) {
  const set = useLeela((s) => s.set)
  const meds = useMemo(() => medicinesDue(events, child.id).filter((m) => now < m.dueAt + 12 * 3_600_000), [events, child.id, now])
  const today = localDay(now, tz)
  const next = useMemo(() => nextVisit(vaccinePlan(child, events, today)), [child, events, today])
  const showVax = next && next.inDays <= 30 && next.inDays >= -60

  if (!meds.length && !showVax) return null
  return (
    <div className="mt-3 flex flex-col gap-3">
      {meds.map((m) => {
        const last = events.find((e) => e.id === m.eventId)
        const late = now >= m.dueAt
        return (
          <section key={m.eventId} className="rounded-[26px] p-4" style={{ background: 'var(--health-soft)' }} aria-label={`${m.name} reminder`}>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0" style={{ color: 'var(--health)' }}>
                <Pill size={26} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-display text-[19px] font-bold leading-tight">
                  {late ? `${m.name} is due now` : `Next ${m.name} at ${fmtTime(m.dueAt, tz)}`}
                </div>
                <div className="text-[14px] text-ink-2">
                  Last given {fmtTime(m.lastAt, tz)}
                  {m.dose ? ` (${m.dose})` : ''}, every {m.everyH} h. {late ? `Due ${durationText(now - m.dueAt)} ago.` : `In ${durationText(m.dueAt - now)}.`}
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button size="md" tone="health" onClick={() => last && onGiveDose(last)} disabled={!last}>
                Log this dose
              </Button>
              <Button
                size="md"
                variant="secondary"
                onClick={() => {
                  if (!last) return
                  void editEvent(last.id, { data: { ...last.data, every_h: null } })
                  useLeela.getState().toast({ text: `No more ${m.name} reminders.`, action: { label: 'Undo', run: () => void editEvent(last.id, { data: { ...last.data } }) } })
                }}
              >
                Stop reminders
              </Button>
            </div>
          </section>
        )
      })}

      {showVax && next && (
        <button
          type="button"
          onClick={() => set({ overlay: { kind: 'vaccines' } })}
          className="flex items-start gap-3 rounded-[26px] p-4 text-left"
          style={{ background: 'var(--health-soft)' }}
        >
          <span className="mt-0.5 shrink-0" style={{ color: 'var(--health)' }}>
            <Syringe size={26} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-[19px] font-bold leading-tight">
              {next.inDays < 0 ? `${next.visit.label} vaccines: overdue` : `${next.visit.label} vaccines ${inDaysText(next.inDays)}`}
            </span>
            <span className="block truncate text-[14px] text-ink-2">{next.left.map((d) => d.name).join(', ')}</span>
          </span>
          <CaretRight size={20} weight="bold" className="mt-1 shrink-0 text-ink-3" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
