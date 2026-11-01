import clsx from 'clsx'
import { TZDate } from '@date-fns/tz'
import { useEffect, useMemo, useState } from 'react'
import { BarChart } from '../components/charts/BarChart'
import { dayTick } from '../components/charts/chartUtils'
import { ChartCard, Key } from '../components/charts/ChartCard'
import { LineChart } from '../components/charts/LineChart'
import { useNow } from '../hooks/useNow'
import { ACTIVITY_KINDS } from '../lib/config'
import { CENTILES, type GrowthKind, ageMonths, dailyStats, growthPoints, lastDays, lmsAt, valueAtZ } from '../lib/charts'
import { myPrefs, useLeela } from '../lib/store'
import { loadAllHistory } from '../lib/sync'
import { durationText, fmtShortDate, fmtTime } from '../lib/time'
import type { Child, LeelaEvent } from '../lib/types'
import { CM_PER_IN, FEVER_C, cToF, lengthUnit, tempUnit } from '../lib/units'

const H = 3_600_000
const RANGES = [
  { id: 7, label: '7 days' },
  { id: 14, label: '2 weeks' },
  { id: 30, label: '30 days' },
  { id: 90, label: '90 days' },
] as const
type Range = (typeof RANGES)[number]['id']

const ordinal = (n: number) => {
  const r = Math.round(n)
  if (r < 1) return 'below the 1st'
  if (r > 99) return 'above the 99th'
  const s = r % 100 >= 11 && r % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][r % 10] ?? 'th'
  return `${r}${s}`
}
const avgOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const one = (n: number) => (Math.round(n * 10) / 10).toString()

/** History › Trends: how each kind of entry is changing, day by day. */
export function HistoryTrends({ child }: { child: Child }) {
  const now = useNow(60_000)
  const family = useLeela((s) => s.family)!
  const eventsMap = useLeela((s) => s.events)
  const segmentsMap = useLeela((s) => s.segments)
  const allHistory = useLeela((s) => s.allHistory)
  const tz = family.timezone
  const prefs = myPrefs()
  const [range, setRange] = useState<Range>(() => {
    try {
      const v = Number(localStorage.getItem('leela-trends-range'))
      return (RANGES.some((r) => r.id === v) ? v : 14) as Range
    } catch {
      return 14
    }
  })
  // Growth goes back to birth, so make sure every entry is on the phone.
  useEffect(() => {
    if (!allHistory) void loadAllHistory()
  }, [allHistory])

  const events = useMemo(() => Object.values(eventsMap).filter((e) => !e.deleted_at), [eventsMap])
  const segments = useMemo(() => Object.values(segmentsMap), [segmentsMap])
  const days = useMemo(() => lastDays(now, range, tz), [now, range, tz])
  const stats = useMemo(() => dailyStats(events, segments, child.id, family, days, now), [events, segments, child.id, family, days, now])
  const from = days[0]
  const mine = (e: LeelaEvent, type: LeelaEvent['type']) => e.type === type && e.child_id === child.id && Date.parse(e.started_at) >= from && Date.parse(e.started_at) <= now
  const label = (d: number) => new TZDate(d, tz).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz })
  const pick = (f: (s: (typeof stats)[number]) => number) => stats.map(f)
  const withSleep = stats.filter((s) => s.totals.sleepMs > 0)
  const withFeeds = stats.filter((s) => s.totals.feeds > 0)

  const sleepCard = (
    <ChartCard
      title="Sleep"
      sub={`Hours asleep each day, night and naps. ${withSleep.length ? '' : 'Nothing logged in this time yet.'}`.trim()}
      stats={
        withSleep.length
          ? [
              { label: 'A day, on average', value: durationText(avgOf(withSleep.map((s) => s.totals.sleepMs))) },
              { label: 'At night', value: durationText(avgOf(withSleep.map((s) => s.totals.nightMs))) },
              { label: 'Naps a day', value: one(avgOf(withSleep.map((s) => s.totals.naps))) },
              { label: 'Longest stretch', value: durationText(Math.max(...stats.map((s) => s.totals.longestSleepMs))) },
            ]
          : undefined
      }
      legend={[
        { label: 'Night', swatch: <Key color="var(--c-night)" /> },
        { label: 'Naps', swatch: <Key color="var(--c-nap)" /> },
      ]}
      table={{ head: ['Day', 'Night', 'Naps', 'Total'], rows: stats.map((s) => [label(s.day), durationText(s.totals.nightMs), durationText(s.totals.napMs), durationText(s.totals.sleepMs)]) }}
    >
      <BarChart
        label="Sleep each day"
        days={days}
        tz={tz}
        average
        format={(v) => durationText(v * H)}
        series={[
          { key: 'night', label: 'Night', color: 'var(--c-night)', values: pick((s) => s.totals.nightMs / H) },
          { key: 'naps', label: 'Naps', color: 'var(--c-nap)', values: pick((s) => s.totals.napMs / H) },
        ]}
      />
    </ChartCard>
  )

  // Feeds
  const anyBottle = stats.some((s) => s.totals.bottleMl > 0)
  const anyBreast = stats.some((s) => s.leftMin + s.rightMin + s.otherMin > 0)
  const sides = stats.reduce((t, s) => ({ l: t.l + s.leftMin, r: t.r + s.rightMin }), { l: 0, r: 0 })
  const feedCard = withFeeds.length > 0 && (
    <ChartCard
      title="Feeds"
      sub="Breastfeeds and bottles each day."
      stats={[
        { label: 'Feeds a day', value: one(avgOf(withFeeds.map((s) => s.totals.feeds))) },
        ...(anyBottle ? [{ label: 'Bottle a day', value: `${Math.round(avgOf(withFeeds.map((s) => s.totals.bottleMl)))} ml` }] : []),
        ...(anyBreast ? [{ label: 'Breastfeeding a day', value: `${Math.round(avgOf(withFeeds.map((s) => s.leftMin + s.rightMin + s.otherMin)))} min` }] : []),
        ...(sides.l + sides.r > 0 ? [{ label: 'Left / right', value: `${Math.round((sides.l / (sides.l + sides.r)) * 100)}% / ${Math.round((sides.r / (sides.l + sides.r)) * 100)}%` }] : []),
      ]}
      table={{
        head: ['Day', 'Feeds', ...(anyBottle ? ['Bottle'] : []), ...(anyBreast ? ['Breast L', 'Breast R'] : [])],
        rows: stats.map((s) => [label(s.day), s.totals.feeds, ...(anyBottle ? [`${s.totals.bottleMl} ml`] : []), ...(anyBreast ? [`${s.leftMin} min`, `${s.rightMin} min`] : [])]),
      }}
    >
      <BarChart label="Feeds each day" days={days} tz={tz} average minStep={1} format={(v) => String(Math.round(v))} series={[{ key: 'feeds', label: 'Feeds', color: 'var(--c-feed)', values: pick((s) => s.totals.feeds) }]} />
      {anyBottle && (
        <>
          <h4 className="mt-4 mb-1 text-[15px] font-semibold">Bottle, ml a day</h4>
          <BarChart label="Bottle volume each day" days={days} tz={tz} average format={(v) => `${Math.round(v)}`} series={[{ key: 'ml', label: 'Bottle', color: 'var(--c-feed)', values: pick((s) => s.totals.bottleMl) }]} />
        </>
      )}
      {anyBreast && (
        <>
          <h4 className="mt-4 mb-1 text-[15px] font-semibold">Breastfeeding, minutes a day</h4>
          <BarChart
            label="Breastfeeding minutes each day, left and right"
            days={days}
            tz={tz}
            format={(v) => `${Math.round(v)}`}
            series={[
              { key: 'l', label: 'Left', color: 'var(--c-feed)', values: pick((s) => s.leftMin + s.otherMin) },
              { key: 'r', label: 'Right', color: 'var(--c-feed-2)', values: pick((s) => s.rightMin) },
            ]}
          />
          <ul className="mt-2 flex gap-4 text-[13px] text-ink-2">
            <li className="flex items-center gap-1.5">
              <Key color="var(--c-feed)" /> Left{stats.some((s) => s.otherMin) ? ' (or side not noted)' : ''}
            </li>
            <li className="flex items-center gap-1.5">
              <Key color="var(--c-feed-2)" /> Right
            </li>
          </ul>
        </>
      )}
    </ChartCard>
  )

  // Diapers: wet and dirty as two small charts on one scale ("both" counts in each).
  const anyDiaper = stats.some((s) => s.totals.diapers > 0)
  const diaperMax = Math.max(...stats.map((s) => Math.max(s.totals.wet, s.totals.dirty)), 1)
  const withDiapers = stats.filter((s) => s.totals.diapers > 0)
  const diaperCard = anyDiaper && (
    <ChartCard
      title="Diapers"
      sub="A diaper that was both counts as wet and as dirty."
      stats={[
        { label: 'Changes a day', value: one(avgOf(withDiapers.map((s) => s.totals.diapers))) },
        { label: 'Wet a day', value: one(avgOf(withDiapers.map((s) => s.totals.wet))) },
        { label: 'Dirty a day', value: one(avgOf(withDiapers.map((s) => s.totals.dirty))) },
      ]}
      table={{ head: ['Day', 'Changes', 'Wet', 'Dirty'], rows: stats.map((s) => [label(s.day), s.totals.diapers, s.totals.wet, s.totals.dirty]) }}
    >
      <h4 className="mb-1 text-[15px] font-semibold">Wet</h4>
      <BarChart label="Wet diapers each day" days={days} tz={tz} max={diaperMax} minStep={1} height={90} format={(v) => String(Math.round(v))} series={[{ key: 'wet', label: 'Wet', color: 'var(--c-diaper)', values: pick((s) => s.totals.wet) }]} />
      <h4 className="mt-3 mb-1 text-[15px] font-semibold">Dirty</h4>
      <BarChart label="Dirty diapers each day" days={days} tz={tz} max={diaperMax} minStep={1} height={90} format={(v) => String(Math.round(v))} series={[{ key: 'dirty', label: 'Dirty', color: 'var(--c-diaper)', values: pick((s) => s.totals.dirty) }]} />
    </ChartCard>
  )

  // Solids and new foods.
  const anySolids = stats.some((s) => s.totals.solids > 0)
  const newFoods = stats.flatMap((s) => s.newFoods.map((f) => ({ f, day: s.day })))
  const solidsCard = anySolids && (
    <ChartCard title="Solids" sub="Meals each day." table={{ head: ['Day', 'Meals', 'New foods'], rows: stats.map((s) => [label(s.day), s.totals.solids, s.newFoods.join(', ')]) }}>
      <BarChart label="Solid meals each day" days={days} tz={tz} minStep={1} height={100} format={(v) => String(Math.round(v))} series={[{ key: 'solids', label: 'Meals', color: 'var(--c-feed)', values: pick((s) => s.totals.solids) }]} />
      {newFoods.length > 0 && (
        <>
          <h4 className="mt-4 mb-2 text-[15px] font-semibold">New foods tried</h4>
          <ul className="flex flex-wrap gap-2">
            {newFoods.map(({ f, day }) => (
              <li key={`${f}-${day}`} className="rounded-full bg-card-2 px-3 py-1 text-[14px] ring-1 ring-line">
                {f} <span className="text-ink-3">· {fmtShortDate(day, tz)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </ChartCard>
  )

  const anyPump = stats.some((s) => s.totals.pumpMl > 0)
  const pumpCard = anyPump && (
    <ChartCard title="Pumping" sub="Millilitres pumped each day." stats={[{ label: 'A day, on average', value: `${Math.round(avgOf(stats.filter((s) => s.totals.pumpMl).map((s) => s.totals.pumpMl)))} ml` }]} table={{ head: ['Day', 'Pumped'], rows: stats.map((s) => [label(s.day), `${s.totals.pumpMl} ml`]) }}>
      <BarChart label="Millilitres pumped each day" days={days} tz={tz} average height={100} format={(v) => `${Math.round(v)}`} series={[{ key: 'pump', label: 'Pumped', color: 'var(--pump)', values: pick((s) => s.totals.pumpMl) }]} />
    </ChartCard>
  )

  // Temperature
  const temps = events.filter((e) => mine(e, 'temperature') && typeof e.data.temp_c === 'number').sort((a, b) => a.started_at.localeCompare(b.started_at))
  const tf = tempUnit(prefs) === 'f'
  const shownTemp = (c: number) => (tf ? cToF(c) : c)
  const tempUnitText = tf ? '°F' : '°C'
  const tempCard = temps.length > 0 && (
    <ChartCard
      title="Temperature"
      sub={`Every reading, against the fever line (${tf ? '100.4 °F' : `${FEVER_C} °C`}).`}
      stats={[
        { label: 'Highest', value: `${one(shownTemp(Math.max(...temps.map((t) => t.data.temp_c!))))} ${tempUnitText}` },
        { label: 'Latest', value: `${one(shownTemp(temps[temps.length - 1].data.temp_c!))} ${tempUnitText}` },
      ]}
      table={{ head: ['When', 'Temperature'], rows: temps.map((t) => [`${label(Date.parse(t.started_at))}, ${fmtTime(t.started_at, tz)}`, `${one(shownTemp(t.data.temp_c!))} ${tempUnitText}`]) }}
    >
      <LineChart
        label="Temperature readings"
        color="var(--c-health)"
        xDomain={[from, now]}
        xTicks={days.map((d, i) => ({ x: d, label: dayTick(d, i, days.length, tz) ?? '' })).filter((t) => t.label)}
        yFormat={(v) => one(v)}
        yFloor={tf ? 95 : 35}
        refLines={[{ y: tf ? 100.4 : FEVER_C, label: 'Fever' }]}
        points={temps.map((t) => ({ id: t.id, x: Date.parse(t.started_at), y: shownTemp(t.data.temp_c!), tip: `${one(shownTemp(t.data.temp_c!))} ${tempUnitText}, ${label(Date.parse(t.started_at))} ${fmtTime(t.started_at, tz)}` }))}
      />
    </ChartCard>
  )

  // Medicine
  const meds = events.filter((e) => mine(e, 'medicine'))
  const byMed = new Map<string, { n: number; last: number }>()
  for (const m of meds) {
    const k = String(m.data.name ?? 'Medicine').trim() || 'Medicine'
    const cur = byMed.get(k) ?? { n: 0, last: 0 }
    byMed.set(k, { n: cur.n + 1, last: Math.max(cur.last, Date.parse(m.started_at)) })
  }
  const medCard = meds.length > 0 && (
    <ChartCard title="Medicine" sub="Doses given each day." table={{ head: ['Day', 'Doses'], rows: stats.map((s) => [label(s.day), s.totals.meds]) }}>
      <BarChart label="Medicine doses each day" days={days} tz={tz} minStep={1} height={90} format={(v) => String(Math.round(v))} series={[{ key: 'meds', label: 'Doses', color: 'var(--c-health)', values: pick((s) => s.totals.meds) }]} />
      <ul className="mt-3 divide-y divide-line rounded-2xl ring-1 ring-line">
        {[...byMed.entries()].sort((a, b) => b[1].last - a[1].last).map(([name, v]) => (
          <li key={name} className="flex items-baseline justify-between gap-3 px-3 py-2 text-[15px]">
            <span className="font-semibold">{name}</span>
            <span className="text-[14px] text-ink-2">
              {v.n} {v.n === 1 ? 'dose' : 'doses'}, last {label(v.last)} {fmtTime(v.last, tz)}
            </span>
          </li>
        ))}
      </ul>
    </ChartCard>
  )

  // Activities
  const actTotals = new Map<string, number>()
  for (const s of stats) for (const [k, m] of Object.entries(s.activityByKind)) actTotals.set(k, (actTotals.get(k) ?? 0) + m)
  const actName = (k: string) => ACTIVITY_KINDS.find((a) => a.id === k)?.label ?? k
  const actCard = actTotals.size > 0 && (
    <ChartCard title="Play and activities" sub="Minutes each day, all activities together." table={{ head: ['Day', 'Minutes'], rows: stats.map((s) => [label(s.day), s.activityMin]) }}>
      <BarChart label="Activity minutes each day" days={days} tz={tz} average height={100} format={(v) => `${Math.round(v)}`} series={[{ key: 'act', label: 'Minutes', color: 'var(--c-other)', values: pick((s) => s.activityMin) }]} />
      <ul className="mt-3 flex flex-wrap gap-2">
        {[...actTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k, m]) => (
          <li key={k} className="rounded-full bg-card-2 px-3 py-1 text-[14px] ring-1 ring-line">
            {actName(k)} <strong className="font-semibold">{durationText(m * 60_000)}</strong>
          </li>
        ))}
      </ul>
    </ChartCard>
  )

  const anyPotty = stats.some((s) => s.pottyWins + s.pottyAccidents > 0)
  const pottyCard = anyPotty && (
    <ChartCard
      title="Potty"
      sub="Times on the potty each day."
      stats={[
        { label: 'On the potty', value: String(stats.reduce((t, s) => t + s.pottyWins, 0)) },
        { label: 'Accidents', value: String(stats.reduce((t, s) => t + s.pottyAccidents, 0)) },
      ]}
      table={{ head: ['Day', 'Potty', 'Accidents'], rows: stats.map((s) => [label(s.day), s.pottyWins, s.pottyAccidents]) }}
    >
      <BarChart label="Potty successes each day" days={days} tz={tz} minStep={1} height={90} format={(v) => String(Math.round(v))} series={[{ key: 'potty', label: 'Potty', color: 'var(--c-diaper)', values: pick((s) => s.pottyWins) }]} />
    </ChartCard>
  )

  const health = events.filter((e) => mine(e, 'symptom')).sort((a, b) => b.started_at.localeCompare(a.started_at))
  const healthCard = health.length > 0 && (
    <ChartCard title="Symptoms, visits and vaccines" sub={`${health.length} in this time.`}>
      <ul className="divide-y divide-line rounded-2xl ring-1 ring-line">
        {health.slice(0, 12).map((e) => (
          <li key={e.id} className="flex items-baseline justify-between gap-3 px-3 py-2 text-[15px]">
            <span className="min-w-0 truncate">
              {e.data.kind === 'vaccine' ? `Vaccine${e.data.vaccine ? `: ${e.data.vaccine}` : ''}` : e.data.kind === 'visit' ? 'Doctor visit' : (e.data.tags ?? []).join(', ') || 'Symptoms'}
            </span>
            <span className="shrink-0 text-[14px] text-ink-2">{label(Date.parse(e.started_at))}</span>
          </li>
        ))}
      </ul>
    </ChartCard>
  )

  return (
    <section aria-label="Trends">
      <div className="mb-4 grid grid-cols-4 gap-1 rounded-2xl bg-card p-1 ring-1 ring-line" role="radiogroup" aria-label="Time range">
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={range === r.id}
            onClick={() => {
              setRange(r.id)
              try {
                localStorage.setItem('leela-trends-range', String(r.id))
              } catch {
                /* fine */
              }
            }}
            className={clsx('h-10 rounded-xl text-[14px] font-semibold', range === r.id ? 'bg-brand text-brand-ink' : 'text-ink-2')}
          >
            {r.label}
          </button>
        ))}
      </div>
      {sleepCard}
      {feedCard}
      {diaperCard}
      <GrowthCard child={child} events={events} now={now} />
      {solidsCard}
      {pumpCard}
      {tempCard}
      {medCard}
      {actCard}
      {pottyCard}
      {healthCard}
    </section>
  )
}

// ---------------------------------------------------------------------------- growth
function GrowthCard({ child, events, now }: { child: Child; events: LeelaEvent[]; now: number }) {
  const prefs = myPrefs()
  const tz = useLeela((s) => s.family)?.timezone ?? 'UTC'
  const kinds = (['weight', 'length', 'head'] as GrowthKind[]).filter((k) => growthPoints(events, child, k).length > 0)
  const [kind, setKind] = useState<GrowthKind | null>(null)
  const k = kind && kinds.includes(kind) ? kind : kinds[0]
  if (!k || !child.birth_date) return null
  const pts = growthPoints(events, child, k)
  const inches = k !== 'weight' && lengthUnit(prefs) === 'in'
  const show = (v: number) => (k === 'weight' ? v : inches ? v / CM_PER_IN : v)
  const unit = k === 'weight' ? 'kg' : inches ? 'in' : 'cm'
  const name = { weight: 'Weight', length: 'Length', head: 'Head' }[k]
  const ref = child.due_date && child.due_date > child.birth_date ? child.due_date : child.birth_date
  const ageNow = ageMonths(ref, now)
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.months)) - 0.5))
  const x1 = Math.max(x0 + 3, Math.ceil(Math.max(ageNow, ...pts.map((p) => p.months)) + 0.5))
  const span = x1 - x0
  const every = span <= 6 ? 1 : span <= 12 ? 2 : span <= 24 ? 3 : 6
  const xTicks: { x: number; label: string }[] = []
  for (let m = Math.ceil(x0 / every) * every; m <= x1; m += every) xTicks.push({ x: m, label: `${m}m` })
  const curves = child.sex
    ? CENTILES.map((c) => ({
        label: `${c.p}${c.p === 3 ? 'rd' : 'th'}`,
        points: Array.from({ length: Math.round((Math.min(x1, 60) - x0) * 2) + 1 }, (_, i) => x0 + i / 2)
          .map((m) => {
            const lms = lmsAt(k, child.sex, m)
            return lms ? { x: m, y: show(valueAtZ(lms, c.z)) } : null
          })
          .filter((p): p is { x: number; y: number } => p !== null),
      }))
    : []
  const last = pts[pts.length - 1]
  const prev = pts.length > 1 ? pts[pts.length - 2] : null
  const fmt = (v: number) => `${Math.round(show(v) * (k === 'weight' ? 100 : 10)) / (k === 'weight' ? 100 : 10)} ${unit}`
  return (
    <ChartCard
      title="Growth"
      sub={child.sex ? `${name} by age, against the WHO growth curves (3rd to 97th percentile).` : `${name} by age. Add whether ${child.name} is a girl or a boy (Family › babies) to compare with the WHO growth curves.`}
      stats={[
        { label: `Latest, ${fmtShortDate(last.at, tz)}`, value: fmt(last.value) },
        ...(last.percentile !== undefined ? [{ label: 'WHO percentile', value: ordinal(last.percentile) }] : []),
        ...(prev ? [{ label: `Since ${fmtShortDate(prev.at, tz)}`, value: `${last.value >= prev.value ? '+' : '−'}${fmt(Math.abs(last.value - prev.value))}` }] : []),
      ]}
      table={{ head: ['Date', 'Age', name, 'Percentile'], rows: [...pts].reverse().map((p) => [fmtShortDate(p.at, tz), `${one(p.months)} m`, fmt(p.value), p.percentile !== undefined ? ordinal(p.percentile) : '–']) }}
    >
      {kinds.length > 1 && (
        <div className="mb-3 grid gap-1 rounded-2xl bg-card-2 p-1 ring-1 ring-line" style={{ gridTemplateColumns: `repeat(${kinds.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label="Measurement">
          {kinds.map((x) => (
            <button key={x} type="button" role="radio" aria-checked={x === k} onClick={() => setKind(x)} className={clsx('h-10 rounded-xl text-[14px] font-semibold', x === k ? 'bg-card shadow-lift' : 'text-ink-2')}>
              {{ weight: 'Weight', length: 'Length', head: 'Head' }[x]}
            </button>
          ))}
        </div>
      )}
      <LineChart
        label={`${name} by age in months`}
        color="var(--c-growth)"
        xDomain={[x0, x1]}
        xTicks={xTicks}
        curves={curves}
        yFormat={(v) => (k === 'weight' ? one(v) : String(Math.round(v)))}
        points={pts.map((p) => ({ id: p.id, x: p.months, y: show(p.value), tip: `${fmt(p.value)} at ${one(p.months)} months${p.percentile !== undefined ? `, ${ordinal(p.percentile)} percentile` : ''}` }))}
      />
      {child.due_date && child.due_date > child.birth_date && <p className="mt-2 text-[13px] text-ink-3">Uses corrected age (from the due date) until 2 years.</p>}
    </ChartCard>
  )
}
