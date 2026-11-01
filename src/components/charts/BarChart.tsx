import { TZDate } from '@date-fns/tz'
import { useState } from 'react'
import { dayTick, niceMax } from './chartUtils'
import { useWidth } from './useWidth'

export interface BarSeries {
  key: string
  label: string
  color: string
  values: number[]
}

const AXIS = 38
const BOTTOM = 22

/** Rounded data end at the top, square at the baseline. */
function barPath(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h)
  return `M ${x} ${y + h} V ${y + rr} Q ${x} ${y} ${x + rr} ${y} H ${x + w - rr} Q ${x + w} ${y} ${x + w} ${y + rr} V ${y + h} Z`
}

/**
 * Columns per day, stacked when there's more than one series. Tap or use the arrow keys for a
 * day's numbers; the card's table view lists them all.
 */
export function BarChart({
  days,
  tz,
  series,
  format,
  height = 140,
  average,
  label,
  max,
  minStep = 0,
}: {
  days: number[]
  tz: string
  series: BarSeries[]
  format: (v: number) => string
  height?: number
  /** Draws a reference line at the average of the day totals. */
  average?: boolean
  label: string
  /** Fix the top of the scale, so small multiples share one. */
  max?: number
  /** Smallest gap between ticks: 1 for counts. */
  minStep?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const n = days.length
  const totals = days.map((_, i) => series.reduce((t, s) => t + (s.values[i] ?? 0), 0))
  const nice = niceMax(Math.max(max ?? 0, ...totals, 0))
  // Counts step in whole numbers: 0, 3, 6 rather than 0, 2.5, 5.
  const step = minStep ? Math.max(minStep, Math.ceil(nice.step / minStep) * minStep) : nice.step
  const top = Math.max(step, Math.ceil(nice.top / step) * step)
  const plotW = width - AXIS - 4
  const band = plotW / n
  const bw = Math.max(2, Math.min(24, band * 0.62))
  const y = (v: number) => 6 + (1 - v / top) * height
  const x = (i: number) => AXIS + band * i + band / 2
  const withData = totals.filter((t) => t > 0)
  const avg = withData.length ? withData.reduce((a, b) => a + b, 0) / withData.length : 0

  const pick = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    const i = Math.floor((clientX - r.left - AXIS) / band)
    setActive(i >= 0 && i < n ? i : null)
  }
  const tip = active !== null ? active : null

  return (
    <div
      ref={ref}
      className="relative w-full touch-pan-y outline-none"
      tabIndex={0}
      role="group"
      aria-label={`${label}. Use the left and right arrow keys to read each day.`}
      onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
      onPointerMove={(e) => e.pointerType === 'mouse' && pick(e.clientX, e.currentTarget)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
      onBlur={() => setActive(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') setActive((a) => Math.min(n - 1, (a ?? -1) + 1))
        else if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? n) - 1))
        else if (e.key === 'Escape') setActive(null)
        else return
        e.preventDefault()
      }}
    >
      <svg width={width} height={height + 6 + BOTTOM} aria-hidden="true">
        {Array.from({ length: Math.round(top / step) + 1 }, (_, k) => k * step).map((v) => (
          <g key={v}>
            <line x1={AXIS} x2={width - 4} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={AXIS - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)" className="num">
              {format(v)}
            </text>
          </g>
        ))}
        {tip !== null && <rect x={x(tip) - band / 2 + 1} y={6} width={band - 2} height={height} rx={6} fill="var(--card-2)" />}
        {days.map((day, i) => {
          let base = 0
          const segs = series.map((s, k) => {
            const v = s.values[i] ?? 0
            const y0 = y(base)
            base += v
            const y1 = y(base)
            const isTop = series.slice(k + 1).every((t) => !(t.values[i] > 0))
            // A 2px surface gap between stacked segments.
            const h = Math.max(0, y0 - y1 - (k > 0 && v > 0 ? 2 : 0))
            return v > 0 && h > 0 ? (
              <path key={s.key} d={isTop ? barPath(x(i) - bw / 2, y1, bw, h, 4) : `M ${x(i) - bw / 2} ${y1} h ${bw} v ${h} h ${-bw} Z`} fill={s.color} />
            ) : null
          })
          const t = dayTick(day, i, n, tz)
          return (
            <g key={day}>
              {segs}
              {t && (
                <text x={x(i)} y={height + 6 + 16} textAnchor="middle" fontSize="11" fill="var(--ink-3)" className="num">
                  {t}
                </text>
              )}
            </g>
          )
        })}
        {average && avg > 0 && (
          <g>
            <line x1={AXIS} x2={width - 4} y1={y(avg)} y2={y(avg)} stroke="var(--ink-2)" strokeWidth={1} />
            <text x={width - 6} y={y(avg) - 5} textAnchor="end" fontSize="11" fontWeight={600} fill="var(--ink-2)" stroke="var(--card)" strokeWidth={4} strokeLinejoin="round" paintOrder="stroke">
              avg {format(avg)}
            </text>
          </g>
        )}
      </svg>
      {tip !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-xl bg-[var(--ink)] px-3 py-2 text-[13px] text-[var(--card)] shadow-lift"
          style={{ left: Math.min(Math.max(0, x(tip) - 70), width - 150), minWidth: 140 }}
          role="status"
        >
          <p className="font-semibold">{new TZDate(days[tip], tz).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz })}</p>
          {series.map((s) => (
            <p key={s.key} className="flex items-center gap-2">
              <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} aria-hidden="true" />
              <strong className="num font-semibold">{format(s.values[tip] ?? 0)}</strong>
              {series.length > 1 && <span className="opacity-75">{s.label}</span>}
            </p>
          ))}
          {series.length > 1 && (
            <p className="opacity-75">
              Total <strong className="num font-semibold opacity-100">{format(totals[tip])}</strong>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
