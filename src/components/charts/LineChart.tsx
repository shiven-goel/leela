import { useState } from 'react'
import { niceMax } from './chartUtils'
import { useWidth } from './useWidth'

export interface LinePoint {
  id: string
  x: number
  y: number
  /** Shown when the point is tapped. */
  tip: string
}

const AXIS = 40
const RIGHT = 38
const BOTTOM = 22

/** A single series over time or age, with optional reference curves (WHO centiles) and lines. */
export function LineChart({
  points,
  xDomain,
  xTicks,
  yFormat,
  color,
  curves = [],
  refLines = [],
  height = 170,
  label,
  yFloor,
}: {
  points: LinePoint[]
  xDomain: [number, number]
  xTicks: { x: number; label: string }[]
  yFormat: (v: number) => string
  color: string
  curves?: { label: string; points: { x: number; y: number }[] }[]
  refLines?: { y: number; label: string }[]
  height?: number
  label: string
  /** The lowest the y axis may start at (e.g. 35 for temperatures). */
  yFloor?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<string | null>(null)
  const ys = [...points.map((p) => p.y), ...curves.flatMap((c) => c.points.map((p) => p.y)), ...refLines.map((r) => r.y)]
  const lo0 = Math.min(...ys)
  const hi0 = Math.max(...ys)
  const pad = (hi0 - lo0) * 0.08 || Math.max(1, hi0 * 0.05)
  let lo = yFloor !== undefined ? Math.max(yFloor, lo0 - pad) : lo0 - pad
  const { step } = niceMax(hi0 + pad - lo, 3)
  lo = Math.floor(lo / step) * step
  const hi = Math.ceil((hi0 + pad) / step) * step
  const plotW = width - AXIS - RIGHT
  const x = (v: number) => AXIS + ((v - xDomain[0]) / (xDomain[1] - xDomain[0] || 1)) * plotW
  const y = (v: number) => 8 + (1 - (v - lo) / (hi - lo || 1)) * height
  const path = (ps: { x: number; y: number }[]) => ps.map((p, i) => `${i ? 'L' : 'M'} ${x(p.x).toFixed(1)} ${y(p.y).toFixed(1)}`).join(' ')
  const tip = points.find((p) => p.id === active)
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(6)))

  return (
    <div ref={ref} className="relative w-full" role="group" aria-label={label}>
      <svg width={width} height={height + 8 + BOTTOM} aria-hidden="true" onPointerDown={() => setActive(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={AXIS} x2={width - RIGHT} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={AXIS - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)" className="num">
              {yFormat(v)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t.x} x={x(t.x)} y={height + 8 + 16} textAnchor="middle" fontSize="11" fill="var(--ink-3)" className="num">
            {t.label}
          </text>
        ))}
        {curves.map((c) => (
          <g key={c.label}>
            <path d={path(c.points)} fill="none" stroke="var(--c-other)" strokeWidth={c.label === '50th' ? 1.5 : 1} />
            {c.points.length > 0 && (
              <text x={width - RIGHT + 4} y={y(c.points[c.points.length - 1].y) + 4} fontSize="10" fill="var(--ink-3)">
                {c.label}
              </text>
            )}
          </g>
        ))}
        {refLines.map((r) => (
          <g key={r.label}>
            <line x1={AXIS} x2={width - RIGHT} y1={y(r.y)} y2={y(r.y)} stroke="var(--c-health)" strokeWidth={1} />
            <text x={width - RIGHT - 2} y={y(r.y) - 5} textAnchor="end" fontSize="11" fontWeight={600} fill="var(--ink-2)" stroke="var(--card)" strokeWidth={4} strokeLinejoin="round" paintOrder="stroke">
              {r.label}
            </text>
          </g>
        ))}
        {points.length > 1 && <path d={path(points)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {points.map((p) => (
          <circle key={p.id} cx={x(p.x)} cy={y(p.y)} r={p.id === active ? 6 : 4.5} fill={color} stroke="var(--card)" strokeWidth={2} />
        ))}
      </svg>
      {/* Big, invisible tap targets on each point. */}
      {points.map((p) => (
        <button
          key={p.id}
          type="button"
          className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: x(p.x), top: y(p.y) }}
          onClick={() => setActive(p.id === active ? null : p.id)}
          onBlur={() => setActive(null)}
          aria-label={p.tip}
        />
      ))}
      {tip && (
        <div
          className="pointer-events-none absolute z-10 rounded-xl bg-[var(--ink)] px-3 py-2 text-[13px] text-[var(--card)] shadow-lift"
          style={{ left: Math.min(Math.max(0, x(tip.x) - 80), width - 170), top: Math.max(0, y(tip.y) - 58), minWidth: 160 }}
          role="status"
        >
          {tip.tip}
        </div>
      )}
    </div>
  )
}
