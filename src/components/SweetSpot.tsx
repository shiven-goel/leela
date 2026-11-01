import clsx from 'clsx'
import { ArrowCounterClockwise, Bed, CaretRight, MoonStars, Sparkle, SunHorizon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { saveChildSettings } from '../lib/actions'
import { disableReminders, enableReminders, localReminder, pushSupport, savedReminder, sendTestReminder, setReminderLead } from '../lib/push'
import { phase, readSettings, type SleepWindow, type SweetSpot, type SweetSpotSettings } from '../lib/sweetspot'
import { basisText, fmtRange, minutesText, rangeText, sleepName, spanText } from '../lib/sweetspotText'
import { durationText, fmtTime } from '../lib/time'
import type { Child } from '../lib/types'
import { BottleIcon } from './Icon'
import { Sheet } from './Sheet'
import { Button, Choices, Field, Stepper, Toggle } from './ui'

const hours = (h: number) => {
  const whole = Math.floor(h)
  const half = h - whole >= 0.5
  return whole === 0 && half ? '½' : `${whole}${half ? '½' : ''}`
}

// ---------------------------------------------------------------------------- card on Today
export function SweetSpotCard({
  spot,
  child,
  now,
  tz,
  onOpen,
  onLogSleep,
}: {
  spot: SweetSpot
  child: Child
  now: number
  tz: string
  onOpen: () => void
  onLogSleep: () => void
}) {
  const name = child.name

  if (spot.status === 'needs-sleep' || spot.status === 'needs-birthday') {
    const big = spot.status === 'needs-birthday' ? `Add ${name}’s birth date to begin` : `Log ${name}’s last sleep to begin`
    return (
      <section aria-label="Sweet spot" className="mt-3 rounded-[26px] bg-[var(--sleep-soft)] p-4">
        <button type="button" onClick={onOpen} className="block w-full text-left" aria-label={`Sweet spot. ${big}. Open Sweet spot`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Eyebrow icon={<Sparkle size={16} weight="fill" />}>Sweet spot</Eyebrow>
              <p className="mt-1 font-display text-[21px] font-bold leading-tight">{big}</p>
              <p className="mt-1 text-[15px] text-ink-2">
                {spot.status === 'needs-birthday'
                  ? 'Sweet spot uses age to know how long babies usually stay awake. Add it in Family.'
                  : `Leela predicts the best time for ${name}’s next nap and bedtime from when ${name} last woke up.`}
              </p>
            </div>
            <CaretRight size={20} weight="bold" className="mt-1 shrink-0 text-ink-3" aria-hidden="true" />
          </div>
        </button>
        {spot.status === 'needs-sleep' && (
          <Button tone="sleep" size="md" className="mt-3" onClick={onLogSleep}>
            Add the last sleep
          </Button>
        )}
      </section>
    )
  }

  const next = spot.next
  const ph = next ? phase(next, now) : null
  const filled = spot.status === 'ok' && ph === 'now'
  const late = spot.status === 'ok' && ph === 'late'

  let eyebrow = 'Sweet spot'
  let big: React.ReactNode = null
  let line: React.ReactNode = null
  if (spot.status === 'ok' && next) {
    const what = next.kind === 'bedtime' ? 'bedtime' : 'nap'
    eyebrow = next.kind === 'bedtime' ? 'Sweet spot · Bedtime' : `Sweet spot · Next nap`
    if (ph === 'soon') {
      big = fmtRange(next.start, next.end, tz)
      const wait = next.start - now
      line = `in ${spanText(wait)}${wait <= 30 * 60_000 ? ', start winding down' : ''}`
    } else if (ph === 'now') {
      big = `Good time for ${what === 'bedtime' ? 'bed' : 'a nap'}`
      line = `Sweet spot until ${fmtTime(next.end, tz)}`
    } else {
      big = 'A little past the sweet spot'
      line = `It was ${fmtRange(next.start, next.end, tz)}. Settle ${name} when you can.`
    }
  } else if (spot.status === 'napping') {
    eyebrow = 'Sweet spot · Napping'
    big = spot.wakeAround ? `Likely up around ${fmtTime(spot.wakeAround, tz)}` : 'Napping'
    line = spot.napExpectMin ? `This nap usually lasts about ${minutesText(spot.napExpectMin)}` : null
  } else if (spot.status === 'night') {
    eyebrow = spot.asleepSince ? 'Sweet spot · Night' : 'Sweet spot · Night waking'
    big = spot.asleepSince ? `Usually up around ${spot.wakeAround ? fmtTime(spot.wakeAround, tz) : 'morning'}` : 'Back to sleep when ready'
    line = spot.asleepSince
      ? `Asleep since ${fmtTime(spot.asleepSince, tz)}. Naps are predicted after the morning wake-up.`
      : `Usually up for the day around ${spot.wakeAround ? fmtTime(spot.wakeAround, tz) : 'morning'}`
  } else if (spot.status === 'newborn') {
    eyebrow = 'Sweet spot · Newborn guide'
    big = next ? `Sleepy again by ${fmtRange(next.start, next.end, tz)}` : 'Newborns sleep in short stretches'
    line = `Newborns can usually stay awake ${spot.guide.wake[0]}–${spot.guide.wake[1]} minutes. Full predictions start at 8 weeks.`
  }

  const later = spot.later
  const label = [eyebrow, typeof big === 'string' ? big : '', typeof line === 'string' ? line : ''].filter(Boolean).join('. ')

  return (
    <section aria-label="Sweet spot" className="mt-3">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${label}. Open Sweet spot`}
        className={clsx('block w-full rounded-[26px] p-4 text-left active:scale-[0.99]', filled && 'text-white')}
        style={{ background: filled ? 'var(--sleep)' : late ? 'var(--feed-soft)' : 'var(--sleep-soft)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Eyebrow icon={<Sparkle size={16} weight="fill" />} color={filled ? '#fff' : late ? 'var(--feed)' : 'var(--sleep)'}>
              {eyebrow}
            </Eyebrow>
            <p className="num mt-0.5 font-display text-[26px] font-extrabold leading-tight">{big}</p>
            {line && <p className={clsx('text-[15px] leading-snug', filled ? 'text-white/90' : 'text-ink-2')}>{line}</p>}
          </div>
          <CaretRight size={20} weight="bold" className={clsx('mt-1 shrink-0', filled ? 'text-white/80' : 'text-ink-3')} aria-hidden="true" />
        </div>

        {spot.status === 'ok' && next && spot.awakeSince && <Meter from={spot.awakeSince} w={next} now={now} filled={filled} late={late} />}

        {(later.length > 0 || spot.feed) && (
          <div className={clsx('mt-3 space-y-1 border-t pt-3 text-[15px]', filled ? 'border-white/25' : 'border-line')}>
            {later.length > 0 && (
              <p className="flex items-center gap-2">
                <MoonStars size={18} weight="fill" aria-hidden="true" className={filled ? 'text-white/80' : 'text-[var(--sleep)]'} />
                <span className="min-w-0">
                  {later.map((w, i) => (
                    <span key={i}>
                      {i > 0 && ' · '}
                      <span className="whitespace-nowrap">
                        {i === 0 && (spot.status === 'napping' ? 'After that, ' : 'Then ')}
                        {w.kind === 'bedtime' ? 'bed' : w.short ? 'short nap' : `nap ${w.napNumber}`} ~{fmtTime(w.center, tz)}
                      </span>
                    </span>
                  ))}
                </span>
              </p>
            )}
            {spot.feed && (
              <p className="flex items-center gap-2">
                <BottleIcon size={18} className={filled ? 'text-white/80' : 'text-[var(--feed)]'} />
                <span className="min-w-0">
                  {spot.feed.at <= now ? 'Next feed due now' : `Next feed ~${fmtTime(spot.feed.at, tz)}`}
                  <span className={filled ? 'text-white/80' : 'text-ink-2'}> · every ~{minutesText(spot.feed.everyMin)}</span>
                </span>
              </p>
            )}
          </div>
        )}
        <p className={clsx('mt-2 text-[13px]', filled ? 'text-white/80' : 'text-ink-3')}>
          {basisText(spot, name)}
          {localReminder() !== null && ` · reminder ${localReminder()} min before`}
        </p>
      </button>
    </section>
  )
}

function Eyebrow({ children, icon, color = 'var(--sleep)' }: { children: React.ReactNode; icon: React.ReactNode; color?: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[13px] font-bold tracking-wide uppercase" style={{ color }}>
      <span aria-hidden="true">{icon}</span>
      {children}
    </p>
  )
}

/** Time awake so far against the sweet spot window. */
function Meter({ from, w, now, filled, late }: { from: number; w: SleepWindow; now: number; filled: boolean; late: boolean }) {
  const end = Math.max(w.end + (w.end - from) * 0.12, now + 5 * 60_000)
  const pct = (t: number) => `${Math.max(0, Math.min(100, ((t - from) / (end - from)) * 100))}%`
  const track = filled ? 'rgba(255,255,255,0.25)' : 'var(--card)'
  const tone = filled ? '#fff' : late ? 'var(--feed)' : 'var(--sleep)'
  return (
    <div className="relative mt-3 h-3 rounded-full" style={{ background: track }} aria-hidden="true">
      <div className="absolute inset-y-0 rounded-full opacity-35" style={{ left: pct(w.start), width: `calc(${pct(w.end)} - ${pct(w.start)})`, background: tone }} />
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(now), background: tone, opacity: 0.85 }} />
      <div className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px]" style={{ left: pct(now), background: filled ? 'var(--sleep)' : 'var(--card)', borderColor: tone }} />
    </div>
  )
}

// ---------------------------------------------------------------------------- details and settings
export function SweetSpotSheet({ open, onClose, spot, child, now, tz }: { open: boolean; onClose: () => void; spot: SweetSpot; child: Child; now: number; tz: string }) {
  const name = child.name
  const [draft, setDraft] = useState<SweetSpotSettings>(() => readSettings(child.settings))
  const saved = useRef(JSON.stringify(readSettings(child.settings)))
  const pending = useRef<number | null>(null)

  // Fresh from the baby's settings each time the sheet opens (someone else may have changed them).
  useEffect(() => {
    if (open) {
      const s = readSettings(child.settings)
      setDraft(s)
      saved.current = JSON.stringify(s)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, child.id])

  const flush = (next: SweetSpotSettings) => {
    if (pending.current) window.clearTimeout(pending.current)
    pending.current = null
    const json = JSON.stringify(next)
    if (json === saved.current) return
    saved.current = json
    void saveChildSettings(child.id, 'sweetspot', next)
  }
  const change = (patch: Partial<SweetSpotSettings>) => {
    const next = { ...draft, ...patch }
    for (const k of Object.keys(next) as (keyof SweetSpotSettings)[]) if (next[k] === undefined) delete next[k]
    setDraft(next)
    if (pending.current) window.clearTimeout(pending.current)
    pending.current = window.setTimeout(() => flush(next), 500)
  }
  const close = () => {
    flush(draft)
    onClose()
  }

  const p = spot.pattern
  const plan: SleepWindow[] = [...(spot.next ? [spot.next] : []), ...spot.later]
  const g = spot.guide
  const napsWord = (n: number) => `${n} ${n === 1 ? 'nap' : 'naps'}`

  return (
    <Sheet open={open} onClose={close} title="Sweet spot" tone="sleep">
      {/* ------------------------------------------------ today */}
      <h3 className="mb-2 text-[15px] font-semibold text-ink-2">Rest of today</h3>
      <ul className="mb-2 divide-y divide-line overflow-hidden rounded-2xl bg-card-2 ring-1 ring-line">
        {spot.status === 'napping' && spot.wakeAround && (
          <PlanRow icon={<SunHorizon size={20} weight="fill" />} title="Likely awake" time={`~${fmtTime(spot.wakeAround, tz)}`} />
        )}
        {spot.status === 'night' && spot.wakeAround && (
          <PlanRow icon={<SunHorizon size={20} weight="fill" />} title="Up for the day" time={`~${fmtTime(spot.wakeAround, tz)}`} />
        )}
        {plan.map((w, i) => (
          <PlanRow
            key={i}
            icon={w.kind === 'bedtime' ? <Bed size={20} weight="fill" /> : <MoonStars size={20} weight="fill" />}
            title={w.short ? `${sleepName(w)}, a short one` : sleepName(w)}
            time={i === 0 && spot.status === 'ok' ? fmtRange(w.start, w.end, tz) : `~${fmtTime(w.center, tz)}`}
            detail={w.lengthMin ? `about ${minutesText(w.lengthMin)}` : undefined}
            highlight={i === 0 && spot.status === 'ok' && phase(w, now) === 'now'}
          />
        ))}
        {spot.feed && (
          <PlanRow
            icon={<BottleIcon size={20} />}
            tone="feed"
            title="Next feed"
            time={spot.feed.at <= now ? 'due now' : `~${fmtTime(spot.feed.at, tz)}`}
            detail={`${spot.feed.basis === 'logs' ? 'lately' : 'typically'} every ${minutesText(spot.feed.everyMin)}`}
          />
        )}
        {!plan.length && !spot.feed && spot.status !== 'napping' && spot.status !== 'night' && (
          <li className="px-4 py-3 text-[15px] text-ink-2">Log {name}’s sleeps and Leela will plan the day here.</li>
        )}
      </ul>
      {spot.status !== 'newborn' && g.daySleep[1] > 0 && (
        <p className="mb-6 text-[14px] text-ink-2">
          Daytime sleep so far: <strong className="font-semibold text-ink">{durationText(spot.daySleepMs)}</strong>. Usual at {g.label}: {hours(g.daySleep[0])}–{hours(g.daySleep[1])} hours.
        </p>
      )}

      <Reminders name={name} />

      {/* ------------------------------------------------ how it works */}
      <h3 className="mb-2 text-[15px] font-semibold text-ink-2">How it works</h3>
      <div className="mb-6 space-y-2 text-[15px] leading-relaxed">
        <p>
          At {g.label}, most babies are ready to sleep again {rangeText(g.wake[0], g.wake[1])} after waking, with {g.naps[0] === g.naps[1] ? napsWord(g.naps[0]) : `${g.naps[0]}–${g.naps[1]} naps`} a day. The window before bed is usually the longest.
        </p>
        <p>
          Once about five days of sleep are logged, Leela leans towards {name}’s own rhythm, staying within the normal range for that age. Everyone in the family sees the same prediction.
        </p>
        <p>
          It’s a guide, like a weather forecast. Watch for sleepy cues too: yawning, rubbing eyes, staring away. Start winding down about 30 minutes before the window.
        </p>
      </div>

      {p.days > 0 && (
        <>
          <h3 className="mb-2 text-[15px] font-semibold text-ink-2">
            {name} lately <span className="font-normal">({Math.min(7, p.days)} {p.days === 1 ? 'day' : 'days'} of sleep logged this week)</span>
          </h3>
          <dl className="mb-6 grid grid-cols-2 gap-2">
            {p.first !== undefined && <Fact label="Up before first nap" value={minutesText(p.first)} />}
            {p.middle !== undefined && <Fact label="Up between naps" value={minutesText(p.middle)} />}
            {p.last !== undefined && <Fact label="Up before bed" value={minutesText(p.last)} />}
            {p.napMin !== undefined && <Fact label="Naps last" value={`about ${minutesText(p.napMin)}`} />}
            {p.naps !== undefined && <Fact label="Naps a day" value={String(p.naps)} />}
            {p.bedtimeMin !== undefined && <Fact label="Bedtime" value={clockOf(p.bedtimeMin)} />}
            {p.wakeMin !== undefined && <Fact label="Up for the day" value={clockOf(p.wakeMin)} />}
            {p.daySleepMin !== undefined && <Fact label="Daytime sleep" value={minutesText(p.daySleepMin)} />}
          </dl>
          {spot.basis === 'logs' && [p.first, p.middle, p.last].some((m) => m !== undefined && (m < g.wake[0] * 0.85 || m > g.wake[1] * 1.15)) && (
            <p className="-mt-3 mb-6 rounded-2xl bg-[var(--feed-soft)] px-4 py-3 text-[14px] leading-snug">
              Some of {name}’s wake windows are outside the usual {rangeText(g.wake[0], g.wake[1])} for {g.label}, so Leela keeps its predictions within that range. To follow {name}’s own times, set a bedtime or your own wake windows below.
            </p>
          )}
        </>
      )}

      {/* ------------------------------------------------ settings */}
      <h3 className="mb-1 text-[15px] font-semibold text-ink-2">Adjust for {name}</h3>
      <p className="mb-4 text-[14px] text-ink-3">Changes here are shared with everyone in the family.</p>
      <Field label="Naps a day">
        <Choices
          options={[
            { id: 'auto', label: 'Auto' },
            { id: '1', label: '1' },
            { id: '2', label: '2' },
            { id: '3', label: '3' },
            { id: '4', label: '4' },
            { id: '5', label: '5' },
          ]}
          value={draft.naps === undefined ? 'auto' : String(draft.naps)}
          onChange={(v) => change({ naps: !v || v === 'auto' ? undefined : Number(v) })}
          tone="sleep"
          columns={6}
        />
      </Field>
      <Field label="Bedtime">
        <div className="flex items-center gap-2">
          <Choices
            options={[
              { id: 'auto', label: 'From logs' },
              { id: 'set', label: 'Set a time' },
            ]}
            value={draft.bedtime ? 'set' : 'auto'}
            onChange={(v) => change({ bedtime: v === 'set' ? draft.bedtime ?? '19:00' : undefined })}
            tone="sleep"
            columns={2}
          />
        </div>
        {draft.bedtime && (
          <input
            type="time"
            aria-label="Bedtime"
            value={draft.bedtime}
            onChange={(e) => /^\d{2}:\d{2}$/.test(e.target.value) && change({ bedtime: e.target.value })}
            className="mt-2 h-13 w-full rounded-2xl border border-line bg-card-2 px-4 text-[17px] outline-none focus:border-brand"
          />
        )}
      </Field>
      <Field label="Wake windows" hint={draft.adjust ? `Every wake window is ${Math.abs(draft.adjust)} min ${draft.adjust > 0 ? 'longer' : 'shorter'} than predicted.` : 'Make every wake window a little longer or shorter, in minutes.'}>
        <Stepper label="wake window change" unit="min" step={5} min={-60} max={60} value={draft.adjust ?? 0} onChange={(v) => change({ adjust: v ? v : undefined })} />
      </Field>
      <div className="mb-5">
        <Toggle
          label="Use our own wake windows"
          tone="sleep"
          checked={Boolean(draft.custom)}
          onChange={(on) => change({ custom: on ? { first: spot.windows.first, middle: spot.windows.middle, last: spot.windows.last } : undefined })}
        />
        {draft.custom && (
          <div className="mt-4 space-y-4">
            {(
              [
                ['first', 'Before the first nap'],
                ['middle', 'Between naps'],
                ['last', 'Before bed'],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} label={label}>
                <Stepper
                  label={label.toLowerCase()}
                  unit="min"
                  step={5}
                  min={15}
                  max={600}
                  value={draft.custom![k]}
                  onChange={(v) => change({ custom: { ...draft.custom!, [k]: v ?? draft.custom![k] } })}
                />
              </Field>
            ))}
          </div>
        )}
      </div>
      {Object.keys(draft).length > 0 && (
        <Button variant="secondary" size="md" className="mb-4 w-full" onClick={() => change({ naps: undefined, bedtime: undefined, adjust: undefined, custom: undefined })}>
          <ArrowCounterClockwise size={18} weight="bold" aria-hidden="true" /> Back to automatic
        </Button>
      )}
    </Sheet>
  )
}

const clockOf = (minute: number) => {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440
  const h = Math.floor(m / 60)
  return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

function PlanRow({ icon, title, time, detail, highlight, tone = 'sleep' }: { icon: React.ReactNode; title: string; time: string; detail?: string; highlight?: boolean; tone?: string }) {
  return (
    <li className={clsx('flex items-center gap-3 px-4 py-3', highlight && 'bg-[var(--sleep-soft)]')}>
      <span className="shrink-0" style={{ color: `var(--${tone})` }} aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold">{title}</span>
        {detail && <span className="block text-[13px] text-ink-2">{detail}</span>}
      </span>
      <span className="num shrink-0 text-[16px] font-semibold">{time}</span>
    </li>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-card-2 px-3 py-2.5 ring-1 ring-line">
      <dt className="text-[13px] text-ink-2">{label}</dt>
      <dd className="num text-[18px] font-bold">{value}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------- reminders
const SUPPORT_TEXT = {
  'ios-install': 'On iPhone and iPad, notifications work once Leela is on your Home Screen: tap Share, then Add to Home Screen, and open Leela from there.',
  unsupported: 'This browser can’t show notifications. Chrome, Edge, Firefox or Leela on an iPhone Home Screen can.',
  denied: 'Notifications are blocked for Leela. Allow them in the browser’s site settings (or the phone’s Settings › Notifications), then choose a time again.',
} as const

/** Per person, per phone: a notification some minutes before each nap and bedtime sweet spot. */
function Reminders({ name }: { name: string }) {
  const [support, setSupport] = useState(pushSupport)
  const [lead, setLead] = useState<number | null>(localReminder)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void savedReminder().then((l) => alive && setLead(l))
    return () => {
      alive = false
    }
  }, [])

  const choose = async (v: string | undefined) => {
    const next = !v || v === 'off' ? null : Number(v)
    if (next === lead || busy) return
    setBusy(true)
    setNote(null)
    if (next === null) {
      await disableReminders()
      setLead(null)
    } else if (lead === null) {
      const r = await enableReminders(next)
      setSupport(pushSupport())
      if (r.ok) {
        setLead(next)
        setNote('Reminders are on for this phone.')
      } else if (r.reason === 'failed') setNote(`Couldn’t turn reminders on${r.detail ? `: ${r.detail}` : ''}.`)
    } else if (await setReminderLead(next)) setLead(next)
    else setNote('Couldn’t change it. Check the connection and try again.')
    setBusy(false)
  }
  const test = async () => {
    setBusy(true)
    setNote((await sendTestReminder()) ? 'Sent. It should arrive in a few seconds.' : 'Couldn’t send a test. Try turning reminders off and on again.')
    setBusy(false)
  }

  return (
    <section className="mb-6" aria-labelledby="remind-h">
      <h3 id="remind-h" className="mb-2 text-[15px] font-semibold text-ink-2">
        Remind me on this phone
      </h3>
      <Choices
        options={[
          { id: 'off', label: 'Off' },
          { id: '5', label: '5 min' },
          { id: '10', label: '10 min' },
          { id: '15', label: '15 min' },
          { id: '30', label: '30 min' },
        ]}
        value={lead === null ? 'off' : String(lead)}
        onChange={(v) => void choose(v)}
        tone="sleep"
        columns={5}
      />
      <p className="mt-2 text-[14px] text-ink-2">
        {lead === null
          ? `A notification before ${name}’s nap and bedtime sweet spots, even when Leela is closed. Everyone turns it on on their own phone.`
          : `On: ${lead} minutes before each nap and bedtime sweet spot, for every baby in the family.`}
      </p>
      {support !== 'ok' && <p className="mt-2 rounded-2xl bg-[var(--feed-soft)] px-4 py-3 text-[14px] leading-snug">{SUPPORT_TEXT[support]}</p>}
      {lead !== null && (
        <Button variant="secondary" size="md" className="mt-3" onClick={() => void test()} disabled={busy}>
          Send a test notification
        </Button>
      )}
      {note && (
        <p className="mt-2 text-[14px] font-semibold" role="status">
          {note}
        </p>
      )}
    </section>
  )
}
