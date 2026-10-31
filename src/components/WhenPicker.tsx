import clsx from 'clsx'
import { CalendarBlank } from '@phosphor-icons/react'
import { useId, useState } from 'react'
import { dayLabel, fmtTime, fromLocalInput, toLocalInput } from '../lib/time'

const MIN = 60_000

/**
 * Pick when something happened: now, a few minutes ago, yesterday, or any date and time since birth.
 * This is how forgotten entries get backdated.
 */
export function WhenPicker({
  label,
  value,
  onChange,
  timeZone,
  minDate,
  allowFutureMin = 5,
}: {
  label: string
  value: Date
  onChange: (d: Date) => void
  timeZone: string
  minDate?: string | null
  allowFutureMin?: number
}) {
  const [openedAt] = useState(() => Date.now())
  const [custom, setCustom] = useState(false)
  const id = useId()
  const v = value.getTime()

  const presets = [
    { id: 'now', label: 'Now', at: openedAt },
    { id: '15', label: '15 min ago', at: openedAt - 15 * MIN },
    { id: '60', label: '1 h ago', at: openedAt - 60 * MIN },
    { id: 'y', label: 'Yesterday', at: openedAt - 24 * 60 * MIN },
  ]
  const active = custom ? null : presets.find((p) => Math.abs(p.at - v) < 30_000)?.id ?? null
  const minIso = minDate ? `${minDate}T00:00` : undefined
  const maxIso = toLocalInput(openedAt + allowFutureMin * MIN, timeZone)

  return (
    <div className="mb-5">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-semibold text-ink-2">{label}</span>
        <span className="text-[15px] font-semibold">
          {dayLabel(value, timeZone)}, {fmtTime(value, timeZone)}
        </span>
      </div>
      <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setCustom(false)
              onChange(new Date(p.at))
            }}
            aria-pressed={active === p.id}
            className={clsx(
              'min-h-10 shrink-0 rounded-full px-4 text-[15px] font-medium',
              active === p.id ? 'bg-brand text-brand-ink' : 'bg-card-2 ring-1 ring-line',
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCustom(true)}
          aria-pressed={custom || active === null}
          className={clsx(
            'inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-[15px] font-medium',
            custom || active === null ? 'bg-brand text-brand-ink' : 'bg-card-2 ring-1 ring-line',
          )}
        >
          <CalendarBlank size={18} weight="bold" aria-hidden="true" />
          Earlier day
        </button>
      </div>
      {(custom || active === null) && (
        <div className="mt-3">
          <label htmlFor={id} className="sr-only">
            {label} date and time
          </label>
          <input
            id={id}
            type="datetime-local"
            value={toLocalInput(value, timeZone)}
            min={minIso}
            max={maxIso}
            onChange={(e) => {
              const d = fromLocalInput(e.target.value, timeZone)
              if (d) onChange(d)
            }}
            className="h-13 w-full rounded-2xl border border-line bg-card-2 px-4 text-[17px] outline-none focus:border-brand"
          />
          <p className="mt-1.5 text-sm text-ink-3">Any day since birth works. It will count on that day everywhere.</p>
        </div>
      )}
    </div>
  )
}
