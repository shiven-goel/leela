import { BookOpenText, NotePencil, Star } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import { LogSheet } from '../components/LogSheet'
import { PhotoThumb } from '../components/PhotoPicker'
import { eventTitle } from '../lib/describe'
import { activeChild, useLeela } from '../lib/store'
import { ageText, fmtLongDate } from '../lib/time'
import type { EventType, LeelaEvent } from '../lib/types'

export function DiaryScreen() {
  const family = useLeela((s) => s.family)!
  const eventsMap = useLeela((s) => s.events)
  const child = activeChild()
  const [sheet, setSheet] = useState<{ type: EventType; edit?: LeelaEvent } | null>(null)

  const memories = useMemo(
    () =>
      Object.values(eventsMap)
        .filter((e) => !e.deleted_at && (e.type === 'milestone' || e.type === 'note') && e.child_id === child?.id)
        .sort((a, b) => b.started_at.localeCompare(a.started_at)),
    [eventsMap, child?.id],
  )

  if (!child) return <p className="px-5 pt-10 text-center text-ink-2">Add your baby first, from the Today tab.</p>

  return (
    <div className="mx-auto max-w-[560px] px-5 pb-32">
      <header className="safe-top pb-4">
        <h1 className="font-display text-[30px] font-extrabold leading-tight">{child.name}’s diary</h1>
        <p className="text-[15px] text-ink-2">
          {child.birth_date ? `Born ${fmtLongDate(`${child.birth_date}T12:00:00`, family.timezone)}, ${ageText(child.birth_date)}` : 'Firsts, notes and photos, all in one place.'}
        </p>
      </header>

      <section className="mb-6 overflow-hidden rounded-[28px] p-5" style={{ background: 'var(--milestone-soft)' }}>
        <div className="flex items-start gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-card" style={{ color: 'var(--milestone)' }}>
            <BookOpenText size={30} weight="duotone" />
          </span>
          <div>
            <h2 className="font-display text-[21px] font-bold leading-tight">The printable diary book</h2>
            <p className="mt-1 text-[15px] text-ink-2">
              Every month since birth, with milestones, photos, growth and gentle totals, as a PDF you can print. It arrives in the next update.
            </p>
          </div>
        </div>
      </section>

      <div className="mb-5 grid grid-cols-2 gap-3">
        <button type="button" onClick={() => setSheet({ type: 'milestone' })} className="flex h-16 items-center justify-center gap-2 rounded-3xl bg-card text-[16px] font-semibold">
          <Star size={22} weight="duotone" style={{ color: 'var(--milestone)' }} aria-hidden="true" /> Add a first
        </button>
        <button type="button" onClick={() => setSheet({ type: 'note' })} className="flex h-16 items-center justify-center gap-2 rounded-3xl bg-card text-[16px] font-semibold">
          <NotePencil size={22} weight="duotone" style={{ color: 'var(--note)' }} aria-hidden="true" /> Write a note
        </button>
      </div>

      {memories.length === 0 ? (
        <p className="rounded-3xl bg-card-2 px-5 py-6 text-center text-[15px] text-ink-2">Firsts and notes you add will collect here, ready for the diary book.</p>
      ) : (
        <ol className="space-y-3">
          {memories.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => setSheet({ type: e.type, edit: e })} className="w-full overflow-hidden rounded-[26px] bg-card text-left">
                {e.photo_paths.length > 0 && (
                  <div className="grid aspect-[16/10] grid-cols-2 gap-0.5">
                    {e.photo_paths.slice(0, 2).map((p, i) => (
                      <div key={p} className={e.photo_paths.length === 1 ? 'col-span-2' : i === 0 ? '' : ''}>
                        <PhotoThumb path={p} />
                      </div>
                    ))}
                  </div>
                )}
                <div className="p-4">
                  <div className="text-[13px] font-semibold" style={{ color: e.type === 'milestone' ? 'var(--milestone)' : 'var(--note)' }}>
                    {fmtLongDate(e.started_at, family.timezone)}
                  </div>
                  <div className="font-display text-[20px] font-bold leading-tight">{e.type === 'note' ? 'Diary note' : eventTitle(e, family)}</div>
                  {e.notes && <p className="mt-1 line-clamp-3 text-[15px] text-ink-2">{e.notes}</p>}
                </div>
              </button>
            </li>
          ))}
        </ol>
      )}

      {sheet && <LogSheet key={sheet.edit?.id ?? sheet.type} open onClose={() => setSheet(null)} type={sheet.type} edit={sheet.edit} />}
    </div>
  )
}
