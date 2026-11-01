import { BookOpenText, NotePencil, Star } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import { LogSheet } from '../components/LogSheet'
import { PhotoThumb } from '../components/PhotoPicker'
import { Button } from '../components/ui'
import { eventTitle } from '../lib/describe'
import { activeChild, useLeela } from '../lib/store'
import { ageText, fmtLongDate } from '../lib/time'
import type { EventType, LeelaEvent } from '../lib/types'
import { NoteCard } from './NotesScreen'

/** Month of life a moment falls in: 1 for the first month after birth. */
function lifeMonth(birth: string | null, iso: string): number | null {
  if (!birth) return null
  const days = (Date.parse(iso) - Date.parse(`${birth}T00:00:00`)) / 86_400_000
  return days < 0 ? 0 : Math.floor(days / 30.4375) + 1
}

export function DiaryScreen() {
  const family = useLeela((s) => s.family)!
  const eventsMap = useLeela((s) => s.events)
  const set = useLeela((s) => s.set)
  const child = activeChild()
  const [sheet, setSheet] = useState<{ type: EventType; edit?: LeelaEvent } | null>(null)
  const tz = family.timezone

  const memories = useMemo(
    () =>
      Object.values(eventsMap)
        .filter((e) => !e.deleted_at && e.child_id === child?.id && (e.type === 'milestone' || e.type === 'note' || e.photo_paths.length > 0))
        .sort((a, b) => b.started_at.localeCompare(a.started_at)),
    [eventsMap, child?.id],
  )
  const photoCount = memories.reduce((n, e) => n + e.photo_paths.length, 0)
  const groups = useMemo(() => {
    const out: { key: string; label: string; items: LeelaEvent[] }[] = []
    for (const e of memories) {
      const m = lifeMonth(child?.birth_date ?? null, e.started_at)
      const key = m === null ? 'all' : String(m)
      let g = out.find((x) => x.key === key)
      if (!g) {
        g = { key, label: m === null ? 'Memories' : m === 0 ? 'Before you were born' : `Month ${m}`, items: [] }
        out.push(g)
      }
      g.items.push(e)
    }
    return out
  }, [memories, child?.birth_date])

  if (!child) return <p className="px-5 pt-10 text-center text-ink-2">Add your baby first, from the Today tab.</p>

  return (
    <div className="mx-auto max-w-[560px] px-5 pb-32">
      <header className="safe-top pb-4">
        <h1 className="font-display text-[30px] font-extrabold leading-tight">{child.name}’s diary</h1>
        <p className="text-[15px] text-ink-2">
          {child.birth_date ? `Born ${fmtLongDate(`${child.birth_date}T12:00:00`, tz)}, ${ageText(child.birth_date)}` : 'Firsts, notes and photos, all in one place.'}
        </p>
      </header>

      <section className="mb-6 overflow-hidden rounded-[28px] p-5" style={{ background: 'var(--milestone-soft)' }}>
        <div className="flex items-start gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-card" style={{ color: 'var(--milestone)' }}>
            <BookOpenText size={30} weight="duotone" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-[21px] font-bold leading-tight">The diary book</h2>
            <p className="mt-1 text-[15px] text-ink-2">
              Everything since birth, month by month: your notes and photos, the firsts, growth and gentle totals. Make it a PDF to print and keep.
            </p>
            <p className="mt-2 text-[14px] text-ink-3">
              {memories.filter((m) => m.type === 'note').length} notes, {memories.filter((m) => m.type === 'milestone').length} firsts, {photoCount} photos so far
            </p>
          </div>
        </div>
        <Button className="mt-4 w-full" tone="milestone" onClick={() => set({ overlay: { kind: 'book' } })}>
          Make the diary book
        </Button>
      </section>

      <div className="mb-6 grid grid-cols-2 gap-3">
        <button type="button" onClick={() => setSheet({ type: 'milestone' })} className="flex h-16 items-center justify-center gap-2 rounded-3xl bg-card text-[16px] font-semibold">
          <Star size={22} weight="duotone" style={{ color: 'var(--milestone)' }} aria-hidden="true" /> Add a first
        </button>
        <button type="button" onClick={() => set({ overlay: { kind: 'note' } })} className="flex h-16 items-center justify-center gap-2 rounded-3xl bg-card text-[16px] font-semibold">
          <NotePencil size={22} weight="duotone" style={{ color: 'var(--note)' }} aria-hidden="true" /> Write a note
        </button>
      </div>

      {memories.length === 0 ? (
        <p className="rounded-3xl bg-card-2 px-5 py-6 text-center text-[15px] text-ink-2">Firsts, notes and photos you add will collect here, month by month, ready for the diary book.</p>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="mb-7" aria-label={g.label}>
            <h2 className="mb-3 font-display text-[22px] font-bold">{g.label}</h2>
            <ol className="space-y-3">
              {g.items.map((e) =>
                e.type === 'note' ? (
                  <li key={e.id}>
                    <NoteCard note={e} tz={tz} onOpen={() => set({ overlay: { kind: 'note', id: e.id } })} />
                  </li>
                ) : (
                  <li key={e.id}>
                    <button type="button" onClick={() => setSheet({ type: e.type, edit: e })} className="w-full overflow-hidden rounded-[26px] bg-card text-left">
                      {e.photo_paths.length > 0 && (
                        <div className={e.photo_paths.length === 1 ? 'aspect-[16/10]' : 'grid aspect-[16/10] grid-cols-2 gap-0.5'}>
                          {e.photo_paths.slice(0, 2).map((p) => (
                            <div key={p} className="relative">
                              <PhotoThumb path={p} />
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="p-4">
                        <div className="text-[13px] font-semibold" style={{ color: e.type === 'milestone' ? 'var(--milestone)' : 'var(--ink-2)' }}>
                          {fmtLongDate(e.started_at, tz)}
                        </div>
                        <div className="font-display text-[20px] font-bold leading-tight">{eventTitle(e, family)}</div>
                        {e.notes && <p className="mt-1 line-clamp-3 text-[15px] text-ink-2">{e.notes}</p>}
                      </div>
                    </button>
                  </li>
                ),
              )}
            </ol>
          </section>
        ))
      )}

      {sheet && <LogSheet key={sheet.edit?.id ?? sheet.type} open onClose={() => setSheet(null)} type={sheet.type} edit={sheet.edit} />}
    </div>
  )
}
