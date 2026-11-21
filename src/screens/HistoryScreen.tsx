import { DotsThreeOutline, FileArrowUp, FirstAidKit, MagnifyingGlass, BookOpenText, Plus } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { LogSheet } from '../components/LogSheet'
import { MoreSheet } from '../components/MoreSheet'
import { Sheet } from '../components/Sheet'
import { Timeline } from '../components/Timeline'
import { DayStrip } from '../components/charts/DayStrip'
import { Swatch, WeekChart } from '../components/charts/WeekChart'
import { columnSummary } from '../components/charts/chartUtils'
import { CategoryRow, Panel } from '../components/history/bits'
import { PeriodBar } from '../components/history/PeriodBar'
import { useNow } from '../hooks/useNow'
import { marksBetween, weekColumns, type Filter } from '../lib/charts'
import { showsFor } from '../lib/config'
import { eventTitle } from '../lib/describe'
import { GROUPS, byBucket, bucketValue, categoriesFor, change, dayAggs, headline, type Category, type DayAgg, type Headline } from '../lib/insights'
import { bucketsOf, daysOf, firstDay, makePeriod, previousPeriod, type Period } from '../lib/period'
import { activeChild, useLeela } from '../lib/store'
import { loadAllHistory } from '../lib/sync'
import { atLocalTime, dayKey, durationText, fmtShortDate } from '../lib/time'
import type { EventType, Family, LeelaEvent, TimerSegment } from '../lib/types'
import { fmtWeight } from '../lib/units'
import { HistoryDetail } from './HistoryDetail'
import { HistorySearch } from './HistorySearch'

const DAY = 86_400_000
const ALL_FILTERS = new Set<Filter>(['sleep', 'feed', 'diaper', 'health', 'other'])
// Where History was left, for coming back to the tab.
let remembered: Period | null = null

export function HistoryScreen() {
  const now = useNow(60_000)
  const family = useLeela((s) => s.family)!
  const eventsMap = useLeela((s) => s.events)
  const segmentsMap = useLeela((s) => s.segments)
  const userId = useLeela((s) => s.userId)
  const allHistory = useLeela((s) => s.allHistory)
  const askedView = useLeela((s) => s.historyView)
  const child = activeChild()
  const tz = family.timezone

  const events = useMemo(() => Object.values(eventsMap).filter((e) => !e.deleted_at), [eventsMap])
  const segments = useMemo(() => Object.values(segmentsMap), [segmentsMap])
  const firstEntry = useMemo(() => events.reduce<number | null>((m, e) => (e.child_id === child?.id || !e.child_id ? Math.min(m ?? Infinity, Date.parse(e.started_at)) : m), null), [events, child?.id])
  const start = firstDay(child?.birth_date, firstEntry, tz, now)

  const [period, setPeriodState] = useState<Period>(() => remembered ?? makePeriod(askedView, Date.now(), tz, start, Date.now()))
  const setPeriod = (p: Period) => {
    remembered = p
    setPeriodState(p)
  }
  // "Charts" on Today asks for the week.
  useEffect(() => {
    if (askedView !== 'day' && remembered === null) setPeriod(makePeriod(askedView, Date.now(), tz, start, Date.now()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askedView])

  const [detail, setDetail] = useState<{ id: string; period: Period } | null>(null)
  const [searching, setSearching] = useState(false)
  const [tools, setTools] = useState(false)
  const [more, setMore] = useState(false)
  const [sheet, setSheet] = useState<{ type: EventType; edit?: LeelaEvent; group?: EventType[] } | null>(null)

  // The phone keeps the last few months; anything older is fetched the first time someone looks.
  const [loadingOld, setLoadingOld] = useState(false)
  useEffect(() => {
    if (allHistory || period.from > Date.now() - 100 * DAY) return
    setLoadingOld(true)
    void loadAllHistory().finally(() => setLoadingOld(false))
  }, [period.from, allHistory])

  if (!child) return <p className="px-5 pt-10 text-center text-ink-2">Add your baby first, from the Today tab.</p>

  const openEntry = (e: LeelaEvent) => (e.type === 'note' ? useLeela.getState().set({ overlay: { kind: 'note', id: e.id } }) : setSheet({ type: e.type, edit: e }))
  const openDay = (day: number) => {
    setDetail(null)
    setPeriod(makePeriod('day', day, tz, start, now))
    window.scrollTo({ top: 0 })
  }
  const isDay = period.kind === 'day'
  const defaultAt = isDay ? (dayKey(period.from, tz) === dayKey(now, tz) ? Date.now() : atLocalTime(period.from, '12:00', tz).getTime()) : undefined

  return (
    <div className="mx-auto max-w-[560px] px-5 pb-32">
      <header className="safe-top flex items-start justify-between gap-3 pb-3">
        <div className="min-w-0">
          <h1 className="font-display text-[30px] font-extrabold leading-tight">History</h1>
          <p className="text-[15px] text-ink-2">Everything about {child.name}, for any day or stretch of time.</p>
        </div>
        <div className="mt-1.5 flex shrink-0 gap-2">
          <button type="button" onClick={() => setSearching(true)} className="grid h-11 w-11 place-items-center rounded-2xl bg-card ring-1 ring-line" aria-label="Search everything">
            <MagnifyingGlass size={21} weight="bold" />
          </button>
          <button type="button" onClick={() => setTools(true)} className="grid h-11 w-11 place-items-center rounded-2xl bg-card ring-1 ring-line" aria-label="Doctor report, memory book and import">
            <DotsThreeOutline size={21} weight="fill" />
          </button>
        </div>
      </header>

      <PeriodBar period={period} onChange={setPeriod} tz={tz} now={now} start={start} birth={child.birth_date} />

      {loadingOld && !allHistory && (
        <p className="mb-3 rounded-2xl bg-card-2 px-4 py-3 text-center text-[14px] text-ink-2" aria-live="polite">
          Fetching older entries…
        </p>
      )}

      {isDay ? (
        <DayView
          period={period}
          events={events}
          segments={segments}
          childId={child.id}
          childName={child.name}
          userId={userId}
          family={family}
          now={now}
          onOpenCategory={(id) => setDetail({ id, period: makePeriod('week', period.from, tz, start, now) })}
          onOpenEntry={openEntry}
          onAdd={() => setMore(true)}
        />
      ) : (
        <Overview
          period={period}
          events={events}
          segments={segments}
          childId={child.id}
          childName={child.name}
          userId={userId}
          family={family}
          now={now}
          onOpenCategory={(id) => setDetail({ id, period })}
          onOpenDay={openDay}
        />
      )}

      <HistoryDetail
        open={detail !== null}
        categoryId={detail?.id ?? 'sleep'}
        initial={detail?.period ?? period}
        onClose={() => setDetail(null)}
        child={child}
        events={events}
        segments={segments}
        family={family}
        now={now}
        start={start}
        onOpenEntry={openEntry}
        onOpenDay={openDay}
      />
      <HistorySearch open={searching} onClose={() => setSearching(false)} events={events} childId={child.id} onOpenEntry={openEntry} />
      <ToolsSheet
        open={tools}
        onClose={() => setTools(false)}
        period={period}
        onReport={() => {
          setTools(false)
          useLeela.getState().set({ overlay: { kind: 'report', from: period.from, to: period.to } })
        }}
        onBook={() => {
          setTools(false)
          useLeela.getState().set({ overlay: { kind: 'book' } })
        }}
        onImport={() => {
          setTools(false)
          useLeela.getState().set({ overlay: { kind: 'import' } })
        }}
        label={isDay ? 'this day' : 'these dates'}
      />
      <MoreSheet
        open={more}
        onClose={() => setMore(false)}
        dayLabel={dayKey(period.from, tz) === dayKey(now, tz) ? 'today' : fmtShortDate(period.from, tz)}
        onPick={(t) => {
          setMore(false)
          if (t === 'note') {
            useLeela.getState().set({ overlay: { kind: 'note' } })
            return
          }
          setSheet({ type: t, group: ['nursing', 'bottle', 'solids'].includes(t) ? ['nursing', 'bottle', 'solids'] : undefined })
        }}
      />
      {sheet && <LogSheet key={sheet.edit?.id ?? `${sheet.type}-${period.from}`} open onClose={() => setSheet(null)} type={sheet.type} edit={sheet.edit} group={sheet.group} defaultAt={sheet.edit ? undefined : defaultAt} />}
    </div>
  )
}

// ---------------------------------------------------------------------------- one day
function DayView({
  period,
  events,
  segments,
  childId,
  childName,
  userId,
  family,
  now,
  onOpenCategory,
  onOpenEntry,
  onAdd,
}: {
  period: Period
  events: LeelaEvent[]
  segments: TimerSegment[]
  childId: string
  childName: string
  userId: string | null
  family: Family
  now: number
  onOpenCategory: (id: string) => void
  onOpenEntry: (e: LeelaEvent) => void
  onAdd: () => void
}) {
  const { from, to } = period
  const ds = useMemo(() => dayAggs(events, segments, childId, userId, family, [from], now), [events, segments, childId, userId, family, from, now])
  const cats = useMemo(() => categoriesFor(events, childId, userId).filter((c) => c.has(ds[0])), [events, childId, userId, ds])
  const list = events
    .filter(
      (e) =>
        showsFor(e, childId, userId) &&
        ((Date.parse(e.started_at) >= from && Date.parse(e.started_at) < to) ||
          // A night sleep that started the evening before still shows on the morning it ended.
          (e.type === 'sleep' && Date.parse(e.started_at) < from && (e.ended_at ? Date.parse(e.ended_at) : now) > from)),
    )
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
  const d = ds[0]

  return (
    <section aria-label="The day">
      <DayStrip
        marks={marksBetween(events, segments, childId, userId, family, from, to, now)}
        from={from}
        to={to}
        family={family}
        now={now}
        label={`${durationText(d.t.sleepMs)} of sleep, ${d.t.feeds} feeds and ${d.t.diapers} diapers, drawn from midnight to midnight.`}
      />
      {cats.length > 0 && (
        <ul className="mb-5 grid grid-cols-2 gap-2" aria-label="Totals for the day. Tap one to see it over the week.">
          {cats.map((c) => {
            const h = headline(c, ds)
            return (
              <li key={c.id}>
                <button type="button" onClick={() => onOpenCategory(c.id)} className="block h-full w-full rounded-3xl bg-card px-4 py-3 text-left active:scale-[0.98]">
                  <span className="block truncate text-[14px] font-semibold" style={{ color: `var(--${c.tone})` }}>
                    {c.label}
                  </span>
                  <span className="flex items-baseline gap-1">
                    <span className="num truncate text-[24px] font-bold leading-tight">{h.value}</span>
                    {h.unit && <span className="truncate text-[13px] text-ink-2">{h.unit}</span>}
                  </span>
                  {h.sub && <span className="block truncate text-[13px] text-ink-2">{h.sub}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-[20px] font-bold">Everything logged</h2>
        <button type="button" onClick={onAdd} className="flex h-11 items-center gap-1.5 rounded-2xl bg-brand px-4 text-[15px] font-semibold text-brand-ink">
          <Plus size={18} weight="bold" aria-hidden="true" /> Add
        </button>
      </div>
      <Timeline events={list} now={now} onSelect={onOpenEntry} empty={`Nothing logged for ${childName} on this day. Forgot something? Add it here.`} />
    </section>
  )
}

// ---------------------------------------------------------------------------- a week, month or more
function Overview({
  period,
  events,
  segments,
  childId,
  childName,
  userId,
  family,
  now,
  onOpenCategory,
  onOpenDay,
}: {
  period: Period
  events: LeelaEvent[]
  segments: TimerSegment[]
  childId: string
  childName: string
  userId: string | null
  family: Family
  now: number
  onOpenCategory: (id: string) => void
  onOpenDay: (day: number) => void
}) {
  const tz = family.timezone
  const days = useMemo(() => daysOf(period, tz, now), [period, tz, now])
  const ds = useMemo(() => dayAggs(events, segments, childId, userId, family, days, now), [events, segments, childId, userId, family, days, now])
  const buckets = useMemo(() => bucketsOf(period, tz, now), [period, tz, now])
  const per = useMemo(() => byBucket(ds, buckets), [ds, buckets])
  const comparable = period.kind !== 'all' && days.length <= 62
  const before = useMemo(() => {
    if (!comparable) return null
    const prev = previousPeriod(period, tz)
    return dayAggs(events, segments, childId, userId, family, daysOf(prev, tz, now), now)
  }, [comparable, period, tz, events, segments, childId, userId, family, now])
  const cats = useMemo(() => categoriesFor(events, childId, userId), [events, childId, userId])
  const inPeriod = cats.filter((c) => ds.some(c.has))
  const quiet = cats.filter((c) => !ds.some(c.has))
  const columns = useMemo(
    () => (period.kind === 'week' ? weekColumns(events, segments, childId, userId, family, days[days.length - 1], 7, family.night_end, now) : null),
    [period.kind, events, segments, childId, userId, family, days, now],
  )

  if (!days.length) return <p className="rounded-3xl bg-card-2 px-5 py-6 text-center text-[15px] text-ink-2">These dates haven’t happened yet.</p>

  const special = (c: Category): Headline => {
    const h = headline(c, ds)
    const inRange = (e: LeelaEvent) => c.match(e) && e.child_id === childId && Date.parse(e.started_at) >= period.from && Date.parse(e.started_at) < period.to
    if (c.id === 'growth') {
      const last = events.filter((e) => inRange(e) && e.data.weight_kg).sort((a, b) => b.started_at.localeCompare(a.started_at))[0]
      if (last) return { value: fmtWeight(last.data.weight_kg!), unit: '', sub: `Weighed ${fmtShortDate(last.started_at, tz)} · ${h.value} ${h.unit}` }
    }
    if (c.id === 'milestone') {
      const titles = events.filter(inRange).sort((a, b) => b.started_at.localeCompare(a.started_at)).map((e) => eventTitle(e, family))
      return { ...h, sub: titles.slice(0, 3).join(' · ') }
    }
    return h
  }

  return (
    <>
      {columns && (
        <Panel title="The week at a glance" aside={<span className="text-[13px] text-ink-3">Tap a day</span>}>
          <div className="-mx-2">
            <WeekChart columns={columns} family={family} now={now} startHHMM={family.night_end} show={ALL_FILTERS} summaries={columns.map(columnSummary)} onPickDay={onOpenDay} />
          </div>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-ink-2" aria-label="Key">
            {(
              [
                ['night', 'Night'],
                ['nap', 'Nap'],
                ['feed', 'Feed'],
                ['diaper', 'Diaper'],
                ['health', 'Health'],
                ['other', 'Other'],
              ] as const
            ).map(([k, l]) => (
              <li key={k} className="flex items-center gap-1.5">
                <Swatch kind={k} />
                {l}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {days.length >= 14 && <Totals ds={ds} days={days.length} childName={childName} cats={inPeriod} />}

      {!inPeriod.length && <p className="mb-4 rounded-3xl bg-card-2 px-5 py-6 text-center text-[15px] text-ink-2">Nothing logged for {childName} in these dates.</p>}

      {GROUPS.map((g) => {
        const list = inPeriod.filter((c) => c.group === g.id)
        if (!list.length) return null
        return (
          <section key={g.id} className="mb-4" aria-labelledby={`g-${g.id}`}>
            <h2 id={`g-${g.id}`} className="mb-2 px-1 text-[14px] font-semibold tracking-wide text-ink-3 uppercase">
              {g.label}
            </h2>
            <ul className="divide-y divide-line overflow-hidden rounded-[22px] bg-card">
              {list.map((c) => (
                <CategoryRow
                  key={c.id}
                  c={c}
                  h={special(c)}
                  spark={buckets.length > 1 && (c.rate || c.group === 'care') ? per.map((p) => bucketValue(c, p)) : undefined}
                  delta={before ? change(c, ds, before) : null}
                  onOpen={() => onOpenCategory(c.id)}
                />
              ))}
            </ul>
          </section>
        )
      })}

      {quiet.length > 0 && (
        <p className="px-1 text-[13px] text-ink-3">
          Nothing logged in these dates: {quiet.map((c) => c.label.toLowerCase()).join(', ')}.
        </p>
      )}
      {before && <p className="mt-1 px-1 text-[13px] text-ink-3">The small figures compare with the {period.kind === 'month' ? 'month' : `${days.length} days`} before.</p>}
    </>
  )
}

/** For longer stretches: how many of everything, the kind of thing worth remembering. */
function Totals({ ds, days, childName, cats }: { ds: DayAgg[]; days: number; childName: string; cats: Category[] }) {
  const sum = (f: (d: DayAgg) => number) => ds.reduce((t, d) => t + f(d), 0)
  const n = (v: number, one: string, many: string) => `${v.toLocaleString('en')} ${v === 1 ? one : many}`
  const parts: string[] = []
  const sleepH = Math.round(sum((d) => d.t.sleepMs) / 3_600_000)
  if (sleepH) parts.push(`${sleepH.toLocaleString('en')} hours of sleep`)
  const breast = sum((d) => d.breastN)
  if (breast) parts.push(n(breast, 'breastfeed', 'breastfeeds'))
  const bottles = sum((d) => d.bottleN)
  if (bottles) parts.push(n(bottles, 'bottle', 'bottles'))
  const diapers = sum((d) => d.t.diapers)
  if (diapers) parts.push(n(diapers, 'diaper', 'diapers'))
  for (const c of cats.filter((x) => x.id.startsWith('activity:')).slice(0, 3)) {
    const k = c.id.slice(9)
    const v = sum((d) => d.act[k]?.n ?? 0)
    if (v) parts.push(`${c.label.toLowerCase()} ${v === 1 ? 'once' : `${v.toLocaleString('en')} times`}`)
  }
  const firsts = sum((d) => d.milestones)
  if (firsts) parts.push(n(firsts, 'first', 'firsts'))
  const photos = sum((d) => d.photos)
  if (photos) parts.push(n(photos, 'photo', 'photos'))
  if (!parts.length) return null
  return (
    <Panel>
      <p className="text-[13px] font-semibold tracking-wide text-ink-3 uppercase">In these {days} days</p>
      <p className="mt-1 text-[16px] leading-relaxed">
        {childName} had {parts.slice(0, -1).join(', ')}
        {parts.length > 1 ? ' and ' : ''}
        {parts[parts.length - 1]}.
      </p>
    </Panel>
  )
}

// ---------------------------------------------------------------------------- tools
function ToolsSheet({ open, onClose, onReport, onBook, onImport, label }: { open: boolean; onClose: () => void; period: Period; onReport: () => void; onBook: () => void; onImport: () => void; label: string }) {
  const row = 'flex min-h-16 w-full items-center gap-3 rounded-2xl bg-card-2 px-4 text-left ring-1 ring-line active:bg-card'
  return (
    <Sheet open={open} onClose={onClose} title="Share and keep">
      <div className="mb-4 space-y-2">
        <button type="button" className={row} onClick={onReport}>
          <FirstAidKit size={24} weight="duotone" className="shrink-0 text-[var(--health)]" aria-hidden="true" />
          <span>
            <span className="block text-[16px] font-semibold">Doctor report for {label}</span>
            <span className="block text-[13px] text-ink-2">Sleep, feeds, diapers, health and growth, ready to save as a PDF</span>
          </span>
        </button>
        <button type="button" className={row} onClick={onBook}>
          <BookOpenText size={24} weight="duotone" className="shrink-0 text-[var(--milestone)]" aria-hidden="true" />
          <span>
            <span className="block text-[16px] font-semibold">Memory book</span>
            <span className="block text-[13px] text-ink-2">Firsts, notes and photos as a book to print or keep</span>
          </span>
        </button>
        <button type="button" className={row} onClick={onImport}>
          <FileArrowUp size={24} weight="duotone" className="shrink-0 text-ink-2" aria-hidden="true" />
          <span>
            <span className="block text-[16px] font-semibold">Import old logs</span>
            <span className="block text-[13px] text-ink-2">From another app or a written diary</span>
          </span>
        </button>
      </div>
    </Sheet>
  )
}
