import { useEffect, useMemo, useState } from 'react'
import { Overlay } from '../components/Overlay'
import { Timeline } from '../components/Timeline'
import { Button } from '../components/ui'
import { BarChart } from '../components/charts/BarChart'
import { Key } from '../components/charts/ChartCard'
import { GrowthCard } from '../components/charts/GrowthCard'
import { LineChart } from '../components/charts/LineChart'
import { WeekChart } from '../components/charts/WeekChart'
import { columnSummary } from '../components/charts/chartUtils'
import { HourChart, Panel, StatGrid } from '../components/history/bits'
import { PeriodBar } from '../components/history/PeriodBar'
import { weekColumns, type Filter } from '../lib/charts'
import {
  byBucket,
  categoryById,
  chartTitle,
  dayAggs,
  detailNote,
  detailSeries,
  detailStats,
  entriesOf,
  headline,
  hourCounts,
  topPlaces,
  valueText,
  type Category,
} from '../lib/insights'
import { bucketsOf, customPeriod, daysOf, grain, makePeriod, type Period } from '../lib/period'
import { myPrefs, useLeela } from '../lib/store'
import { addDaysTz, dayLabel, daysBetween, fmtTime } from '../lib/time'
import type { Child, Family, LeelaEvent, TimerSegment } from '../lib/types'
import { FEVER_C, cToF, tempUnit } from '../lib/units'

const PAGE = 40
const SLEEP_ONLY = new Set<Filter>(['sleep'])

/** One kind of entry over any stretch of time: its figures, charts and every entry. */
export function HistoryDetail({
  open,
  categoryId,
  initial,
  onClose,
  child,
  events,
  segments,
  family,
  now,
  start,
  onOpenEntry,
  onOpenDay,
}: {
  open: boolean
  categoryId: string
  initial: Period
  onClose: () => void
  child: Child
  events: LeelaEvent[]
  segments: TimerSegment[]
  family: Family
  now: number
  start: number
  onOpenEntry: (e: LeelaEvent) => void
  onOpenDay: (day: number) => void
}) {
  const c = categoryById(categoryId)
  const tz = family.timezone
  const [period, setPeriod] = useState<Period>(initial)
  const [shown, setShown] = useState(PAGE)
  useEffect(() => {
    if (!open) return
    setPeriod(initial.kind === 'day' ? makePeriod('week', initial.from, tz, start, now) : initial)
    setShown(PAGE)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, categoryId])

  return (
    <Overlay open={open && Boolean(c)} onClose={onClose} title={c?.label ?? ''}>
      {c && (
        <Body
          c={c}
          period={period}
          setPeriod={(p) => {
            setPeriod(p)
            setShown(PAGE)
          }}
          shown={shown}
          more={() => setShown((n) => n + PAGE)}
          child={child}
          events={events}
          segments={segments}
          family={family}
          now={now}
          start={start}
          onOpenEntry={onOpenEntry}
          onOpenDay={onOpenDay}
        />
      )}
    </Overlay>
  )
}

function Body({
  c,
  period,
  setPeriod,
  shown,
  more,
  child,
  events,
  segments,
  family,
  now,
  start,
  onOpenEntry,
  onOpenDay,
}: {
  c: Category
  period: Period
  setPeriod: (p: Period) => void
  shown: number
  more: () => void
  child: Child
  events: LeelaEvent[]
  segments: TimerSegment[]
  family: Family
  now: number
  start: number
  onOpenEntry: (e: LeelaEvent) => void
  onOpenDay: (day: number) => void
}) {
  const tz = family.timezone
  const userId = useLeela((s) => s.userId)
  const prefs = myPrefs()
  const days = useMemo(() => daysOf(period, tz, now), [period, tz, now])
  const ds = useMemo(() => dayAggs(events, segments, child.id, userId, family, days, now), [events, segments, child.id, userId, family, days, now])
  const buckets = useMemo(() => bucketsOf(period, tz, now), [period, tz, now])
  const per = useMemo(() => byBucket(ds, buckets), [ds, buckets])
  const entries = useMemo(() => entriesOf(c, events, child.id, userId, period.from, period.to), [c, events, child.id, userId, period])
  const g = grain(period, tz, now)
  const h = headline(c, ds)
  const stats = detailStats(c, ds, entries, tz)
  const note = detailNote(c, ds)
  const series = detailSeries(c, per)
  const anyBars = series.some((s) => s.values.some((v) => v > 0))
  const fmt = (v: number) => (c.id === 'temperature' || c.id === 'sleep' || c.id === 'pump' ? valueText(c, v) : Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString())
  const lastDay = days[days.length - 1]
  const sleepCols = useMemo(
    () => (c.id === 'sleep' && lastDay !== undefined ? weekColumns(events, segments, child.id, userId, family, lastDay, Math.min(14, days.length), family.night_end, now) : null),
    [c.id, events, segments, child.id, userId, family, lastDay, days.length, now],
  )
  const timeline = c.id !== 'sleep' && c.id !== 'growth' && c.id !== 'milestone' && c.id !== 'note' && entries.length >= 3

  // Entries grouped by day, newest first.
  const groups: { day: string; at: number; items: LeelaEvent[] }[] = []
  for (const e of entries.slice(0, shown)) {
    const label = dayLabel(e.started_at, tz, now)
    const last = groups[groups.length - 1]
    if (last && last.day === label) last.items.push(e)
    else groups.push({ day: label, at: Date.parse(e.started_at), items: [e] })
  }

  return (
    <>
      <PeriodBar period={period} onChange={setPeriod} tz={tz} now={now} start={start} birth={child.birth_date} kinds={['week', 'month', 'all']} />

      {c.id === 'pump' && (
        <button type="button" onClick={() => useLeela.getState().set({ overlay: { kind: 'pumping' } })} className="mb-4 flex min-h-12 w-full items-center justify-between rounded-2xl bg-[var(--pump-soft)] px-4 text-[16px] font-semibold">
          Pumping coach: yield, best times, what would help <span aria-hidden="true">›</span>
        </button>
      )}
      <div className="mb-4 px-1">
        <p className="flex items-baseline gap-2">
          <span className="num font-display text-[34px] font-extrabold leading-none">{h.value}</span>
          {h.unit && <span className="text-[16px] text-ink-2">{h.unit}</span>}
        </p>
        {h.sub && <p className="mt-1 text-[15px] text-ink-2">{h.sub}</p>}
      </div>

      {entries.length === 0 && ds.every((d) => !c.has(d)) ? (
        <p className="mb-4 rounded-3xl bg-card-2 px-5 py-6 text-center text-[15px] text-ink-2">Nothing logged in these dates. Try Month or All above.</p>
      ) : (
        <>
          {stats.length > 0 && (
            <div className="mb-4">
              <StatGrid stats={stats} />
            </div>
          )}
          {note && <p className="-mt-1 mb-4 rounded-2xl bg-card-2 px-4 py-3 text-[14px] leading-snug text-ink-2">{note}</p>}

          {c.id === 'growth' ? (
            <GrowthCard child={child} events={events} now={now} who={false} />
          ) : c.id === 'temperature' ? (
            <TempPanel entries={entries} period={period} tz={tz} now={now} fahrenheit={tempUnit(prefs) === 'f'} />
          ) : (
            anyBars &&
            buckets.length > 1 && (
              <Panel title={chartTitle(c, g)} aside={<span className="text-[13px] text-ink-3">{g === 'day' ? 'Tap twice to open a day' : 'Tap twice to zoom in'}</span>}>
                <BarChart
                  label={chartTitle(c, g)}
                  days={buckets.map((b) => b.from)}
                  ticks={buckets.map((b) => b.tick)}
                  tips={buckets.map((b) => b.label)}
                  tz={tz}
                  average={c.rate}
                  minStep={c.id === 'sleep' || c.id === 'pump' ? 0 : 1}
                  format={fmt}
                  series={series}
                  onPick={(i) => (g === 'day' ? onOpenDay(buckets[i].from) : setPeriod(customPeriod(buckets[i].from, addDaysTz(buckets[i].to, -1, tz).getTime(), tz)))}
                />
                {series.length > 1 && (
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
                    {series.map((s) => (
                      <li key={s.key} className="flex items-center gap-1.5">
                        <Key color={s.color} /> {s.label}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )
          )}

          {c.id === 'feeds' && ds.some((d) => d.bottleMl > 0) && buckets.length > 1 && (
            <Panel title={g === 'day' ? 'Bottle, ml each day' : `Bottle, ml a day, by ${g}`}>
              <BarChart
                label="Bottle millilitres"
                days={buckets.map((b) => b.from)}
                ticks={buckets.map((b) => b.tick)}
                tips={buckets.map((b) => b.label)}
                tz={tz}
                average
                format={(v) => `${Math.round(v)}`}
                series={[{ key: 'ml', label: 'Bottle', color: 'var(--c-feed-2)', values: per.map((p) => avgOf(p.filter((d) => d.bottleN > 0).map((d) => d.bottleMl))) }]}
              />
            </Panel>
          )}

          {sleepCols && sleepCols.length > 1 && (
            <Panel title={`Pattern, last ${sleepCols.length} days`} aside={<span className="text-[13px] text-ink-3">Tap a day</span>}>
              <div className="-mx-2">
                <WeekChart columns={sleepCols} family={family} now={now} startHHMM={family.night_end} show={SLEEP_ONLY} summaries={sleepCols.map(columnSummary)} onPickDay={onOpenDay} />
              </div>
            </Panel>
          )}

          {timeline && (
            <Panel title="When in the day">
              <HourChart counts={hourCounts(entries.map((e) => Date.parse(e.started_at)), tz)} color={`var(--${c.tone})`} label={`When ${c.label.toLowerCase()} happens`} />
            </Panel>
          )}

          {(c.id === 'vitamins' || c.id === 'medicine') && <NamesPanel entries={entries} tz={tz} lastDay={days[days.length - 1]} days={days.length} vitamins={c.id === 'vitamins'} />}
          {c.id === 'solids' && <FoodsPanel entries={entries} />}
          {c.id === 'activity:outing' && topPlaces(ds).length > 0 && (
            <Panel title="Places">
              <ul className="flex flex-wrap gap-2">
                {topPlaces(ds).map(([p, v]) => (
                  <li key={p} className="rounded-full bg-card-2 px-3 py-1 text-[14px] ring-1 ring-line">
                    {p} <span className="text-ink-3">×{v}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}

      {entries.length > 0 && (
        <section aria-labelledby="entries-h" className="mt-6">
          <h2 id="entries-h" className="mb-2 font-display text-[20px] font-bold">
            {entries.length === 1 ? 'The entry' : `All ${entries.length.toLocaleString('en')} entries`}
          </h2>
          {groups.map((gr) => (
            <div key={gr.day + gr.at} className="mb-2">
              <button type="button" onClick={() => onOpenDay(gr.at)} className="mb-0.5 flex min-h-9 items-center gap-2 text-[14px] font-semibold text-ink-2">
                {gr.day}
                <span className="font-normal text-ink-3">· {gr.items.length}</span>
              </button>
              <Timeline events={gr.items} now={now} onSelect={onOpenEntry} />
            </div>
          ))}
          {entries.length > shown && (
            <Button variant="secondary" className="mt-2 w-full" onClick={more}>
              Show {Math.min(PAGE, entries.length - shown)} more
            </Button>
          )}
        </section>
      )}
    </>
  )
}

const avgOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

function TempPanel({ entries, period, tz, now, fahrenheit }: { entries: LeelaEvent[]; period: Period; tz: string; now: number; fahrenheit: boolean }) {
  const temps = entries.filter((e) => typeof e.data.temp_c === 'number').sort((a, b) => a.started_at.localeCompare(b.started_at))
  if (!temps.length) return null
  const show = (c: number) => (fahrenheit ? cToF(c) : c)
  const one = (n: number) => (Math.round(n * 10) / 10).toString()
  const unit = fahrenheit ? '°F' : '°C'
  const to = Math.min(period.to, now)
  const buckets = bucketsOf(period, tz, now)
  const step = Math.max(1, Math.ceil(buckets.length / 6))
  return (
    <Panel title="Every reading">
      <LineChart
        label="Temperature readings"
        color="var(--c-health)"
        xDomain={[period.from, to]}
        xTicks={buckets.filter((_, i) => (buckets.length - 1 - i) % step === 0).map((b) => ({ x: b.from, label: b.tick }))}
        yFormat={(v) => one(v)}
        yFloor={fahrenheit ? 95 : 35}
        refLines={[{ y: fahrenheit ? 100.4 : FEVER_C, label: 'Fever' }]}
        points={temps.map((t) => ({ id: t.id, x: Date.parse(t.started_at), y: show(t.data.temp_c!), tip: `${one(show(t.data.temp_c!))} ${unit}, ${dayLabel(t.started_at, tz, now)} ${fmtTime(t.started_at, tz)}` }))}
      />
    </Panel>
  )
}

function NamesPanel({ entries, tz, lastDay, days, vitamins }: { entries: LeelaEvent[]; tz: string; lastDay: number; days: number; vitamins: boolean }) {
  const by = new Map<string, { n: number; days: Set<string>; last: LeelaEvent; first: LeelaEvent }>()
  for (const e of entries) {
    const k = String(e.data.name ?? '').trim() || 'Medicine'
    const cur = by.get(k) ?? { n: 0, days: new Set<string>(), last: e, first: e }
    cur.n++
    cur.days.add(new Date(Date.parse(e.started_at)).toLocaleDateString('en-CA', { timeZone: tz }))
    if (e.started_at > cur.last.started_at) cur.last = e
    if (e.started_at < cur.first.started_at) cur.first = e
    by.set(k, cur)
  }
  if (!by.size) return null
  return (
    <Panel title={vitamins ? 'Each vitamin' : 'Each medicine'}>
      <ul className="divide-y divide-line">
        {[...by.entries()].map(([name, v]) => (
          <li key={name} className="flex items-baseline justify-between gap-3 py-2.5">
            <span className="min-w-0">
              <span className="block truncate text-[16px] font-semibold">{name}</span>
              <span className="block text-[13px] text-ink-2">
                Last {dayLabel(v.last.started_at, tz).toLowerCase()} at {fmtTime(v.last.started_at, tz)}
              </span>
            </span>
            <span className="num shrink-0 text-[15px] font-semibold">{vitamins ? `${v.days.size} of ${Math.min(days, daysBetween(lastDay, v.first.started_at, tz) + 1)} days` : `${v.n} ${v.n === 1 ? 'dose' : 'doses'}`}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function FoodsPanel({ entries }: { entries: LeelaEvent[] }) {
  const foods = new Map<string, { n: number; first: boolean }>()
  for (const e of entries) for (const f of e.data.foods ?? []) foods.set(f.name, { n: (foods.get(f.name)?.n ?? 0) + 1, first: Boolean(foods.get(f.name)?.first || f.first) })
  if (!foods.size) return null
  return (
    <Panel title="Foods">
      <ul className="flex flex-wrap gap-2">
        {[...foods.entries()]
          .sort((a, b) => b[1].n - a[1].n)
          .map(([name, v]) => (
            <li key={name} className="rounded-full bg-card-2 px-3 py-1 text-[14px] ring-1 ring-line">
              {name} <span className="text-ink-3">×{v.n}</span>
              {v.first && <span className="ml-1 text-[12px] font-semibold text-[var(--milestone)]">new</span>}
            </li>
          ))}
      </ul>
    </Panel>
  )
}
