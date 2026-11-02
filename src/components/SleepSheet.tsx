import { MoonStars, PencilSimple, Plus, SunHorizon, Trash } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { useNow } from '../hooks/useNow'
import { deleteEvent, startTimer, stopTimer } from '../lib/actions'
import { displayName, useLeela } from '../lib/store'
import { phase, type SweetSpot } from '../lib/sweetspot'
import { fmtRange, spanText } from '../lib/sweetspotText'
import { clockText, fmtTime } from '../lib/time'
import type { Child, LeelaEvent } from '../lib/types'
import { Sheet } from './Sheet'
import { type When, whenAt, whenIsNow, whenText } from '../lib/timerange'
import { QuickTime } from './TimeField'
import { Button } from './ui'

const MIN = 60_000

/**
 * What tapping Sleep opens. Nothing is saved until Start sleep (or End sleep) is pressed,
 * so a stray tap while scrolling never starts or stops a timer.
 */
export function SleepSheet({
  open,
  onClose,
  child,
  running,
  spot,
  onPastSleep,
  onEdit,
}: {
  open: boolean
  onClose: () => void
  child: Child
  running: LeelaEvent | undefined
  spot: SweetSpot
  onPastSleep: () => void
  onEdit: (e: LeelaEvent) => void
}) {
  const now = useNow(1000)
  const family = useLeela((s) => s.family)
  const userId = useLeela((s) => s.userId)
  useLeela((s) => s.profiles)
  const tz = family?.timezone ?? 'UTC'
  const [when, setWhen] = useState<When>({ min: 0 })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setWhen({ min: 0 })
      setBusy(false)
    }
  }, [open, running?.id])

  const name = child.name
  const isNow = whenIsNow(when)
  const at = whenAt(when, now)
  // A sleep can't end before it started, or start before the last one ended.
  const started = running ? Date.parse(running.started_at) : 0
  const floor = running ? started + MIN : (spot.awakeSince ?? 0)
  const tooEarly = !isNow && at < floor
  const atText = whenText(at, tz, now)

  const start = async () => {
    if (busy || tooEarly) return
    setBusy(true)
    await startTimer('sleep', child.id, { startedAt: isNow ? undefined : new Date(at).toISOString() })
    useLeela.getState().toast({ text: `Sleep timer started for ${name}.` })
    onClose()
  }
  const end = async () => {
    if (!running || busy || tooEarly) return
    setBusy(true)
    await stopTimer(running.id, new Date(isNow ? Date.now() : at).toISOString())
    onClose()
  }
  const remove = async () => {
    if (!running || busy) return
    setBusy(true)
    await deleteEvent(running.id)
    onClose()
  }

  const next = spot.next
  const hint = (() => {
    if (running) {
      if (spot.status === 'napping' && spot.wakeAround) return `${name} may wake around ${fmtTime(spot.wakeAround, tz)}, going by usual nap lengths.`
      if (spot.status === 'night' && spot.wakeAround) return `${name} is usually up for the day around ${fmtTime(spot.wakeAround, tz)}.`
      return null
    }
    if (spot.status === 'ok' && next) {
      const what = next.kind === 'bedtime' ? 'bedtime' : `nap ${next.napNumber}`
      const ph = phase(next, now)
      if (ph === 'soon') return `Sweet spot for ${what}: ${fmtRange(next.start, next.end, tz)}, in ${spanText(next.start - now)}.`
      if (ph === 'now') return `${name} is in the sweet spot for ${what} now, until ${fmtTime(next.end, tz)}.`
      return `A little past the sweet spot for ${what} (${fmtRange(next.start, next.end, tz)}).`
    }
    if (spot.status === 'newborn' && next) return `Newborns are usually sleepy again ${spot.guide.wake[0]}–${spot.guide.wake[1]} minutes after waking: by ${fmtRange(next.start, next.end, tz)}.`
    return null
  })()

  const by = running ? (running.created_by === userId ? 'you' : displayName(running.created_by)) : ''

  return (
    <Sheet open={open} onClose={onClose} title="Sleep" tone="sleep">
      {running ? (
        <div className="mb-5 rounded-[22px] bg-[var(--sleep-soft)] p-4">
          <p className="text-[15px] font-semibold text-[var(--sleep)]">{name} is asleep</p>
          <p className="num font-display text-[44px] font-extrabold leading-none">{clockText(now - started)}</p>
          <p className="mt-1 text-[14px] text-ink-2">
            Fell asleep {fmtTime(started, tz)}, started by {by}
          </p>
        </div>
      ) : null}

      {hint && (
        <p className="mb-5 rounded-2xl bg-card-2 px-4 py-3 text-[15px] leading-snug ring-1 ring-line" role="note">
          {hint}
        </p>
      )}

      <QuickTime label={running ? 'Woke up' : 'Fell asleep'} value={when} onChange={setWhen} tz={tz} now={now} floor={floor} tone="sleep" />
      {tooEarly && (
        <p role="alert" className="-mt-2 mb-4 text-[15px] font-semibold text-[var(--health)]">
          {running
            ? `That’s before ${name} fell asleep (${fmtTime(started, tz)}).`
            : `That’s before ${name} last woke up (${fmtTime(floor, tz)}).`}
        </p>
      )}

      {running ? (
        <>
          <Button tone="sleep" className="h-16 w-full text-[19px]" onClick={() => void end()} disabled={busy || tooEarly}>
            <SunHorizon size={24} weight="fill" aria-hidden="true" />
            {isNow ? 'End sleep' : `End sleep at ${atText}`}
          </Button>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="secondary" size="md" onClick={() => onEdit(running)}>
              <PencilSimple size={18} weight="bold" aria-hidden="true" /> Edit details
            </Button>
            <Button variant="danger" size="md" onClick={() => void remove()} disabled={busy}>
              <Trash size={18} weight="bold" aria-hidden="true" /> Started by mistake
            </Button>
          </div>
        </>
      ) : (
        <>
          <Button tone="sleep" className="h-16 w-full text-[19px]" onClick={() => void start()} disabled={busy || tooEarly}>
            <MoonStars size={24} weight="fill" aria-hidden="true" />
            {isNow ? 'Start sleep' : `Start sleep from ${atText}`}
          </Button>
          <p className="mt-2 text-center text-[13px] text-ink-3">Starts a timer that everyone in the family sees.</p>
          <div className="my-5 flex items-center gap-3 text-[13px] text-ink-3" aria-hidden="true">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
          <Button variant="secondary" className="mb-2 w-full" onClick={onPastSleep}>
            <Plus size={20} weight="bold" aria-hidden="true" /> Add a past sleep
          </Button>
        </>
      )}
    </Sheet>
  )
}
