import clsx from 'clsx'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { FILTERS, columnSummary } from '../components/charts/chartUtils'
import { Swatch, WeekChart } from '../components/charts/WeekChart'
import { useNow } from '../hooks/useNow'
import { dailyStats, type Filter, weekColumns } from '../lib/charts'
import { useLeela } from '../lib/store'
import { loadAllHistory } from '../lib/sync'
import { addDaysTz, dayStart, durationText, fmtShortDate } from '../lib/time'
import type { Child } from '../lib/types'

const KEY = 'leela-week-filters'
function loadFilters(): Set<Filter> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (Array.isArray(raw)) return new Set(raw.filter((f) => FILTERS.some((x) => x.id === f)))
  } catch {
    /* fall through */
  }
  return new Set(FILTERS.map((f) => f.id))
}

/** History › Week: seven days side by side, Huckleberry style. */
export function HistoryWeek({ child, onPickDay }: { child: Child; onPickDay: (day: number) => void }) {
  const now = useNow(60_000)
  const family = useLeela((s) => s.family)!
  const eventsMap = useLeela((s) => s.events)
  const segmentsMap = useLeela((s) => s.segments)
  const userId = useLeela((s) => s.userId)
  const allHistory = useLeela((s) => s.allHistory)
  const tz = family.timezone
  const today = dayStart(now, tz).getTime()
  const [lastDay, setLastDay] = useState(today)
  const [show, setShow] = useState<Set<Filter>>(loadFilters)

  const events = useMemo(() => Object.values(eventsMap).filter((e) => !e.deleted_at), [eventsMap])
  const segments = useMemo(() => Object.values(segmentsMap), [segmentsMap])
  const columns = useMemo(
    () => weekColumns(events, segments, child.id, userId, family, lastDay, 7, family.night_end, now),
    [events, segments, child.id, userId, family, lastDay, now],
  )
  const stats = useMemo(() => dailyStats(events, segments, child.id, family, columns.map((c) => c.day), now), [events, segments, child.id, family, columns, now])

  // The phone keeps the last few months; older weeks are fetched the first time someone looks.
  useEffect(() => {
    if (!allHistory && lastDay < Date.now() - 100 * 86_400_000) void loadAllHistory()
  }, [lastDay, allHistory])

  const toggle = (f: Filter) => {
    const next = new Set(show)
    if (next.has(f)) next.delete(f)
    else next.add(f)
    setShow(next)
    try {
      localStorage.setItem(KEY, JSON.stringify([...next]))
    } catch {
      /* not saved, still works */
    }
  }

  const logged = stats.filter((s) => s.totals.sleepMs || s.totals.feeds || s.totals.diapers)
  const avg = (f: (s: (typeof stats)[number]) => number) => (logged.length ? logged.reduce((t, s) => t + f(s), 0) / logged.length : 0)
  const first = columns[0].day
  const atToday = lastDay >= today

  return (
    <section aria-labelledby="week-h">
      <div className="mb-3 flex items-center justify-between gap-2">
        <button type="button" onClick={() => setLastDay(addDaysTz(lastDay, -7, tz).getTime())} className="grid h-11 w-11 place-items-center rounded-2xl bg-card ring-1 ring-line" aria-label="Previous week">
          <CaretLeft size={20} weight="bold" />
        </button>
        <h2 id="week-h" className="text-center font-display text-[19px] font-bold leading-tight">
          {fmtShortDate(first, tz)} – {fmtShortDate(lastDay, tz)}
          {!atToday && (
            <button type="button" onClick={() => setLastDay(today)} className="block w-full font-sans text-[13px] font-semibold text-brand">
              Back to this week
            </button>
          )}
        </h2>
        <button
          type="button"
          onClick={() => setLastDay(Math.min(today, addDaysTz(lastDay, 7, tz).getTime()))}
          disabled={atToday}
          className="grid h-11 w-11 place-items-center rounded-2xl bg-card ring-1 ring-line disabled:opacity-35"
          aria-label="Next week"
        >
          <CaretRight size={20} weight="bold" />
        </button>
      </div>

      <div className="no-scrollbar -mx-5 mb-3 flex gap-2 overflow-x-auto px-5 pb-1" role="group" aria-label="Show on the chart">
        {FILTERS.map((f) => {
          const on = show.has(f.id)
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(f.id)}
              className={clsx('flex min-h-10 shrink-0 items-center gap-2 rounded-full px-3.5 text-[14px] font-semibold ring-1', on ? 'bg-card ring-ink-3' : 'bg-transparent text-ink-3 ring-line')}
            >
              <span className={clsx('flex items-center gap-1', !on && 'opacity-40')}>
                {f.id === 'sleep' ? (
                  <>
                    <Swatch kind="night" />
                    <Swatch kind="nap" />
                  </>
                ) : (
                  <Swatch kind={f.id === 'feed' ? 'feed' : f.id === 'diaper' ? 'diaper' : f.id === 'health' ? 'health' : 'other'} />
                )}
              </span>
              {f.label}
            </button>
          )
        })}
      </div>

      <div className="rounded-[26px] bg-card px-2 pt-2 pb-1">
        <WeekChart columns={columns} family={family} now={now} startHHMM={family.night_end} show={show} summaries={columns.map(columnSummary)} onPickDay={onPickDay} />
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[13px] text-ink-2" aria-label="Key">
        {(
          [
            ['night', 'Night sleep'],
            ['nap', 'Nap'],
            ['feed', 'Feed'],
            ['diaper', 'Diaper or potty'],
            ['health', 'Health'],
            ['other', 'Play, pumping, firsts'],
          ] as const
        ).map(([k, label]) => (
          <li key={k} className="flex items-center gap-1.5">
            <Swatch kind={k} />
            {label}
          </li>
        ))}
      </ul>
      <p className="mt-1 px-1 text-[13px] text-ink-3">Each day runs from {fmtHour(family.night_end)} to {fmtHour(family.night_end)} the next morning. Tap a day to see everything in it.</p>

      <h3 className="mt-6 mb-2 font-display text-[19px] font-bold">This week, on average</h3>
      {logged.length ? (
        <dl className="grid grid-cols-2 gap-2">
          <Avg label="Sleep a day" value={durationText(avg((s) => s.totals.sleepMs))} sub={`${durationText(avg((s) => s.totals.nightMs))} at night`} tone="sleep" />
          <Avg label="Naps a day" value={avg((s) => s.totals.naps).toFixed(1)} sub={`${durationText(avg((s) => s.totals.napMs))} of naps`} tone="sleep" />
          <Avg label="Feeds a day" value={avg((s) => s.totals.feeds).toFixed(1)} sub={avg((s) => s.totals.bottleMl) ? `${Math.round(avg((s) => s.totals.bottleMl))} ml from bottles` : `${Math.round(avg((s) => s.leftMin + s.rightMin + s.otherMin))} min breastfeeding`} tone="feed" />
          <Avg label="Diapers a day" value={avg((s) => s.totals.diapers).toFixed(1)} sub={`${avg((s) => s.totals.wet).toFixed(1)} wet, ${avg((s) => s.totals.dirty).toFixed(1)} dirty`} tone="diaper" />
        </dl>
      ) : (
        <p className="rounded-3xl bg-card-2 px-5 py-6 text-center text-[15px] text-ink-2">Nothing logged in these seven days.</p>
      )}
      {logged.length > 0 && logged.length < 7 && <p className="mt-2 text-[13px] text-ink-3">Averages are over the {logged.length} days with entries.</p>}
    </section>
  )
}

const fmtHour = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`
}

function Avg({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="rounded-3xl bg-card px-4 py-3">
      <dt className="text-[14px] font-semibold" style={{ color: `var(--${tone})` }}>
        {label}
      </dt>
      <dd>
        <span className="block text-[26px] font-bold leading-tight">{value}</span>
        <span className="block truncate text-[13px] text-ink-2">{sub}</span>
      </dd>
    </div>
  )
}
