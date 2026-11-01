import type { Mark } from '../../lib/charts'
import type { Family } from '../../lib/types'
import { MARK_COLOR } from './chartUtils'
import { useWidth } from './useWidth'

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** One day, midnight to midnight, at a glance: sleep as blocks, feeds above, diapers below. */
export function DayStrip({ marks, from, to, family, now, label }: { marks: Mark[]; from: number; to: number; family: Family; now: number; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const H = 40
  const x = (t: number) => ((t - from) / (to - from)) * width
  const xm = (minute: number) => (minute / 1440) * width
  const ns = toMin(family.night_start)
  const ne = toMin(family.night_end)
  const night: [number, number][] = ns > ne ? [[0, ne], [ns, 1440]] : [[ns, ne]]
  return (
    <div ref={ref} className="mb-4 w-full">
      <svg width={width} height={H + 18} role="img" aria-label={label}>
        <rect x={0} y={0} width={width} height={H} rx={10} fill="var(--card)" />
        {night.map(([a, b]) => (
          <rect key={a} x={xm(a)} y={0} width={xm(b) - xm(a)} height={H} fill="var(--ring-night)" opacity={0.8} />
        ))}
        {[360, 720, 1080].map((m) => (
          <line key={m} x1={xm(m)} x2={xm(m)} y1={0} y2={H} stroke="var(--line)" strokeWidth={1} />
        ))}
        {marks.map((m) => {
          if (m.kind === 'night' || m.kind === 'nap') {
            return <rect key={m.id} x={x(m.start)} y={9} width={Math.max(2, x(m.end) - x(m.start))} height={22} rx={4} fill={MARK_COLOR[m.kind]} />
          }
          if (m.kind === 'health') {
            const cx = x(m.start)
            return (
              <g key={m.id}>
                <path d={`M ${cx} 15 v 10 M ${cx - 5} 20 h 10`} stroke="var(--card)" strokeWidth={6} strokeLinecap="round" />
                <path d={`M ${cx} 15 v 10 M ${cx - 5} 20 h 10`} stroke="var(--ink)" strokeWidth={2.4} strokeLinecap="round" />
              </g>
            )
          }
          const top = m.kind === 'feed' ? 2 : m.kind === 'diaper' ? 26 : 14
          const w = Math.max(4, x(m.end) - x(m.start))
          return <rect key={m.id} x={x(m.start) - (m.timed ? 0 : 2)} y={top} width={w} height={12} rx={2} fill={MARK_COLOR[m.kind]} stroke="var(--card)" strokeWidth={1.5} paintOrder="stroke" />
        })}
        {now >= from && now < to && <line x1={x(now)} x2={x(now)} y1={-2} y2={H + 2} stroke="var(--brand)" strokeWidth={2} strokeLinecap="round" />}
        {[
          [0, '12a', 'start'],
          [360, '6a', 'middle'],
          [720, '12p', 'middle'],
          [1080, '6p', 'middle'],
          [1440, '12a', 'end'],
        ].map(([m, t, anchor]) => (
          <text key={String(m)} x={xm(Number(m))} y={H + 14} textAnchor={anchor as 'start'} fontSize="11" fill="var(--ink-3)">
            {t}
          </text>
        ))}
      </svg>
    </div>
  )
}
