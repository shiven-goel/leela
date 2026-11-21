import clsx from 'clsx'
import { CaretRight } from '@phosphor-icons/react'
import { toneSoft, toneVar } from '../../lib/config'
import { hourRange, type Category, type Headline, type Stat } from '../../lib/insights'
import { TypeIcon } from '../Icon'
import { useWidth } from '../charts/useWidth'

/** A tiny bar chart of a category's figure over the period, for the overview rows. */
export function Sparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values, 0)
  if (values.length < 2 || !(max > 0)) return null
  const w = 72
  const h = 26
  const gap = values.length > 20 ? 1 : 2
  const bw = Math.max(1, (w - gap * (values.length - 1)) / values.length)
  return (
    <svg width={w} height={h} aria-hidden="true" className="shrink-0">
      {values.map((v, i) => {
        const bh = v > 0 ? Math.max(2, (v / max) * h) : 1
        return <rect key={i} x={i * (bw + gap)} y={h - bh} width={bw} height={bh} rx={Math.min(1.5, bw / 2)} fill={v > 0 ? color : 'var(--line)'} opacity={i === values.length - 1 ? 1 : 0.7} />
      })}
    </svg>
  )
}

/** One row of the overview: icon, name, the period's figure, a sparkline and the change. */
export function CategoryRow({ c, h, spark, delta, onOpen }: { c: Category; h: Headline; spark?: number[]; delta?: string | null; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-card-2" aria-label={`${c.label}: ${h.value} ${h.unit}. ${h.sub}. Open ${c.label}`}>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: toneSoft(c.tone), color: toneVar(c.tone) }}>
          <TypeIcon type={c.icon.type} kind={c.icon.kind} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-ink-2">{c.label}</span>
          <span className="flex items-baseline gap-1.5">
            <span className="num truncate text-[20px] font-bold leading-tight">{h.value}</span>
            {h.unit && <span className="shrink-0 text-[14px] text-ink-2">{h.unit}</span>}
            {delta && <span className="num shrink-0 rounded-full bg-card-2 px-2 text-[12px] font-semibold text-ink-2 ring-1 ring-line">{delta}</span>}
          </span>
          {h.sub && <span className="block truncate text-[13px] text-ink-2">{h.sub}</span>}
        </span>
        {spark && <Sparkline values={spark} color={toneVar(c.tone)} />}
        <CaretRight size={18} weight="bold" className="shrink-0 text-ink-3" aria-hidden="true" />
      </button>
    </li>
  )
}

/** Figures in a two-column grid. */
export function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <dl className="grid grid-cols-2 gap-2">
      {stats.map((s) => (
        <div key={s.label} className="min-w-0 rounded-2xl bg-card px-3.5 py-2.5">
          <dt className="truncate text-[13px] text-ink-2">{s.label}</dt>
          <dd className="num truncate text-[19px] font-bold leading-tight">{s.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** How often something happens at each hour of the day, midnight to midnight. */
export function HourChart({ counts, color, label }: { counts: number[]; color: string; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const max = Math.max(...counts, 1)
  const h = 70
  const band = width / 24
  const peak = counts.indexOf(Math.max(...counts))
  return (
    <div ref={ref} className="w-full" role="img" aria-label={`${label}. Most often ${hourRange(peak)}.`}>
      <svg width={width} height={h + 20} aria-hidden="true">
        <rect x={0} y={0} width={band * 7} height={h} fill="var(--ring-night)" opacity={0.45} rx={6} />
        <rect x={band * 19} y={0} width={band * 5} height={h} fill="var(--ring-night)" opacity={0.45} rx={6} />
        {counts.map((v, i) => {
          const bh = v ? Math.max(3, (v / max) * (h - 4)) : 0
          return v ? <rect key={i} x={i * band + band * 0.15} y={h - bh} width={band * 0.7} height={bh} rx={Math.min(3, band * 0.3)} fill={color} opacity={i === peak ? 1 : 0.65} /> : null
        })}
        <line x1={0} x2={width} y1={h} y2={h} stroke="var(--line)" />
        {[0, 6, 12, 18].map((hr) => (
          <text key={hr} x={hr * band + 2} y={h + 15} fontSize="11" fill="var(--ink-3)">
            {hr === 0 ? '12a' : hr === 12 ? '12p' : hr < 12 ? `${hr}a` : `${hr - 12}p`}
          </text>
        ))}
      </svg>
    </div>
  )
}

/** A rounded card with a heading. */
export function Panel({ title, children, className, aside }: { title?: string; children: React.ReactNode; className?: string; aside?: React.ReactNode }) {
  return (
    <section className={clsx('mb-4 rounded-[26px] bg-card p-4', className)} aria-label={title}>
      {(title || aside) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          {title && <h3 className="font-display text-[18px] font-bold leading-tight">{title}</h3>}
          {aside}
        </div>
      )}
      {children}
    </section>
  )
}
