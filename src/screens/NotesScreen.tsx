import { MagnifyingGlass, NotePencil } from '@phosphor-icons/react'
import { TZDate } from '@date-fns/tz'
import { useMemo, useState } from 'react'
import { PhotoThumb } from '../components/PhotoPicker'
import { Button } from '../components/ui'
import { noteBody, noteTitle } from '../lib/describe'
import { activeChild, useLeela } from '../lib/store'
import { ageText, fmtLongDate } from '../lib/time'
import type { LeelaEvent } from '../lib/types'

export function NotesScreen() {
  const family = useLeela((s) => s.family)!
  const eventsMap = useLeela((s) => s.events)
  const set = useLeela((s) => s.set)
  const child = activeChild()
  const [q, setQ] = useState('')
  const tz = family.timezone

  const notes = useMemo(
    () =>
      Object.values(eventsMap)
        .filter((e) => e.type === 'note' && !e.deleted_at && e.child_id === child?.id)
        .sort((a, b) => b.started_at.localeCompare(a.started_at)),
    [eventsMap, child?.id],
  )
  const needle = q.trim().toLowerCase()
  const shown = needle ? notes.filter((n) => `${noteTitle(n)}\n${noteBody(n)}`.toLowerCase().includes(needle)) : notes
  const months = useMemo(() => {
    const out: { key: string; label: string; items: LeelaEvent[] }[] = []
    for (const n of shown) {
      const d = new TZDate(Date.parse(n.started_at), tz)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      let g = out.find((x) => x.key === key)
      if (!g) {
        g = { key, label: d.toLocaleDateString('en', { month: 'long', year: 'numeric', timeZone: tz }), items: [] }
        out.push(g)
      }
      g.items.push(n)
    }
    return out
  }, [shown, tz])

  if (!child) return <p className="px-5 pt-10 text-center text-ink-2">Add your baby first, from the Today tab.</p>
  const open = (id?: string) => set({ overlay: { kind: 'note', id } })

  return (
    <div className="mx-auto max-w-[560px] px-5 pb-32">
      <header className="safe-top pb-4">
        <h1 className="font-display text-[30px] font-extrabold leading-tight">Notes</h1>
        <p className="text-[15px] text-ink-2">Memories, firsts and everything in between. They all go into {child.name}’s diary.</p>
      </header>

      <Button tone="note" className="mb-4 w-full" onClick={() => open()}>
        <NotePencil size={22} weight="bold" aria-hidden="true" /> Write a note
      </Button>

      {notes.length > 3 && (
        <label className="mb-5 flex h-12 items-center gap-2 rounded-2xl bg-card px-4 ring-1 ring-line focus-within:ring-[var(--note)]">
          <MagnifyingGlass size={20} className="text-ink-3" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your notes" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none" aria-label="Search notes" />
        </label>
      )}

      {notes.length === 0 ? (
        <div className="rounded-[28px] bg-card px-6 py-8 text-center">
          <p className="font-display text-[20px] font-bold">Nothing written yet</p>
          <p className="mx-auto mt-1 max-w-[34ch] text-[15px] text-ink-2">
            Write down the first smile, the funny faces, the long nights, with photos. Leela keeps them for the diary book, and logs anything worth logging.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <p className="rounded-3xl bg-card-2 px-5 py-6 text-center text-[15px] text-ink-2">No notes mention “{q.trim()}”.</p>
      ) : (
        months.map((m) => (
          <section key={m.key} className="mb-6" aria-label={m.label}>
            <h2 className="mb-2 flex items-baseline justify-between gap-3">
              <span className="font-display text-[20px] font-bold">{m.label}</span>
              {child.birth_date && <span className="text-[13px] text-ink-3">{ageText(child.birth_date, Date.parse(m.items[0].started_at))}</span>}
            </h2>
            <ol className="space-y-3">
              {m.items.map((n) => (
                <li key={n.id}>
                  <NoteCard note={n} tz={tz} onOpen={() => open(n.id)} />
                </li>
              ))}
            </ol>
          </section>
        ))
      )}
    </div>
  )
}

export function NoteCard({ note, tz, onOpen }: { note: LeelaEvent; tz: string; onOpen: () => void }) {
  const body = noteBody(note)
  const title = noteTitle(note)
  const hasTitle = typeof note.data.title === 'string' && note.data.title.trim().length > 0
  const excerpt = body
  const photos = note.photo_paths
  return (
    <button type="button" onClick={onOpen} className="w-full overflow-hidden rounded-[26px] bg-card text-left">
      {photos.length > 0 && (
        <div className={photos.length === 1 ? 'aspect-[16/10]' : photos.length === 2 ? 'grid aspect-[16/9] grid-cols-2 gap-0.5' : 'grid aspect-[16/9] grid-cols-3 grid-rows-2 gap-0.5'}>
          {photos.length === 1 ? (
            <PhotoThumb path={photos[0]} />
          ) : photos.length === 2 ? (
            photos.map((p) => (
              <div key={p} className="relative">
                <PhotoThumb path={p} />
              </div>
            ))
          ) : (
            photos.slice(0, 3).map((p, i) => (
              <div key={p} className={i === 0 ? 'relative col-span-2 row-span-2' : 'relative'}>
                <PhotoThumb path={p} />
                {i === 2 && photos.length > 3 && <span className="absolute inset-0 grid place-items-center bg-black/45 text-[18px] font-bold text-white">+{photos.length - 3}</span>}
              </div>
            ))
          )}
        </div>
      )}
      <div className="p-4">
        <div className="text-[13px] font-semibold" style={{ color: 'var(--note)' }}>
          {fmtLongDate(note.started_at, tz)}
        </div>
        {hasTitle ? (
          <>
            <div className="font-display text-[20px] font-bold leading-tight">{title}</div>
            {excerpt.trim() && <p className="mt-1 line-clamp-4 whitespace-pre-line text-[15px] text-ink-2">{excerpt.trim()}</p>}
          </>
        ) : (
          <p className="mt-0.5 line-clamp-5 whitespace-pre-line text-[17px] leading-snug">{body.trim()}</p>
        )}
      </div>
    </button>
  )
}
