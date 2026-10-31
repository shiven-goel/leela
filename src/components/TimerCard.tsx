import clsx from 'clsx'
import { Pause, Play, Stop } from '@phosphor-icons/react'
import { nursingPause, nursingSwitch, stopTimer } from '../lib/actions'
import { TYPES, toneSoft, toneVar } from '../lib/config'
import { nursingSeconds } from '../lib/counting'
import { eventTitle } from '../lib/describe'
import { displayName, useLeela } from '../lib/store'
import { clockText, fmtTime } from '../lib/time'
import type { LeelaEvent, Side } from '../lib/types'
import { useNow } from '../hooks/useNow'
import { TypeIcon } from './Icon'

/** A live timer shared by the whole family: every phone shows the same time and anyone can stop it. */
export function TimerCard({ event, onOpen }: { event: LeelaEvent; onOpen: (e: LeelaEvent) => void }) {
  const now = useNow(1000)
  const family = useLeela((s) => s.family)
  const segments = useLeela((s) => s.segments)
  const userId = useLeela((s) => s.userId)
  const meta = TYPES[event.type]
  const tz = family?.timezone ?? 'UTC'
  const started = Date.parse(event.started_at)
  const by = event.created_by === userId ? 'you' : displayName(event.created_by)

  const isNursing = event.type === 'nursing'
  const secs = isNursing ? nursingSeconds(event, Object.values(segments), now) : null
  const side = (event.data.last_side as Side | undefined) ?? 'left'
  const paused = event.timer_state === 'paused'
  const elapsed = isNursing && secs ? (secs.left + secs.right) * 1000 : now - started

  const title =
    event.type === 'sleep' ? 'Asleep' : event.type === 'nursing' ? (paused ? 'Feed paused' : 'Breastfeeding') : eventTitle(event, family)

  return (
    <section
      className="relative overflow-hidden rounded-[26px] p-4"
      style={{ background: toneSoft(meta.tone) }}
      aria-label={`${title}, ${clockText(elapsed)}`}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onOpen(event)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-label={`Edit ${title.toLowerCase()}`}
        >
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-card" style={{ color: toneVar(meta.tone) }}>
            <TypeIcon type={event.type} kind={typeof event.data.kind === 'string' ? event.data.kind : undefined} size={26} />
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold" style={{ color: toneVar(meta.tone) }}>
              {title}
            </span>
            <span className="num block text-[40px] font-extrabold leading-[0.95]" aria-live="off">
              {clockText(elapsed)}
            </span>
            <span className="block truncate text-[13px] text-ink-2">
              Started {fmtTime(started, tz)} by {by}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => void stopTimer(event.id)}
          className="grid h-16 w-16 shrink-0 place-items-center rounded-[22px] text-white active:scale-95"
          style={{ background: toneVar(meta.tone) }}
          aria-label={`Stop ${title.toLowerCase()}`}
        >
          <Stop size={28} weight="fill" />
        </button>
      </div>

      {isNursing && secs && (
        <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
          {(['left', 'right'] as const).map((s) => {
            const on = !paused && side === s
            return (
              <button
                key={s}
                type="button"
                onClick={() => void nursingSwitch(event.id, s)}
                aria-pressed={on}
                className={clsx('flex h-14 flex-col items-center justify-center rounded-2xl', !on && 'bg-card')}
                style={on ? { background: toneVar(meta.tone), color: '#fff' } : undefined}
              >
                <span className="text-[13px] font-semibold capitalize">{s}</span>
                <span className="num text-[19px] font-bold leading-none">{clockText((s === 'left' ? secs.left : secs.right) * 1000)}</span>
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => (paused ? void nursingSwitch(event.id, side) : void nursingPause(event.id))}
            className="grid h-14 w-14 place-items-center rounded-2xl bg-card"
            aria-label={paused ? 'Resume feed' : 'Pause feed'}
          >
            {paused ? <Play size={24} weight="fill" /> : <Pause size={24} weight="fill" />}
          </button>
        </div>
      )}
    </section>
  )
}
