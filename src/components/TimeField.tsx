import clsx from 'clsx'
import { CalendarBlank, Clock } from '@phosphor-icons/react'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { dayLabel, durationText, fmtTime } from '../lib/time'
import { MIN, type Range, type When, addEnd, endAtTime, localParts, moveStart, shiftRange, whenText, withDate, withTime } from '../lib/timerange'
import { Sheet } from './Sheet'
import { Button, Toggle } from './ui'

/**
 * A date or time button that opens the phone's own picker the moment it's tapped: the clock dial on
 * Android, the wheel on iPhone. The real input sits invisibly over the button, so the tap lands on
 * it; a mouse also gets showPicker(), since desktop browsers only open it from a small icon.
 */
function PickerButton({
  type,
  value,
  label,
  display,
  onPick,
  min,
  max,
  icon,
  className,
  chip,
  pressed,
  tone,
}: {
  type: 'date' | 'time'
  value: string
  label: string
  display: ReactNode
  onPick: (v: string) => void
  min?: string
  max?: string
  icon?: ReactNode
  className?: string
  chip?: boolean
  pressed?: boolean
  tone?: string
}) {
  const pointer = useRef('')
  const [wheel, setWheel] = useState(false)
  if (type === 'time') {
    // Times use our own scroll wheels (like a phone's alarm clock) instead of the clock dial.
    return (
      <>
        <button
          type="button"
          aria-label={label}
          onClick={() => setWheel(true)}
          className={clsx(
            'relative flex min-w-0 items-center gap-2 overflow-hidden text-left',
            chip ? 'min-h-11 shrink-0 rounded-full px-4 text-[15px] font-medium' : 'h-14 rounded-2xl px-3.5',
            !pressed && 'bg-card-2 ring-1 ring-line',
            className,
          )}
          style={pressed ? { background: `var(--${tone ?? 'brand'})`, color: tone && tone !== 'brand' ? '#fff' : 'var(--brand-ink)' } : undefined}
        >
          {icon}
          <span aria-hidden="true" className={clsx('truncate', !chip && 'num text-[18px] font-semibold')}>
            {display}
          </span>
        </button>
        {wheel && (
          <WheelTimeSheet
            title={label}
            value={value}
            tone={tone}
            onClose={() => setWheel(false)}
            onPick={(v) => {
              setWheel(false)
              onPick(v)
            }}
          />
        )}
      </>
    )
  }
  return (
    <label
      className={clsx(
        'relative flex min-w-0 items-center gap-2 overflow-hidden focus-within:ring-2',
        chip ? 'min-h-11 shrink-0 rounded-full px-4 text-[15px] font-medium' : 'h-14 rounded-2xl px-3.5',
        !pressed && 'bg-card-2 ring-1 ring-line focus-within:ring-brand',
        className,
      )}
      style={pressed ? { background: `var(--${tone ?? 'brand'})`, color: tone && tone !== 'brand' ? '#fff' : 'var(--brand-ink)' } : undefined}
    >
      {icon}
      <span aria-hidden="true" className={clsx('truncate', !chip && 'num text-[18px] font-semibold')}>
        {display}
      </span>
      <input
        type={type}
        aria-label={label}
        value={value}
        min={min}
        max={max}
        onPointerDown={(e) => {
          pointer.current = e.pointerType
        }}
        onClick={(e) => {
          if (pointer.current === 'touch' || pointer.current === 'pen') return
          try {
            ;(e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.()
          } catch {
            /* not allowed here; typing still works */
          }
        }}
        onChange={(e) => {
          if (e.target.value) onPick(e.target.value)
        }}
        // 17px so iPhones don't zoom in when the hidden input takes focus.
        className="absolute inset-0 h-full w-full cursor-pointer text-[17px] opacity-0"
      />
    </label>
  )
}

const CHIPS = [
  { id: 'now', label: 'Now', min: 0 },
  { id: '5', label: '5 min ago', min: 5 },
  { id: '15', label: '15 min ago', min: 15 },
  { id: '30', label: '30 min ago', min: 30 },
  { id: '60', label: '1 h ago', min: 60 },
]

/**
 * When something happened: a date button and a time button, both always there. Shortcut chips
 * (Now, 5 min ago...) are optional extras and never hide the clock.
 */
export function TimeField({
  label,
  value,
  onChange,
  tz,
  minDate,
  chips = true,
  action,
  pickTime,
  className = 'mb-5',
}: {
  label: string
  value: number
  onChange: (ms: number) => void
  tz: string
  minDate?: string | null
  chips?: boolean
  /** Small buttons beside the label, like "Now". */
  action?: ReactNode
  /** How a picked clock time becomes a moment; by default the same day, or yesterday if that's ahead. */
  pickTime?: (base: number, time: string) => number
  className?: string
}) {
  const labelId = useId()
  // The value when the picker opened: typing a time digit by digit on a computer then can't drift days.
  const base = useRef<number | null>(null)
  const [chip, setChip] = useState<{ id: string; at: number } | null>(null)
  const now = Date.now()
  const { date, time } = localParts(value, tz)
  const remember = () => {
    base.current ??= value
  }
  const forget = () => {
    base.current = null
  }
  return (
    <div role="group" aria-labelledby={labelId} className={className}>
      <div className="mb-2 flex min-h-6 items-center justify-between gap-3">
        <span id={labelId} className="text-[15px] font-semibold text-ink-2">
          {label}
        </span>
        {action && <span className="flex items-center gap-1">{action}</span>}
      </div>
      <div className="grid grid-cols-[1fr_1.1fr] gap-2" onFocus={remember} onBlur={forget}>
        <PickerButton
          type="date"
          label={`${label} date`}
          value={date}
          display={dayLabel(value, tz, now)}
          min={minDate ?? undefined}
          max={localParts(now, tz).date}
          icon={<CalendarBlank size={18} weight="bold" className="shrink-0 text-ink-2" aria-hidden="true" />}
          onPick={(d) => {
            setChip(null)
            onChange(withDate(base.current ?? value, d, tz))
          }}
        />
        <PickerButton
          type="time"
          label={`${label} time`}
          value={time}
          display={fmtTime(value, tz)}
          icon={<Clock size={18} weight="bold" className="shrink-0 text-ink-2" aria-hidden="true" />}
          onPick={(t) => {
            setChip(null)
            const from = base.current ?? value
            onChange(pickTime ? pickTime(from, t) : withTime(from, t, tz, Date.now()))
          }}
        />
      </div>
      {chips && (
        <div className="no-scrollbar -mx-5 mt-2 flex gap-2 overflow-x-auto px-5 pb-1">
          {CHIPS.map((c) => {
            const on = chip?.id === c.id && chip.at === value
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const at = Date.now() - c.min * MIN
                  setChip({ id: c.id, at })
                  onChange(at)
                }}
                className={clsx('min-h-10 shrink-0 rounded-full px-4 text-[15px] font-medium', on ? 'bg-brand text-brand-ink' : 'bg-card-2 ring-1 ring-line')}
              >
                {c.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SmallButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-h-11 rounded-full px-3.5 text-[14px] font-semibold text-ink-2 ring-1 ring-line active:bg-card-2">
      {children}
    </button>
  )
}

/**
 * A start and an end, each picked on a clock, with how long that was. An end earlier on the clock
 * than the start means the next day (11:40 PM to 2:15 AM). Moving the start leaves the end alone
 * unless it stops making sense; see lib/timerange.ts.
 */
export function TimeRange({
  startLabel,
  endLabel,
  range,
  onChange,
  tz,
  minDate,
  verb = 'Lasted',
  ongoing,
  endOptional,
  defaultLen,
  keepLength,
  issue,
  tone,
}: {
  startLabel: string
  endLabel: string
  range: Range
  onChange: (r: Range) => void
  tz: string
  minDate?: string | null
  /** "Slept 1h 30m", "Lasted 20m". */
  verb?: string
  /** "Still asleep": when on, there's no end yet and a timer runs. */
  ongoing?: { label: string; value: boolean; onChange: (v: boolean) => void }
  /** The end can be left out (a quick bottle often isn't timed). */
  endOptional?: boolean
  defaultLen: number
  /** Moving the start moves the end with it (fixing the time of an imported entry). */
  keepLength?: boolean
  /** A problem with these times, shown under them. */
  issue?: string | null
  tone?: string
}) {
  const hideEnd = Boolean(ongoing?.value)
  const setStart = (s: number) => onChange(keepLength ? shiftRange(range, s) : moveStart(range, s, tz, Date.now(), defaultLen))
  return (
    <div className="mb-5">
      <TimeField label={startLabel} value={range.start} onChange={setStart} tz={tz} minDate={minDate} chips={false} className="mb-4" />
      {ongoing && (
        <div className="mb-4">
          <Toggle label={ongoing.label} checked={ongoing.value} onChange={ongoing.onChange} tone={tone} />
        </div>
      )}
      {!hideEnd &&
        (range.end === null ? (
          endOptional && (
            <div className="mb-4">
              <div className="mb-2 text-[15px] font-semibold text-ink-2">{endLabel}</div>
              <button
                type="button"
                onClick={() => onChange(addEnd(range, defaultLen, Date.now()))}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line text-[16px] font-semibold text-ink-2"
              >
                <Clock size={18} weight="bold" aria-hidden="true" /> Add end time
              </button>
            </div>
          )
        ) : (
          <TimeField
            label={endLabel}
            value={range.end}
            onChange={(end) => onChange({ start: range.start, end })}
            pickTime={(_, t) => endAtTime(range.start, t, tz)}
            tz={tz}
            minDate={minDate}
            chips={false}
            className="mb-4"
            action={
              <>
                <SmallButton onClick={() => onChange({ start: range.start, end: Date.now() })}>Now</SmallButton>
                {endOptional && <SmallButton onClick={() => onChange({ start: range.start, end: null })}>Remove</SmallButton>}
              </>
            }
          />
        ))}
      {issue ? (
        <p role="alert" className="text-[15px] font-semibold text-[var(--health)]">
          {issue}
        </p>
      ) : (
        !hideEnd &&
        range.end !== null &&
        range.end > range.start && (
          <p className="text-[15px] text-ink-2">
            {verb} {durationText(range.end - range.start)}
          </p>
        )
      )}
    </div>
  )
}

/**
 * For starting or stopping a timer: Just now, a few minutes ago, or any time on the clock. A
 * picked clock time means the latest time the clock showed it (so after midnight, 11:40 PM is
 * last night).
 */
export function QuickTime({
  label,
  value,
  onChange,
  tz,
  now,
  floor = 0,
  tone = 'brand',
  offsets = [0, 5, 10, 15, 30],
}: {
  label: string
  value: When
  onChange: (w: When) => void
  tz: string
  now: number
  /** Nothing earlier than this can be picked from the chips. */
  floor?: number
  tone?: string
  offsets?: number[]
}) {
  const labelId = useId()
  // The clock opens on the time this screen opened, and stays put while it ticks.
  const [openedAt] = useState(now)
  const picked = 'at' in value ? value.at : null
  return (
    <div role="group" aria-labelledby={labelId} className="mb-5">
      <p id={labelId} className="mb-2 text-[15px] font-semibold text-ink-2">
        {label}
      </p>
      <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
        {offsets.map((m) => {
          const on = 'min' in value && value.min === m
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              disabled={m > 0 && now - m * MIN < floor}
              onClick={() => onChange({ min: m })}
              className={clsx('min-h-11 shrink-0 rounded-full px-4 text-[15px] font-medium disabled:opacity-40', !on && 'bg-card-2 ring-1 ring-line')}
              style={on ? { background: `var(--${tone})`, color: tone === 'brand' ? 'var(--brand-ink)' : '#fff' } : undefined}
            >
              {m === 0 ? 'Just now' : `${m} min ago`}
            </button>
          )
        })}
        <PickerButton
          type="time"
          chip
          pressed={picked !== null}
          tone={tone}
          label={`${label} time`}
          value={localParts(picked ?? openedAt, tz).time}
          display={picked !== null ? whenText(picked, tz, now) : 'Pick a time'}
          icon={<Clock size={18} weight="bold" className="shrink-0" aria-hidden="true" />}
          onPick={(t) => onChange({ at: withTime(Date.now(), t, tz, Date.now()) })}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------- scroll wheels
const ROW = 44
const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1))
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))
const HALVES = ['AM', 'PM']

/** One scrolling column that snaps to an item; the middle row is the chosen one. */
function Wheel({ items, value, onChange, label, wide }: { items: string[]; value: string; onChange: (v: string) => void; label: string; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const timer = useRef<number | null>(null)
  useEffect(() => {
    const i = Math.max(0, items.indexOf(value))
    if (ref.current) ref.current.scrollTop = i * ROW
    // Only when it opens: afterwards the wheel itself is the source of truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const settle = () => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const el = ref.current
      if (!el) return
      const i = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ROW)))
      if (items[i] !== value) onChange(items[i])
    }, 90)
  }
  return (
    <div className={clsx('relative', wide ? 'w-24' : 'w-20')}>
      <div
        ref={ref}
        role="listbox"
        aria-label={label}
        onScroll={settle}
        className="no-scrollbar relative h-[220px] snap-y snap-mandatory overflow-y-scroll overscroll-contain"
        style={{ paddingTop: ROW * 2, paddingBottom: ROW * 2 }}
      >
        {items.map((it, i) => (
          <button
            key={it}
            type="button"
            role="option"
            aria-selected={it === value}
            onClick={() => ref.current?.scrollTo({ top: i * ROW, behavior: 'smooth' })}
            className={clsx('num flex w-full snap-center items-center justify-center text-[24px]', it === value ? 'font-bold text-ink' : 'text-ink-3')}
            style={{ height: ROW }}
          >
            {it}
          </button>
        ))}
      </div>
    </div>
  )
}

function WheelTimeSheet({ title, value, tone, onClose, onPick }: { title: string; value: string; tone?: string; onClose: () => void; onPick: (hhmm: string) => void }) {
  const [h24, m0] = (value || '12:00').split(':').map(Number)
  const [hour, setHour] = useState(String(((h24 + 11) % 12) + 1))
  const [minute, setMinute] = useState(String(m0 || 0).padStart(2, '0'))
  const [half, setHalf] = useState(h24 >= 12 ? 'PM' : 'AM')
  const done = () => {
    const h = (Number(hour) % 12) + (half === 'PM' ? 12 : 0)
    onPick(`${String(h).padStart(2, '0')}:${minute}`)
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title={title.replace(/ time$/, '')}
      tone={tone}
      footer={
        <Button tone={tone && tone !== 'brand' ? tone : undefined} className="w-full" onClick={done}>
          Set {hour}:{minute} {half}
        </Button>
      }
    >
      <div className="relative mx-auto flex w-fit items-center justify-center gap-1 rounded-3xl bg-card-2 px-3 ring-1 ring-line">
        <div className="pointer-events-none absolute inset-x-2 top-1/2 h-11 -translate-y-1/2 rounded-2xl bg-card" aria-hidden="true" />
        <div className="relative flex items-center gap-1">
          <Wheel items={HOURS} value={hour} onChange={setHour} label="Hour" />
          <span className="num text-[24px] font-bold text-ink-2" aria-hidden="true">
            :
          </span>
          <Wheel items={MINUTES} value={minute} onChange={setMinute} label="Minutes" />
          <Wheel items={HALVES} value={half} onChange={setHalf} label="AM or PM" wide />
        </div>
      </div>
      <p className="mt-3 text-center text-[14px] text-ink-2">Scroll each wheel, or tap a number.</p>
    </Sheet>
  )
}

/** A labelled clock time ("HH:MM") picked on the scroll wheels, for settings like the night window. */
export function ClockTimeField({ label, value, onChange }: { label: string; value: string; onChange: (hhmm: string) => void }) {
  const [h, m] = value.split(':').map(Number)
  const shown = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
  return (
    <div className="mb-5">
      <div className="mb-2 text-[15px] font-semibold text-ink-2">{label}</div>
      <PickerButton
        type="time"
        label={label}
        value={value}
        display={shown}
        icon={<Clock size={18} weight="bold" className="shrink-0 text-ink-2" aria-hidden="true" />}
        onPick={onChange}
        className="w-full"
      />
    </div>
  )
}
