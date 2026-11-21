import clsx from 'clsx'
import { MagnifyingGlass, X } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Overlay } from '../components/Overlay'
import { Timeline } from '../components/Timeline'
import { Button } from '../components/ui'
import { eventDetail, eventTitle } from '../lib/describe'
import { searchText } from '../lib/insights'
import { loggedBy, myPrefs, useLeela } from '../lib/store'
import { loadAllHistory } from '../lib/sync'
import { fmtLongDate } from '../lib/time'
import type { LeelaEvent } from '../lib/types'

const QUICK: { id: string; label: string; test: (e: LeelaEvent) => boolean }[] = [
  { id: 'firsts', label: 'Firsts', test: (e) => e.type === 'milestone' },
  { id: 'notes', label: 'Notes', test: (e) => e.type === 'note' || Boolean(e.notes) },
  { id: 'photos', label: 'Photos', test: (e) => e.photo_paths.length > 0 },
  { id: 'vaccines', label: 'Vaccines', test: (e) => e.type === 'symptom' && e.data.kind === 'vaccine' },
  { id: 'doctor', label: 'Doctor visits', test: (e) => e.type === 'symptom' && e.data.kind === 'visit' },
  { id: 'medicine', label: 'Medicine', test: (e) => e.type === 'medicine' },
  { id: 'temp', label: 'Temperature', test: (e) => e.type === 'temperature' },
  { id: 'growth', label: 'Growth', test: (e) => e.type === 'growth' },
]
const PAGE = 50

/** Find anything ever logged: a word from a note, a food, a medicine, a place, a first. */
export function HistorySearch({ open, onClose, events, childId, onOpenEntry }: { open: boolean; onClose: () => void; events: LeelaEvent[]; childId: string; onOpenEntry: (e: LeelaEvent) => void }) {
  const family = useLeela((s) => s.family)!
  const segments = useLeela((s) => s.segments)
  const tz = family.timezone
  const [q, setQ] = useState('')
  const [quick, setQuick] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    void loadAllHistory()
    window.setTimeout(() => input.current?.focus(), 250)
  }, [open])

  const index = useMemo(() => {
    if (!open) return []
    const prefs = myPrefs()
    const segs = Object.values(segments)
    const now = Date.now()
    return events
      .filter((e) => e.child_id === childId && e.type !== 'contraction')
      .map((e) => ({ e, text: `${searchText(e, eventTitle(e, family), eventDetail(e, segs, prefs, now))} ${loggedBy(e).toLowerCase()}` }))
      .sort((a, b) => b.e.started_at.localeCompare(a.e.started_at))
  }, [open, events, childId, segments, family])

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const test = QUICK.find((x) => x.id === quick)?.test
  const results = words.length || test ? index.filter((r) => (!test || test(r.e)) && words.every((w) => r.text.includes(w))).map((r) => r.e) : []

  const groups: { key: string; items: LeelaEvent[] }[] = []
  for (const e of results.slice(0, shown)) {
    const key = fmtLongDate(e.started_at, tz)
    const last = groups[groups.length - 1]
    if (last?.key === key) last.items.push(e)
    else groups.push({ key, items: [e] })
  }

  return (
    <Overlay
      open={open}
      onClose={() => {
        setQ('')
        setQuick(null)
        onClose()
      }}
      title="Search"
    >
      <div className="relative mb-3">
        <MagnifyingGlass size={20} weight="bold" className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
        <input
          ref={input}
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setShown(PAGE)
          }}
          placeholder="Calpol, Nani, rash, carrot…"
          aria-label="Search everything logged"
          className="h-13 w-full rounded-2xl border border-line bg-card pr-12 pl-11 text-[17px] outline-none focus:border-brand"
        />
        {q && (
          <button type="button" onClick={() => setQ('')} className="absolute top-1/2 right-2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full text-ink-3" aria-label="Clear">
            <X size={18} weight="bold" />
          </button>
        )}
      </div>
      <div className="no-scrollbar -mx-5 mb-4 flex gap-2 overflow-x-auto px-5 pb-1" role="group" aria-label="Show only">
        {QUICK.map((x) => (
          <button
            key={x.id}
            type="button"
            aria-pressed={quick === x.id}
            onClick={() => {
              setQuick(quick === x.id ? null : x.id)
              setShown(PAGE)
            }}
            className={clsx('min-h-10 shrink-0 rounded-full px-4 text-[14px] font-semibold ring-1', quick === x.id ? 'bg-brand text-brand-ink ring-brand' : 'bg-card ring-line')}
          >
            {x.label}
          </button>
        ))}
      </div>

      {!words.length && !test ? (
        <p className="rounded-3xl bg-card-2 px-5 py-6 text-center text-[15px] text-ink-2">Search every entry since the start: notes, foods, medicines, who logged it, places. Or pick one of the chips above.</p>
      ) : !results.length ? (
        <p className="rounded-3xl bg-card-2 px-5 py-6 text-center text-[15px] text-ink-2">Nothing found{q ? ` for “${q.trim()}”` : ''}.</p>
      ) : (
        <>
          <p className="mb-2 text-[14px] text-ink-2" aria-live="polite">
            {results.length.toLocaleString('en')} {results.length === 1 ? 'entry' : 'entries'}
          </p>
          {groups.map((g) => (
            <div key={g.key} className="mb-2">
              <h3 className="mb-0.5 text-[14px] font-semibold text-ink-2">{g.key}</h3>
              <Timeline events={g.items} now={Date.now()} onSelect={onOpenEntry} />
            </div>
          ))}
          {results.length > shown && (
            <Button variant="secondary" className="mt-2 w-full" onClick={() => setShown((n) => n + PAGE)}>
              Show more
            </Button>
          )}
        </>
      )}
    </Overlay>
  )
}
