import clsx from 'clsx'
import { TZDate } from '@date-fns/tz'
import { MARK_FILTER, type Column, type Filter, type Mark, type MarkKind } from '../../lib/charts'
import { MARK_COLOR } from './chartUtils'
import type { Family } from '../../lib/types'
import { useWidth } from './useWidth'

const AXIS = 34
const HEAD = 44
const PER_HOUR = 22
const PLOT = 24 * PER_HOUR

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
const hourLabel = (minute: number) => {
  const h = Math.floor((((minute % 1440) + 1440) % 1440) / 60)
  return `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`
}

/** A small swatch that matches how a class is drawn, for legends and filter chips. */
export function Swatch({ kind }: { kind: MarkKind }) {
  if (kind === 'health') {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
        <path d="M6 1.5v9M1.5 6h9" stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    )
  }
  return <span className="h-3 w-3 shrink-0 rounded-[3px]" style={{ background: MARK_COLOR[kind] }} aria-hidden="true" />
}

/**
 * Huckleberry-style week: one column per day running from the morning wake-up hour to the same
 * time next day, so each night sits whole at the bottom of its column.
 */
export function WeekChart({
  columns,
  family,
  now,
  startHHMM,
  show,
  summaries,
  onPickDay,
}: {
  columns: Column[]
  family: Family
  now: number
  startHHMM: string
  show: Set<Filter>
  /** Accessible summary per column, e.g. "13h 20m sleep, 7 feeds, 8 diapers". */
  summaries: string[]
  onPickDay: (day: number) => void
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const tz = family.timezone
  const n = columns.length
  const colW = (width - AXIS) / n
  const bw = Math.max(12, Math.min(colW - 10, 30))
  const start = toMin(startHHMM)
  const yRel = (minutes: number) => HEAD + (minutes / 1440) * PLOT
  const y = (c: Column, t: number) => HEAD + ((t - c.from) / (c.to - c.from)) * PLOT
  const cx = (i: number) => AXIS + colW * i + colW / 2

  // Night hours, shaded behind every column.
  const ns = (toMin(family.night_start) - start + 1440) % 1440
  const ne = (toMin(family.night_end) - start + 1440) % 1440 || 1440
  const night: [number, number][] = ns < ne ? [[ns, ne]] : [[0, ne], [ns, 1440]]

  const today = columns.findIndex((c) => now >= c.from && now < c.to)
  const visible = (m: Mark) => show.has(MARK_FILTER[m.kind])

  return (
    <div ref={ref} className="relative w-full select-none">
      <svg width={width} height={HEAD + PLOT + 6} role="img" aria-label={`Week chart from ${new TZDate(columns[0].day, tz).toDateString()}. Tap a day for its details.`}>
        {night.map(([a, b]) => (
          <rect key={a} x={AXIS} y={yRel(a)} width={width - AXIS} height={yRel(b) - yRel(a)} fill="var(--ring-night)" opacity={0.6} />
        ))}
        {Array.from({ length: 13 }, (_, k) => k * 120).map((m) => (
          <g key={m}>
            <line x1={AXIS} x2={width} y1={yRel(m)} y2={yRel(m)} stroke="var(--line)" strokeWidth={1} />
            <text x={AXIS - 6} y={yRel(m) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)" className="num">
              {hourLabel(start + m)}
            </text>
          </g>
        ))}

        {columns.map((c, i) => {
          const d = new TZDate(c.day, tz)
          const isToday = i === today
          return (
            <g key={c.day}>
              <text x={cx(i)} y={16} textAnchor="middle" fontSize="12" fontWeight={isToday ? 700 : 500} fill={isToday ? 'var(--brand)' : 'var(--ink-2)'}>
                {d.toLocaleDateString('en', { weekday: 'short', timeZone: tz }).slice(0, 2)}
              </text>
              <text x={cx(i)} y={34} textAnchor="middle" fontSize="15" fontWeight={700} fill={isToday ? 'var(--brand)' : 'var(--ink)'} className="num">
                {d.getDate()}
              </text>
              {c.marks.filter(visible).map((m) => (
                <MarkShape key={m.id} m={m} x={cx(i)} y1={y(c, m.start)} y2={y(c, m.end)} bw={bw} />
              ))}
            </g>
          )
        })}

        {today >= 0 && (
          <g aria-hidden="true">
            <line x1={cx(today) - colW / 2 + 2} x2={cx(today) + colW / 2 - 2} y1={y(columns[today], now)} y2={y(columns[today], now)} stroke="var(--brand)" strokeWidth={2} strokeLinecap="round" />
            <circle cx={cx(today) - colW / 2 + 3} cy={y(columns[today], now)} r={4} fill="var(--brand)" stroke="var(--card)" strokeWidth={2} />
          </g>
        )}
      </svg>

      {/* One button per day: tap a column to open that day. */}
      <div className="absolute top-0 bottom-0 flex" style={{ left: AXIS, right: 0 }}>
        {columns.map((c, i) => (
          <button
            key={c.day}
            type="button"
            onClick={() => onPickDay(c.day)}
            className={clsx('h-full flex-1 rounded-xl outline-offset-[-2px] active:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]')}
            aria-label={`${new TZDate(c.day, tz).toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz })}: ${summaries[i]}. Open this day`}
          />
        ))}
      </div>
    </div>
  )
}

function MarkShape({ m, x, y1, y2, bw }: { m: Mark; x: number; y1: number; y2: number; bw: number }) {
  if (m.kind === 'health') {
    const cy = y1
    return (
      <g aria-hidden="true">
        <path d={`M ${x} ${cy - 5} v 10 M ${x - 5} ${cy} h 10`} stroke="var(--card)" strokeWidth={6} strokeLinecap="round" />
        <path d={`M ${x} ${cy - 5} v 10 M ${x - 5} ${cy} h 10`} stroke="var(--ink)" strokeWidth={2.4} strokeLinecap="round" />
      </g>
    )
  }
  const sleep = m.kind === 'night' || m.kind === 'nap'
  // Feeds span the column; diapers and other entries are narrower, so a diaper changed at a feed
  // still shows inside it. A surface-coloured ring keeps every bar readable on top of sleep.
  const w = sleep || m.kind === 'feed' ? bw : m.kind === 'diaper' ? bw * 0.62 : bw * 0.45
  const h = sleep ? Math.max(3, y2 - y1) : m.timed ? Math.max(4, y2 - y1) : 4
  return (
    <rect
      x={x - w / 2}
      y={sleep || m.timed ? y1 : y1 - h / 2}
      width={w}
      height={h}
      rx={Math.min(4, h / 2)}
      fill={MARK_COLOR[m.kind]}
      stroke={sleep ? 'none' : 'var(--card)'}
      strokeWidth={sleep ? 0 : 1.5}
      paintOrder="stroke"
      aria-hidden="true"
    />
  )
}
