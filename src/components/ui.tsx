import clsx from 'clsx'
import { Minus, Plus } from '@phosphor-icons/react'
import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, useId } from 'react'

export function Button({
  variant = 'primary',
  size = 'lg',
  className,
  tone,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'lg' | 'md' | 'sm'
  tone?: string
}) {
  const toneStyle = tone && variant === 'primary' ? { background: `var(--${tone})`, color: '#fff' } : undefined
  return (
    <button
      type="button"
      {...rest}
      style={{ ...toneStyle, ...rest.style }}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition-[transform,opacity] active:scale-[0.98] disabled:opacity-45 disabled:active:scale-100',
        size === 'lg' && 'h-14 px-6 text-[17px]',
        size === 'md' && 'h-11 px-4 text-[15px]',
        size === 'sm' && 'h-9 px-3 text-sm',
        variant === 'primary' && !tone && 'bg-brand text-brand-ink',
        variant === 'secondary' && 'bg-card-2 text-ink ring-1 ring-line',
        variant === 'ghost' && 'text-ink-2',
        variant === 'danger' && 'bg-[var(--health-soft)] text-[var(--health)]',
        className,
      )}
    />
  )
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-2 block text-[15px] font-semibold text-ink-2">
      {children}
    </label>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-5">
      <div className="mb-2 text-[15px] font-semibold text-ink-2">{label}</div>
      {children}
      {hint && <p className="mt-1.5 text-sm text-ink-3">{hint}</p>}
    </div>
  )
}

export function TextInput({ label, hint, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string }) {
  const id = useId()
  return (
    <div className={clsx('mb-5', className)}>
      {label && <Label htmlFor={id}>{label}</Label>}
      <input
        id={id}
        {...rest}
        className="h-13 w-full rounded-2xl border border-line bg-card-2 px-4 text-[17px] outline-none transition-colors placeholder:text-ink-3 focus:border-brand"
      />
      {hint && <p className="mt-1.5 text-sm text-ink-3">{hint}</p>}
    </div>
  )
}

export function TextArea({ label, value, onChange, placeholder, rows = 3 }: { label?: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  const id = useId()
  return (
    <div className="mb-5">
      {label && <Label htmlFor={id}>{label}</Label>}
      <textarea
        id={id}
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-none rounded-2xl border border-line bg-card-2 px-4 py-3 text-[17px] outline-none placeholder:text-ink-3 focus:border-brand"
      />
    </div>
  )
}

/** A row of large tappable choices; the chosen one fills with the entry's colour. */
export function Choices<T extends string>({
  options,
  value,
  onChange,
  tone = 'brand',
  columns,
  allowNone,
  compact,
}: {
  options: readonly { id: T; label: string; icon?: ReactNode }[]
  value: T | undefined | null
  onChange: (v: T | undefined) => void
  tone?: string
  columns?: number
  allowNone?: boolean
  /** Tighter padding, for rows of many short options. */
  compact?: boolean
}) {
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${columns ?? Math.min(options.length, 3)}, minmax(0, 1fr))` }}
      role="radiogroup"
    >
      {options.map((o) => {
        const on = value === o.id
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(on && allowNone ? undefined : o.id)}
            className={clsx(
              'flex min-h-12 items-center justify-center gap-1.5 rounded-2xl py-2 text-center text-[15px] font-semibold leading-tight transition-colors',
              compact ? 'px-1 whitespace-nowrap' : 'px-3',
              !on && 'bg-card-2 text-ink ring-1 ring-line',
            )}
            style={on ? { background: `var(--${tone})`, color: tone === 'brand' ? 'var(--brand-ink)' : '#fff' } : undefined}
          >
            {o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Pill chips that toggle on and off independently. */
export function MultiChips({
  options,
  values,
  onChange,
  tone = 'brand',
}: {
  options: readonly string[]
  values: string[]
  onChange: (v: string[]) => void
  tone?: string
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = values.includes(o)
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? values.filter((v) => v !== o) : [...values, o])}
            className={clsx('min-h-10 rounded-full px-4 text-[15px] font-medium', !on && 'bg-card-2 ring-1 ring-line')}
            style={on ? { background: `var(--${tone})`, color: tone === 'brand' ? 'var(--brand-ink)' : '#fff' } : undefined}
          >
            {o}
          </button>
        )
      })}
    </div>
  )
}

/** Big plus/minus number control, typed or tapped. */
export function Stepper({
  value,
  onChange,
  step,
  min = 0,
  max = 9999,
  unit,
  decimals = 0,
  label,
}: {
  value: number | undefined
  onChange: (v: number | undefined) => void
  step: number
  min?: number
  max?: number
  unit: string
  decimals?: number
  label: string
}) {
  const id = useId()
  const clamp = (n: number) => Math.min(max, Math.max(min, Number(n.toFixed(decimals))))
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        aria-label={`Less ${label}`}
        onClick={() => onChange(clamp((value ?? 0) - step))}
        className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-card-2 ring-1 ring-line active:scale-95"
      >
        <Minus size={22} weight="bold" />
      </button>
      <div className="flex min-w-0 flex-1 items-baseline justify-center gap-1.5 rounded-2xl bg-card-2 px-3 py-2 ring-1 ring-line focus-within:ring-brand">
        <input
          id={id}
          aria-label={label}
          inputMode="decimal"
          value={value ?? ''}
          placeholder="0"
          onChange={(e) => {
            const raw = e.target.value.replace(',', '.')
            if (raw === '') return onChange(undefined)
            const n = Number(raw)
            if (!Number.isNaN(n)) onChange(Math.min(max, n))
          }}
          className="num w-full min-w-0 bg-transparent text-center text-[34px] font-bold leading-none outline-none"
        />
        <span className="shrink-0 text-lg font-semibold text-ink-2">{unit}</span>
      </div>
      <button
        type="button"
        aria-label={`More ${label}`}
        onClick={() => onChange(clamp((value ?? 0) + step))}
        className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-card-2 ring-1 ring-line active:scale-95"
      >
        <Plus size={22} weight="bold" />
      </button>
    </div>
  )
}

export function Toggle({ label, checked, onChange, tone = 'brand' }: { label: string; checked: boolean; onChange: (v: boolean) => void; tone?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-12 w-full items-center justify-between rounded-2xl bg-card-2 px-4 text-left text-[16px] font-medium ring-1 ring-line"
    >
      {label}
      <span
        className="relative h-7 w-12 rounded-full transition-colors"
        style={{ background: checked ? `var(--${tone})` : 'var(--line)' }}
        aria-hidden="true"
      >
        <span className={clsx('absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left]', checked ? 'left-6' : 'left-1')} />
      </span>
    </button>
  )
}
