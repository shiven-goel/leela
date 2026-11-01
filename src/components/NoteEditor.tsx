import clsx from 'clsx'
import { Question, Trash } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { deleteEvent, editEvent, logEvent } from '../lib/actions'
import { TYPES, toneSoft, toneVar } from '../lib/config'
import { eventDetail, eventTitle, noteBody } from '../lib/describe'
import { learnWords } from '../lib/import/learn'
import type { Draft } from '../lib/import/parse'
import { MEANINGS, rankMeanings } from '../lib/import/vocab'
import { clearNoteDraft, interpretNote, loadNoteDraft, logFromNote, saveNoteDraft } from '../lib/notes'
import { activeChild, myPrefs, useLeela } from '../lib/store'
import { fmtShortDate, fmtTime } from '../lib/time'
import type { LeelaEvent } from '../lib/types'
import { TypeIcon } from './Icon'
import { Overlay } from './Overlay'
import { PhotoPicker } from './PhotoPicker'
import { Sheet } from './Sheet'
import { Button } from './ui'
import { WhenPicker } from './WhenPicker'

const MAX_CHARS = 500_000

/** Write or edit a note: as long as you like, with photos. Leela offers to log anything it spots. */
export function NoteEditor({ open, noteId, onClose }: { open: boolean; noteId?: string; onClose: () => void }) {
  const family = useLeela((s) => s.family)!
  const existing = useLeela((s) => (noteId ? s.events[noteId] : undefined))
  const toast = useLeela((s) => s.toast)
  const child = activeChild()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [at, setAt] = useState(() => new Date())
  const [photos, setPhotos] = useState<string[]>([])
  const [restored, setRestored] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState<{ noteId: string; childId: string; body: string; at: Date } | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const initial = useRef('')

  useEffect(() => {
    if (!open) return
    setError(null)
    setFound(null)
    const draft = loadNoteDraft(noteId)
    if (existing) {
      setTitle(draft?.title ?? (typeof existing.data.title === 'string' ? existing.data.title : ''))
      setBody(draft?.body ?? noteBody(existing))
      setAt(new Date(draft?.at ?? existing.started_at))
      setPhotos(draft?.photos ?? existing.photo_paths)
    } else {
      setTitle(draft?.title ?? '')
      setBody(draft?.body ?? '')
      setAt(new Date(draft?.at ?? Date.now()))
      setPhotos(draft?.photos ?? [])
    }
    setRestored(Boolean(draft && (draft.body || draft.title)))
    initial.current = existing
      ? JSON.stringify([typeof existing.data.title === 'string' ? existing.data.title : '', noteBody(existing), existing.photo_paths])
      : JSON.stringify(['', '', []])
    // Load once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, noteId])

  // Keep an unsaved copy on this phone while writing.
  useEffect(() => {
    if (!open || found) return
    const t = window.setTimeout(() => saveNoteDraft(noteId, { title, body, at: at.getTime(), photos }), 500)
    return () => window.clearTimeout(t)
  }, [open, noteId, title, body, at, photos, found])

  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(260, el.scrollHeight + 2)}px`
  }, [body, open])

  const words = useMemo(() => (body.trim() ? body.trim().split(/\s+/).length : 0), [body])

  if (!child) return null

  const save = async () => {
    const text = body.replace(/\s+$/, '')
    if (!text.trim() && !photos.length) {
      setError('Write something or add a photo first.')
      return
    }
    const data = { ...(existing?.data ?? {}), title: title.trim() || undefined, body: text }
    let id = noteId
    if (existing) {
      await editEvent(existing.id, { started_at: at.toISOString(), data, photo_paths: photos, notes: null })
    } else {
      const e = await logEvent({ type: 'note', childId: child.id, startedAt: at.toISOString(), data, photoPaths: photos }, { quiet: true })
      id = e.id
    }
    clearNoteDraft(noteId)
    toast({ text: 'Note saved.' })
    if (text.trim() && id) {
      const { drafts } = interpretNote(text, at, child.id)
      if (drafts.length) {
        setFound({ noteId: id, childId: child.id, body: text, at })
        return
      }
    }
    onClose()
  }

  const remove = () => {
    if (!existing) return
    if (!window.confirm('Delete this note? Its photos go with it. You can undo right after.')) return
    clearNoteDraft(noteId)
    void deleteEvent(existing.id)
    onClose()
  }

  const discard = () => {
    const dirty = JSON.stringify([title, body, photos]) !== initial.current
    if (dirty && !window.confirm('Keep what you wrote as a draft on this phone? Choose Cancel to throw it away.')) clearNoteDraft(noteId)
    if (!dirty) clearNoteDraft(noteId)
    onClose()
  }

  return (
    <Overlay
      open={open}
      onClose={discard}
      title={existing ? 'Edit note' : 'New note'}
      actions={
        existing ? (
          <button type="button" onClick={remove} className="grid h-11 w-11 place-items-center rounded-full text-[var(--health)]" aria-label="Delete note">
            <Trash size={22} weight="bold" />
          </button>
        ) : undefined
      }
      footer={
        <div className="flex items-center gap-3">
          <span className="num min-w-0 flex-1 text-[14px] text-ink-3">
            {words.toLocaleString()} {words === 1 ? 'word' : 'words'}
            {photos.length ? `, ${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}` : ''}
          </span>
          <Button tone="note" onClick={() => void save()}>
            Save note
          </Button>
        </div>
      }
    >
      {restored && <p className="mb-4 rounded-2xl bg-[var(--note-soft)] px-4 py-2.5 text-[14px]">Picked up where you left off.</p>}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, 120))}
        placeholder="Title (optional)"
        aria-label="Title"
        className="mb-3 w-full bg-transparent font-display text-[26px] font-bold leading-tight outline-none placeholder:text-ink-3"
      />
      <WhenPicker label="When it happened" value={at} onChange={setAt} timeZone={family.timezone} />
      <textarea
        ref={area}
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, MAX_CHARS))}
        placeholder={`What did ${child.name} do today? Write as much as you like: the firsts, the funny bits, the long nights, who came to visit.`}
        aria-label="Note"
        className="mb-5 w-full resize-none rounded-[22px] border border-line bg-card px-4 py-4 text-[18px] leading-[1.6] outline-none placeholder:text-ink-3 focus:border-[var(--note)]"
      />
      <PhotoPicker paths={photos} onChange={setPhotos} max={30} />
      <p className="text-[14px] text-ink-3">Notes and their photos go into {child.name}’s diary and the printable diary book. If you mention a feed, a medicine or a first, Leela offers to log it too.</p>
      {error && (
        <p role="alert" className="mt-4 rounded-2xl bg-[var(--health-soft)] px-4 py-3 text-[15px] text-[var(--health)]">
          {error}
        </p>
      )}
      {found && (
        <NoteSuggestions
          {...found}
          onDone={() => {
            setFound(null)
            onClose()
          }}
        />
      )}
    </Overlay>
  )
}

/** "Add these to the log?" after saving a note that mentions loggable things. */
export function NoteSuggestions({ noteId, childId, body, at, onDone }: { noteId: string; childId: string; body: string; at: Date; onDone: () => void }) {
  const family = useLeela((s) => s.family)!
  const toast = useLeela((s) => s.toast)
  const prefs = myPrefs()
  const [{ drafts, unknown }, setState] = useState(() => {
    const r = interpretNote(body, at, childId)
    return { drafts: r.drafts, unknown: r.result.unknown.slice(0, 3) }
  })
  const [asked, setAsked] = useState<Record<string, string>>({})
  const chosen = drafts.filter((d) => d.include).length

  const learn = async (term: string, meaning: string) => {
    setAsked((a) => ({ ...a, [term]: meaning }))
    await learnWords({ [term]: meaning })
    const r = interpretNote(body, at, childId)
    setState({ drafts: r.drafts, unknown: r.result.unknown.filter((u) => !(u.term in asked) && u.term !== term).slice(0, 3) })
  }

  const add = async () => {
    const undo = await logFromNote(noteId, childId, drafts)
    toast({ text: `Added ${chosen} ${chosen === 1 ? 'entry' : 'entries'} from your note.`, action: { label: 'Undo', run: undo } })
    onDone()
  }

  return (
    <Sheet
      open
      onClose={onDone}
      title="Add these to the log?"
      footer={
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onDone}>
            Not now
          </Button>
          <Button disabled={!chosen} onClick={() => void add()}>
            Add {chosen || ''}
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-[15px] text-ink-2">Leela spotted these in your note. Untick anything that’s wrong.</p>
      <ul className="mb-4 divide-y divide-line">
        {drafts.map((d) => {
          const e = draftEvent(d)
          const detail = eventDetail(e, [], prefs, Date.now())
          return (
            <li key={d.key}>
              <label className="flex cursor-pointer items-start gap-3 py-2.5">
                <input
                  type="checkbox"
                  checked={d.include}
                  onChange={(ev) => setState((st) => ({ ...st, drafts: st.drafts.map((x) => (x.key === d.key ? { ...x, include: ev.target.checked } : x)) }))}
                  className="mt-1.5 h-5 w-5 shrink-0 accent-[var(--brand)]"
                />
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl" style={{ background: toneSoft(TYPES[d.type].tone), color: toneVar(TYPES[d.type].tone) }}>
                  <TypeIcon type={d.type} kind={d.data.kind as string | undefined} size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold leading-snug">
                    {eventTitle(e, family)}
                    {detail && <span className="font-normal text-ink-2">, {detail}</span>}
                  </span>
                  <span className="block text-[13px] text-ink-3">
                    {d.flags.includes('no_time') ? fmtShortDate(d.start, family.timezone) : `${fmtShortDate(d.start, family.timezone)}, ${fmtTime(d.start, family.timezone)}`}
                    {d.flags.includes('duplicate') ? ', looks already logged' : ''}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      {unknown.map((u) => (
        <div key={u.term} className="mb-4 rounded-[22px] bg-card-2 p-4">
          <div className="mb-2 flex items-center gap-2 text-[16px] font-semibold">
            <Question size={20} weight="duotone" className="text-brand" aria-hidden="true" /> What does “{u.term}” mean?
          </div>
          <div className="flex flex-wrap gap-2">
            {rankMeanings(u.examples)
              .slice(0, 5)
              .concat('ignore')
              .map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => void learn(u.term, id)}
                  className={clsx('min-h-10 rounded-full px-3.5 text-[14px] font-semibold ring-1 ring-line', asked[u.term] === id ? 'bg-brand text-brand-ink' : 'bg-card')}
                >
                  {MEANINGS.find((m) => m.id === id)?.label}
                </button>
              ))}
          </div>
        </div>
      ))}
    </Sheet>
  )
}

function draftEvent(d: Draft): LeelaEvent {
  return {
    id: d.key,
    family_id: '',
    child_id: null,
    type: d.type,
    started_at: new Date(d.start).toISOString(),
    ended_at: d.end ? new Date(d.end).toISOString() : null,
    timer_state: null,
    data: d.data,
    photo_paths: [],
    notes: d.notes,
    source: 'app',
    import_id: null,
    created_by: null,
    updated_by: null,
    created_at: '',
    updated_at: '',
    deleted_at: null,
  }
}
