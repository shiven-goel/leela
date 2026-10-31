import { MORE_GROUPS, TYPES, toneSoft, toneVar } from '../lib/config'
import type { EventType } from '../lib/types'
import { TypeIcon } from './Icon'
import { Sheet } from './Sheet'

export function MoreSheet({ open, onClose, onPick, dayLabel }: { open: boolean; onClose: () => void; onPick: (t: EventType) => void; dayLabel?: string }) {
  return (
    <Sheet open={open} onClose={onClose} title={dayLabel ? `Add to ${dayLabel}` : 'Log something'}>
      {MORE_GROUPS.map((g) => (
        <section key={g.title} className="mb-5">
          <h3 className="mb-2 text-[15px] font-semibold text-ink-2">{g.title}</h3>
          <div className="grid grid-cols-4 gap-2">
            {g.types.map((t) => {
              const meta = TYPES[t]
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => onPick(t)}
                  className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-3xl px-1 text-center active:scale-95"
                  style={{ background: toneSoft(meta.tone) }}
                >
                  <span style={{ color: toneVar(meta.tone) }}>
                    <TypeIcon type={t} size={28} />
                  </span>
                  <span className="text-[13px] font-semibold leading-tight">{t === 'symptom' ? 'Health' : meta.label}</span>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </Sheet>
  )
}
