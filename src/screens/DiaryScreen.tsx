import clsx from 'clsx'
import { BookOpenText, CaretDown, ClockCounterClockwise, NotePencil, Star } from '@phosphor-icons/react'
import { TZDate } from '@date-fns/tz'
import { useMemo, useState } from 'react'
import { LogSheet } from '../components/LogSheet'
import { PhotoThumb } from '../components/PhotoPicker'
import { Button } from '../components/ui'
import { eventTitle } from '../lib/describe'
import { activityLabel, dayAggs } from '../lib/insights'
import { daysOf, lifeMonths, rangeText, type Period } from '../lib/period'
import { activeChild, useLeela } from '../lib/store'
import { addDaysTz, ageText, durationText, fmtLongDate, fmtShortDate } from '../lib/time'
import type { Child, EventType, Family, LeelaEvent } from '../lib/types'
import { fmtWeight } from '../lib/units'
import { NoteCard } from './NotesScreen'

const isMemory = (e: LeelaEvent) => e.type === 'milestone' || e.type === 'note' || e.photo_paths.length > 0

/** Leela's story: on this day before, then month by month of her life, or every photo. */
export function DiaryScreen() {
  const family = useLeela((s) => s.family)!
  const eventsMap = useLeela((s) => s.events)
  const segmentsMap = useLeela((s) => s.segments)
  const userId = useLeela((s) => s.userId)
  const set = useLeela((s) => s.set)
  const child = activeChild()
  const [sheet, setSheet] = useState<{ type: EventType; edit?: LeelaEvent } | null>(null)
  const [view, setView] = useState<'story' | 'photos'>('story')
  const tz = family.timezone
  const now = Date.now()

  const events = useMemo(() => Object.values(eventsMap).filter((e) => !e.deleted_at), [eventsMap])
  const memories = useMemo(() => events.filter((e) => e.child_id === child?.id && isMemory(e)).sort((a, b) => b.started_at.localeCompare(a.started_at)), [events, child?.id])
  const photos = useMemo(() => memories.flatMap((e) => e.photo_paths.map((p) => ({ p, e }))), [memories])
  const months = useMemo(() => (child?.birth_date ? lifeMonths(child.birth_date, tz, now).reverse() : []), [child?.birth_date, tz]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!child) return <p className="px-5 pt-10 text-center text-ink-2">Add your baby first, from the Today tab.</p>
  const open = (e: LeelaEvent) => (e.type === 'note' ? set({ overlay: { kind: 'note', id: e.id } }) : setSheet({ type: e.type, edit: e }))
  const lookBack = onThisDay(memories, tz, now)
  const undated = months.length ? memories.filter((e) => Date.parse(e.started_at) < months[months.length - 1].period.from) : memories

  return (
    <div className="mx-auto max-w-[560px] px-5 pb-32">
      <header className="safe-top pb-4">
        <h1 className="font-display text-[30px] font-extrabold leading-tight">{child.name}’s diary</h1>
        <p className="text-[15px] text-ink-2">{child.birth_date ? `Born ${fmtLongDate(`${child.birth_date}T12:00:00`, tz)} · ${ageText(child.birth_date)}` : 'Firsts, notes and photos, all in one place.'}</p>
      </header>

      {lookBack && (
        <section className="mb-5 overflow-hidden rounded-[26px] bg-card" aria-label="On this day">
          {lookBack.e.photo_paths[0] && (
            <div className="aspect-[16/9]">
              <PhotoThumb path={lookBack.e.photo_paths[0]} />
            </div>
          )}
          <button type="button" onClick={() => open(lookBack.e)} className="block w-full p-4 text-left">
            <span className="flex items-center gap-1.5 text-[13px] font-bold tracking-wide text-[var(--milestone)] uppercase">
              <ClockCounterClockwise size={16} weight="bold" aria-hidden="true" /> {lookBack.label}
            </span>
            <span className="mt-1 block font-display text-[20px] font-bold leading-tight">{lookBack.e.type === 'note' ? noteHeading(lookBack.e) : eventTitle(lookBack.e, family)}</span>
            <span className="block text-[14px] text-ink-2">{fmtLongDate(lookBack.e.started_at, tz)}</span>
          </button>
        </section>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3">
        <button type="button" onClick={() => setSheet({ type: 'milestone' })} className="flex h-14 items-center justify-center gap-2 rounded-3xl bg-card text-[16px] font-semibold">
          <Star size={22} weight="duotone" style={{ color: 'var(--milestone)' }} aria-hidden="true" /> Add a first
        </button>
        <button type="button" onClick={() => set({ overlay: { kind: 'note' } })} className="flex h-14 items-center justify-center gap-2 rounded-3xl bg-card text-[16px] font-semibold">
          <NotePencil size={22} weight="duotone" style={{ color: 'var(--note)' }} aria-hidden="true" /> Write a note
        </button>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-1 rounded-2xl bg-card p-1 ring-1 ring-line" role="tablist" aria-label="Diary view">
        {(
          [
            ['story', 'Month by month'],
            ['photos', `Photos${photos.length ? ` · ${photos.length}` : ''}`],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)} className={clsx('h-10 rounded-xl text-[15px] font-semibold', view === id ? 'bg-brand text-brand-ink' : 'text-ink-2')}>
            {label}
          </button>
        ))}
      </div>

      {view === 'photos' ? (
        photos.length ? (
          <ul className="-mx-1 grid grid-cols-3 gap-1" aria-label="Every photo">
            {photos.map(({ p, e }) => (
              <li key={p} className="aspect-square overflow-hidden rounded-xl">
                <button type="button" onClick={() => open(e)} className="h-full w-full" aria-label={`${eventTitle(e, family)}, ${fmtShortDate(e.started_at, tz)}`}>
                  <PhotoThumb path={p} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-3xl bg-card-2 px-5 py-6 text-center text-[15px] text-ink-2">Photos added to any entry, first or note collect here.</p>
        )
      ) : months.length ? (
        <>
          {months.map((m, i) => (
            <Chapter
              key={m.n}
              n={m.n}
              period={m.period}
              child={child}
              family={family}
              events={events}
              segments={Object.values(segmentsMap)}
              userId={userId}
              items={memories.filter((e) => Date.parse(e.started_at) >= m.period.from && Date.parse(e.started_at) < m.period.to)}
              startOpen={i < 2}
              onOpen={open}
            />
          ))}
          {undated.length > 0 && <Memories label="Before birth" items={undated} family={family} onOpen={open} />}
        </>
      ) : (
        <Memories label="Memories" items={memories} family={family} onOpen={open} />
      )}

      <section className="mt-6 flex items-center gap-4 rounded-[26px] p-4" style={{ background: 'var(--milestone-soft)' }}>
        <BookOpenText size={30} weight="duotone" className="shrink-0" style={{ color: 'var(--milestone)' }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-[18px] font-bold leading-tight">The diary book</p>
          <p className="text-[14px] text-ink-2">All of it, month by month, as a book to print or keep.</p>
        </div>
        <Button size="md" tone="milestone" onClick={() => set({ overlay: { kind: 'book' } })}>
          Make it
        </Button>
      </section>

      {sheet && <LogSheet key={sheet.edit?.id ?? sheet.type} open onClose={() => setSheet(null)} type={sheet.type} edit={sheet.edit} />}
    </div>
  )
}

const noteHeading = (e: LeelaEvent) => (typeof e.data.title === 'string' && e.data.title.trim() ? e.data.title.trim() : (e.notes ?? e.data.body ?? 'A note').toString().split('\n')[0].slice(0, 80))

/** A memory from this date in an earlier month (the latest such month first), or from about a month ago. */
function onThisDay(memories: LeelaEvent[], tz: string, now: number): { e: LeelaEvent; label: string } | null {
  const today = new TZDate(now, tz)
  const pick = (xs: LeelaEvent[]) => xs.find((e) => e.photo_paths.length) ?? xs.find((e) => e.type === 'milestone') ?? xs[0]
  for (let k = 1; k <= 24; k++) {
    const d = new TZDate(today.getFullYear(), today.getMonth() - k, today.getDate(), tz)
    if (d.getDate() !== today.getDate()) continue
    const from = d.getTime()
    const to = addDaysTz(from, 1, tz).getTime()
    const xs = memories.filter((e) => Date.parse(e.started_at) >= from && Date.parse(e.started_at) < to)
    if (xs.length) return { e: pick(xs), label: k === 1 ? 'A month ago today' : k === 12 ? 'A year ago today' : `${k} months ago today` }
  }
  // Nothing on this date: the nearest memory to a month ago, within a few days.
  const target = addDaysTz(now, -30, tz).getTime()
  const near = memories.filter((e) => Math.abs(Date.parse(e.started_at) - target) < 4 * 86_400_000)
  return near.length ? { e: pick(near), label: 'About a month ago' } : null
}

/** One month of her life: a few figures, then the firsts, notes and photos. */
function Chapter({
  n,
  period,
  child,
  family,
  events,
  segments,
  userId,
  items,
  startOpen,
  onOpen,
}: {
  n: number
  period: Period
  child: Child
  family: Family
  events: LeelaEvent[]
  segments: Parameters<typeof dayAggs>[1]
  userId: string | null
  items: LeelaEvent[]
  startOpen: boolean
  onOpen: (e: LeelaEvent) => void
}) {
  const [open, setOpen] = useState(startOpen)
  const tz = family.timezone
  const now = Date.now()
  const last = Math.min(now, addDaysTz(period.to, -1, tz).getTime())
  const facts = useMemo(() => {
    if (!open) return []
    const ds = dayAggs(events, segments, child.id, userId, family, daysOf(period, tz, now), now)
    const logged = (f: (d: (typeof ds)[number]) => boolean) => ds.filter(f)
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
    const out: string[] = []
    const sl = logged((d) => d.t.sleepMs > 0)
    if (sl.length >= 3) out.push(`slept ${durationText(avg(sl.map((d) => d.t.sleepMs)))} a day`)
    const fe = logged((d) => d.breastN + d.bottleN > 0)
    if (fe.length >= 3) out.push(`had ${Math.round(avg(fe.map((d) => d.breastN + d.bottleN)))} feeds a day`)
    const w = events
      .filter((e) => e.type === 'growth' && e.child_id === child.id && e.data.weight_kg && Date.parse(e.started_at) >= period.from && Date.parse(e.started_at) < period.to)
      .sort((a, b) => b.started_at.localeCompare(a.started_at))[0]
    if (w) out.push(`weighed ${fmtWeight(w.data.weight_kg!)}`)
    const acts = new Map<string, number>()
    for (const d of ds) for (const [k, x] of Object.entries(d.act)) acts.set(k, (acts.get(k) ?? 0) + x.n)
    for (const [k, v] of [...acts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) out.push(`had ${activityLabel(k).toLowerCase()} ${v === 1 ? 'once' : `${v} times`}`)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, events, child.id, period.from])
  const firsts = items.filter((e) => e.type === 'milestone').length
  const photos = items.reduce((t, e) => t + e.photo_paths.length, 0)

  return (
    <section className="mb-4 overflow-hidden rounded-[26px] bg-card" aria-label={`Month ${n}`}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left">
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[22px] font-bold leading-tight">Month {n}</span>
          <span className="block text-[14px] text-ink-2">
            {rangeText(period.from, last, tz)}
            {firsts ? ` · ${firsts} ${firsts === 1 ? 'first' : 'firsts'}` : ''}
            {photos ? ` · ${photos} ${photos === 1 ? 'photo' : 'photos'}` : ''}
          </span>
        </span>
        <CaretDown size={20} weight="bold" className={clsx('shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && (
        <div className="px-4 pb-4">
          {facts.length > 0 && (
            <p className="mb-3 rounded-2xl bg-card-2 px-4 py-3 text-[15px] leading-snug">
              {child.name} {facts.slice(0, -1).join(', ')}
              {facts.length > 1 ? ' and ' : ''}
              {facts[facts.length - 1]}.
            </p>
          )}
          {items.length ? <Memories items={items} family={family} onOpen={onOpen} /> : <p className="text-[14px] text-ink-3">No firsts, notes or photos this month.</p>}
        </div>
      )}
    </section>
  )
}

function Memories({ label, items, family, onOpen }: { label?: string; items: LeelaEvent[]; family: Family; onOpen: (e: LeelaEvent) => void }) {
  const tz = family.timezone
  return (
    <div className={label ? 'mb-6' : ''}>
      {label && <h2 className="mb-3 font-display text-[22px] font-bold">{label}</h2>}
      <ol className="space-y-3">
        {items.map((e) =>
          e.type === 'note' ? (
            <li key={e.id}>
              <NoteCard note={e} tz={tz} onOpen={() => onOpen(e)} />
            </li>
          ) : (
            <li key={e.id}>
              <button type="button" onClick={() => onOpen(e)} className="w-full overflow-hidden rounded-[22px] bg-card-2 text-left">
                {e.photo_paths.length > 0 && (
                  <div className={e.photo_paths.length === 1 ? 'aspect-[16/10]' : 'grid aspect-[16/10] grid-cols-2 gap-0.5'}>
                    {e.photo_paths.slice(0, 2).map((p) => (
                      <div key={p} className="relative">
                        <PhotoThumb path={p} />
                      </div>
                    ))}
                  </div>
                )}
                <div className="p-4">
                  <div className="text-[13px] font-semibold" style={{ color: e.type === 'milestone' ? 'var(--milestone)' : 'var(--ink-2)' }}>
                    {e.type === 'milestone' && '★ '}
                    {fmtLongDate(e.started_at, tz)}
                  </div>
                  <div className="font-display text-[19px] font-bold leading-tight">{eventTitle(e, family)}</div>
                  {e.notes && <p className="mt-1 line-clamp-3 text-[15px] text-ink-2">{e.notes}</p>}
                </div>
              </button>
            </li>
          ),
        )}
      </ol>
    </div>
  )
}
