import clsx from 'clsx'
import { Check, Plus, Warning } from '@phosphor-icons/react'
import { TZDate } from '@date-fns/tz'
import { useMemo, useState } from 'react'
import { LogSheet } from '../components/LogSheet'
import { Overlay } from '../components/Overlay'
import { Panel } from '../components/history/bits'
import { saveChildSettings } from '../lib/actions'
import { ALLERGENS, FIRST_FOODS, READY_SIGNS, foodsTried, watching } from '../lib/solids'
import { activeChild, useLeela } from '../lib/store'
import { dayLabel, daysBetween, fmtLongDate } from '../lib/time'

/** Starting solids: readiness, every food so far, allergens and the wait after a new food. */
export function SolidsScreen({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [logging, setLogging] = useState(false)
  const family = useLeela((s) => s.family)!
  const eventsMap = useLeela((s) => s.events)
  const child = activeChild()
  const tz = family.timezone
  const now = Date.now()
  const foods = useMemo(() => (child && open ? foodsTried(Object.values(eventsMap), child.id) : []), [eventsMap, child, open])
  if (!child) return null

  const birth = child.birth_date ? new TZDate(Number(child.birth_date.slice(0, 4)), Number(child.birth_date.slice(5, 7)) - 1 + 6, Number(child.birth_date.slice(8, 10)), tz).getTime() : null
  const daysTo6 = birth ? daysBetween(birth, now, tz) : null
  const ready = new Set<string>(((child.settings?.solids as { ready?: string[] } | undefined)?.ready ?? []).filter((x) => typeof x === 'string'))
  const toggle = (id: string) => {
    const next = new Set(ready)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    void saveChildSettings(child.id, 'solids', { ...((child.settings?.solids as object) ?? {}), ready: [...next] })
  }
  const watch = watching(foods, now)
  const introduced = new Set(foods.flatMap((f) => f.allergens))

  return (
    <>
    <Overlay
      open={open}
      onClose={onClose}
      title="Solids and foods"
      footer={
        <button type="button" onClick={() => setLogging(true)} className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl text-[17px] font-semibold text-white" style={{ background: 'var(--feed)' }}>
          <Plus size={20} weight="bold" aria-hidden="true" /> Log a meal
        </button>
      }
    >
      {daysTo6 !== null && daysTo6 > 0 && (
        <section className="mb-4 rounded-[26px] bg-[var(--feed-soft)] p-4">
          <p className="font-display text-[20px] font-bold leading-tight">
            {child.name} turns 6 months {daysTo6 <= 1 ? 'tomorrow' : `in ${daysTo6} days`}
          </p>
          <p className="mt-1 text-[15px] leading-snug text-ink-2">
            {fmtLongDate(birth!, tz)}. India’s paediatricians (IAP) and the WHO advise starting solids at about 6 months, alongside breast milk. Until then, milk is all she needs.
          </p>
        </section>
      )}

      {(daysTo6 === null || daysTo6 > -60) && (
        <Panel title="Signs she’s ready">
          <ul className="space-y-2">
            {READY_SIGNS.map((s) => {
              const on = ready.has(s.id)
              return (
                <li key={s.id}>
                  <button type="button" onClick={() => toggle(s.id)} aria-pressed={on} className="flex w-full items-center gap-3 rounded-2xl bg-card-2 px-3 py-3 text-left">
                    <span className={clsx('grid h-7 w-7 shrink-0 place-items-center rounded-full ring-2', on ? 'text-white ring-transparent' : 'ring-line')} style={on ? { background: 'var(--feed)' } : undefined}>
                      {on && <Check size={16} weight="bold" />}
                    </span>
                    <span className="text-[15px] leading-snug">{s.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="mt-2 text-[13px] text-ink-3">Tick them as you see them; the family sees the same list. Check with her doctor before starting.</p>
        </Panel>
      )}

      {watch.length > 0 && (
        <section className="mb-4 flex gap-3 rounded-2xl bg-card px-4 py-3">
          <Warning size={22} weight="duotone" className="mt-0.5 shrink-0 text-[var(--feed)]" aria-hidden="true" />
          <p className="text-[15px] leading-snug">
            <strong className="font-semibold">{watch.map((f) => f.name).join(', ')}</strong> {watch.length === 1 ? 'is' : 'are'} new. Many parents wait about 3 days before the next new food, so any reaction is easy to trace.
          </p>
        </section>
      )}

      {foods.length > 0 ? (
        <Panel title={`Foods tried · ${foods.length}`}>
          <ul className="divide-y divide-line">
            {foods.map((f) => (
              <li key={f.name} className="flex items-baseline justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-[16px] font-semibold">
                    {f.name}
                    {f.allergens.length > 0 && <span className="ml-2 rounded-full bg-[var(--feed-soft)] px-2 text-[12px] font-semibold text-[var(--feed)]">allergen</span>}
                  </span>
                  <span className="block text-[13px] text-ink-2">
                    First {dayLabel(f.first, tz, now).toLowerCase()}
                    {f.times > 1 ? `, last ${dayLabel(f.last, tz, now).toLowerCase()}` : ''}
                    {f.liked ? ` · liked ${f.liked}×` : ''}
                    {f.disliked ? ` · not keen ${f.disliked}×` : ''}
                  </span>
                </span>
                <span className="num shrink-0 text-[15px] font-semibold">{f.times}×</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : (
        <Panel title="Common first foods">
          <p className="mb-2 text-[14px] text-ink-2">Ideas many families start with, one at a time, smooth and soft:</p>
          <ul className="flex flex-wrap gap-2">
            {FIRST_FOODS.map((f) => (
              <li key={f} className="rounded-full bg-card-2 px-3 py-1 text-[14px] ring-1 ring-line">
                {f}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Common allergens">
        <ul className="grid grid-cols-2 gap-2">
          {ALLERGENS.map((a) => {
            const on = introduced.has(a.id)
            return (
              <li key={a.id} className={clsx('flex items-center gap-2 rounded-2xl px-3 py-2.5 text-[15px]', on ? 'bg-[var(--growth-soft)]' : 'bg-card-2')}>
                <span className={clsx('grid h-6 w-6 shrink-0 place-items-center rounded-full', on ? 'text-white' : 'ring-2 ring-line')} style={on ? { background: 'var(--growth)' } : undefined}>
                  {on && <Check size={14} weight="bold" />}
                </span>
                {a.label}
              </li>
            )
          })}
        </ul>
        <p className="mt-2 text-[13px] text-ink-3">Ticked when a food with it has been logged. Current advice is to introduce these early and keep offering them, one at a time; ask her doctor first if she has eczema or a known allergy.</p>
      </Panel>
    </Overlay>
    {logging && <LogSheet open onClose={() => setLogging(false)} type="solids" />}
    </>
  )
}
