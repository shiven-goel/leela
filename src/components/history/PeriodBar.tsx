import clsx from 'clsx'
import { CalendarBlank, CaretLeft, CaretRight } from '@phosphor-icons/react'
import { useState } from 'react'
import { canGoLater, customPeriod, lifeMonths, makePeriod, periodLabel, rangeText, shiftPeriod, type Period, type PeriodKind } from '../../lib/period'
import { addDaysTz, dayKey } from '../../lib/time'
import { TZDate } from '@date-fns/tz'
import { Sheet } from '../Sheet'
import { Button } from '../ui'

const KINDS: { id: Exclude<PeriodKind, 'custom'>; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'all', label: 'All' },
]

const fromInput = (v: string, tz: string) => {
  const [y, m, d] = v.split('-').map(Number)
  return new TZDate(y, m - 1, d, tz).getTime()
}

/**
 * Day · Week · Month · All, with arrows to step back and forward and the dates in the middle:
 * tapping them picks any day, any month of life, a calendar month or your own dates.
 */
export function PeriodBar({
  period,
  onChange,
  tz,
  now,
  start,
  birth,
  kinds = KINDS.map((k) => k.id),
}: {
  period: Period
  onChange: (p: Period) => void
  tz: string
  now: number
  /** First day there could be anything to show (birth). */
  start: number
  birth: string | null
  kinds?: PeriodKind[]
}) {
  const [picking, setPicking] = useState(false)
  const anchor = Math.min(now, period.to - 1)
  const label = periodLabel(period, tz, now, { birth: Boolean(birth) })
  const sub = period.kind === 'day' ? null : period.kind === 'all' ? rangeText(period.from, now, tz) : period.kind === 'month' || label === 'Last 7 days' ? rangeText(period.from, Math.min(now, addDaysTz(period.to, -1, tz).getTime()), tz) : null
  const later = canGoLater(period, tz, now)
  const earlier = period.kind !== 'all' && period.from > start

  return (
    <div className="mb-4">
      <div className="grid gap-1 rounded-2xl bg-card p-1 ring-1 ring-line" style={{ gridTemplateColumns: `repeat(${kinds.length}, minmax(0, 1fr))` }} role="tablist" aria-label="How much to show">
        {KINDS.filter((k) => kinds.includes(k.id)).map((k) => (
          <button
            key={k.id}
            type="button"
            role="tab"
            aria-selected={period.kind === k.id}
            onClick={() => onChange(makePeriod(k.id, k.id === 'day' && period.kind !== 'day' ? now : anchor, tz, start, now))}
            className={clsx('h-10 rounded-xl text-[15px] font-semibold', period.kind === k.id ? 'bg-brand text-brand-ink' : 'text-ink-2')}
          >
            {k.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(shiftPeriod(period, -1, tz, now))}
          disabled={!earlier}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-card ring-1 ring-line disabled:opacity-30"
          aria-label="Earlier"
        >
          <CaretLeft size={20} weight="bold" />
        </button>
        <button type="button" onClick={() => setPicking(true)} className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl px-2 text-center active:bg-card" aria-label={`${label}. Choose other dates`}>
          <span className="min-w-0">
            <span className="block truncate font-display text-[19px] font-bold leading-tight">{label}</span>
            {sub && <span className="block truncate text-[13px] text-ink-2">{sub}</span>}
          </span>
          <CalendarBlank size={18} weight="bold" className="shrink-0 text-ink-3" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onChange(shiftPeriod(period, 1, tz, now))}
          disabled={!later}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-card ring-1 ring-line disabled:opacity-30"
          aria-label="Later"
        >
          <CaretRight size={20} weight="bold" />
        </button>
      </div>
      <PeriodSheet
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(p) => {
          setPicking(false)
          onChange(p)
        }}
        period={period}
        tz={tz}
        now={now}
        start={start}
        birth={birth}
      />
    </div>
  )
}

function PeriodSheet({ open, onClose, onPick, period, tz, now, start, birth }: { open: boolean; onClose: () => void; onPick: (p: Period) => void; period: Period; tz: string; now: number; start: number; birth: string | null }) {
  const today = dayKey(now, tz)
  const min = dayKey(start, tz)
  const [from, setFrom] = useState(() => dayKey(period.from, tz))
  const [to, setTo] = useState(() => dayKey(Math.min(now, period.to - 1), tz))
  const months = birth ? lifeMonths(birth, tz, now) : []
  const calendar: Period[] = []
  for (let p = makePeriod('month', now, tz, start, now); p.to > start && calendar.length < 24; p = { ...p, ...prevMonth(p, tz) }) calendar.push(p)
  const quick: { label: string; p: Period }[] = [
    { label: 'Today', p: makePeriod('day', now, tz, start, now) },
    { label: 'Last 7 days', p: makePeriod('week', now, tz, start, now) },
    { label: 'Last 30 days', p: customPeriod(addDaysTz(now, -29, tz).getTime(), now, tz) },
    { label: 'Last 3 months', p: customPeriod(Math.max(start, addDaysTz(now, -90, tz).getTime()), now, tz) },
    { label: birth ? 'Since birth' : 'Everything', p: makePeriod('all', now, tz, start, now) },
  ]
  const chip = 'min-h-11 rounded-full bg-card-2 px-4 text-[15px] font-semibold ring-1 ring-line active:bg-card'

  return (
    <Sheet open={open} onClose={onClose} title="Choose dates">
      <h3 className="mb-2 text-[15px] font-semibold text-ink-2">Quick picks</h3>
      <div className="mb-5 flex flex-wrap gap-2">
        {quick.map((q) => (
          <button key={q.label} type="button" className={chip} onClick={() => onPick(q.p)}>
            {q.label}
          </button>
        ))}
      </div>

      <label className="mb-5 block">
        <span className="mb-2 block text-[15px] font-semibold text-ink-2">A particular day</span>
        <input
          type="date"
          min={min}
          max={today}
          className="h-13 w-full rounded-2xl border border-line bg-card-2 px-4 text-[17px]"
          onChange={(e) => e.target.value && onPick(makePeriod('day', fromInput(e.target.value, tz), tz, start, now))}
        />
      </label>

      {months.length > 1 && (
        <>
          <h3 className="mb-2 text-[15px] font-semibold text-ink-2">Month of life</h3>
          <div className="mb-5 flex flex-wrap gap-2">
            {months.map((m) => (
              <button key={m.n} type="button" className={chip} onClick={() => onPick(m.period)}>
                Month {m.n} <span className="font-normal text-ink-2">· {rangeText(m.period.from, Math.min(now, addDaysTz(m.period.to, -1, tz).getTime()), tz)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {calendar.length > 1 && (
        <>
          <h3 className="mb-2 text-[15px] font-semibold text-ink-2">Calendar month</h3>
          <div className="mb-5 flex flex-wrap gap-2">
            {calendar.map((p) => (
              <button key={p.from} type="button" className={chip} onClick={() => onPick(p)}>
                {new TZDate(p.from, tz).toLocaleDateString('en', { month: 'long', year: new TZDate(p.from, tz).getFullYear() === new TZDate(now, tz).getFullYear() ? undefined : 'numeric', timeZone: tz })}
              </button>
            ))}
          </div>
        </>
      )}

      <h3 className="mb-2 text-[15px] font-semibold text-ink-2">Your own dates</h3>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <label>
          <span className="mb-1 block text-[13px] text-ink-2">From</span>
          <input type="date" value={from} min={min} max={today} onChange={(e) => setFrom(e.target.value)} className="h-13 w-full rounded-2xl border border-line bg-card-2 px-3 text-[16px]" />
        </label>
        <label>
          <span className="mb-1 block text-[13px] text-ink-2">To</span>
          <input type="date" value={to} min={min} max={today} onChange={(e) => setTo(e.target.value)} className="h-13 w-full rounded-2xl border border-line bg-card-2 px-3 text-[16px]" />
        </label>
      </div>
      <Button className="mb-2 w-full" disabled={!from || !to} onClick={() => onPick(customPeriod(fromInput(from, tz), fromInput(to, tz), tz))}>
        Show these dates
      </Button>
    </Sheet>
  )
}

function prevMonth(p: Period, tz: string): Period {
  const d = new TZDate(p.from, tz)
  return { kind: 'month', from: new TZDate(d.getFullYear(), d.getMonth() - 1, 1, tz).getTime(), to: p.from }
}
