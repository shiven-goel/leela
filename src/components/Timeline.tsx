import { TYPES, toneSoft, toneVar } from '../lib/config'
import { eventDetail, eventTitle } from '../lib/describe'
import { displayName, myPrefs, useLeela } from '../lib/store'
import { fmtTime } from '../lib/time'
import type { LeelaEvent } from '../lib/types'
import { TypeIcon } from './Icon'

export function Timeline({
  events,
  now,
  onSelect,
  empty,
}: {
  events: LeelaEvent[]
  now: number
  onSelect: (e: LeelaEvent) => void
  empty?: string
}) {
  const family = useLeela((s) => s.family)
  const segments = useLeela((s) => s.segments)
  const userId = useLeela((s) => s.userId)
  // Subscribed so a renamed family member shows up straight away.
  useLeela((s) => s.profiles)
  const prefs = myPrefs()
  const segs = Object.values(segments)

  if (!events.length) {
    return <p className="rounded-3xl bg-card-2 px-5 py-6 text-center text-[15px] text-ink-2">{empty ?? 'Nothing logged yet.'}</p>
  }
  return (
    <ol className="relative">
      {events.map((e) => {
        const meta = TYPES[e.type]
        const by = e.created_by === userId ? 'you' : displayName(e.created_by)
        const detail = eventDetail(e, segs, prefs, now)
        return (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onSelect(e)}
              className="flex w-full items-center gap-3 rounded-2xl py-2.5 text-left active:bg-card-2"
            >
              <span className="num w-[62px] shrink-0 text-right text-[15px] font-semibold text-ink-2">
                {family ? fmtTime(e.started_at, family.timezone) : ''}
              </span>
              <span
                className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl"
                style={{ background: toneSoft(meta.tone), color: toneVar(meta.tone) }}
              >
                <TypeIcon type={e.type} kind={typeof e.data.kind === 'string' ? e.data.kind : undefined} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[16px] font-semibold leading-tight">
                  <span className="truncate">{eventTitle(e, family)}</span>
                  {e.timer_state && (
                    <span className="pulse-dot h-2 w-2 shrink-0 rounded-full" style={{ background: toneVar(meta.tone) }} aria-label="In progress" />
                  )}
                </span>
                <span className="block truncate text-[14px] text-ink-2">
                  {detail ? `${detail}, ` : ''}by {by}
                  {e._local ? ' (sending)' : ''}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
