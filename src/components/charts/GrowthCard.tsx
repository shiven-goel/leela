import clsx from 'clsx'
import { useState } from 'react'
import { ChartCard } from './ChartCard'
import { LineChart } from './LineChart'
import { CENTILES, type GrowthKind, ageMonths, growthPoints, lmsAt, valueAtZ } from '../../lib/charts'
import { myPrefs, useLeela } from '../../lib/store'
import { fmtShortDate } from '../../lib/time'
import type { Child, LeelaEvent } from '../../lib/types'
import { CM_PER_IN, lengthUnit } from '../../lib/units'

const ordinal = (n: number) => {
  const r = Math.round(n)
  if (r < 1) return 'below the 1st'
  if (r > 99) return 'above the 99th'
  const s = r % 100 >= 11 && r % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][r % 10] ?? 'th'
  return `${r}${s}`
}
const one = (n: number) => (Math.round(n * 10) / 10).toString()

// ---------------------------------------------------------------------------- growth
/** Growth by age. With `who`, against the WHO curves and percentiles (only in the admin panel). */
export function GrowthCard({ child, events, now, who }: { child: Child; events: LeelaEvent[]; now: number; who: boolean }) {
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
  const curves = child.sex && who
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
      sub={!who ? `${name} by age.` : child.sex ? `${name} by age, against the WHO growth curves (3rd to 97th percentile).` : `${name} by age. Add whether ${child.name} is a girl or a boy (Settings › babies) to compare with the WHO growth curves.`}
      stats={[
        { label: `Latest, ${fmtShortDate(last.at, tz)}`, value: fmt(last.value) },
        ...(who && last.percentile !== undefined ? [{ label: 'WHO percentile', value: ordinal(last.percentile) }] : []),
        ...(prev ? [{ label: `Since ${fmtShortDate(prev.at, tz)}`, value: `${last.value >= prev.value ? '+' : '−'}${fmt(Math.abs(last.value - prev.value))}` }] : []),
      ]}
      table={
        who
          ? { head: ['Date', 'Age', name, 'Percentile'], rows: [...pts].reverse().map((p) => [fmtShortDate(p.at, tz), `${one(p.months)} m`, fmt(p.value), p.percentile !== undefined ? ordinal(p.percentile) : '–']) }
          : { head: ['Date', 'Age', name], rows: [...pts].reverse().map((p) => [fmtShortDate(p.at, tz), `${one(p.months)} m`, fmt(p.value)]) }
      }
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
        points={pts.map((p) => ({ id: p.id, x: p.months, y: show(p.value), tip: `${fmt(p.value)} at ${one(p.months)} months${who && p.percentile !== undefined ? `, ${ordinal(p.percentile)} percentile` : ''}` }))}
      />
      {child.due_date && child.due_date > child.birth_date && <p className="mt-2 text-[13px] text-ink-3">Uses corrected age (from the due date) until 2 years.</p>}
    </ChartCard>
  )
}
