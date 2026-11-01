import clsx from 'clsx'
import { ArrowCounterClockwise, CaretDown, CheckCircle, FileText, Question, X } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { TypeIcon } from '../components/Icon'
import { Overlay } from '../components/Overlay'
import { Sheet } from '../components/Sheet'
import { Button, Choices, Toggle } from '../components/ui'
import { savePrefs } from '../lib/actions'
import { TYPES, toneSoft, toneVar } from '../lib/config'
import { eventDetail, eventTitle } from '../lib/describe'
import { ImportFileError, readImportFile } from '../lib/import/files'
import { familyVocab, learnWords, namesToSkip } from '../lib/import/learn'
import { parseLog, type Draft, type Flag, type Input, type ParseResult } from '../lib/import/parse'
import { commitImport, listImports, markDuplicates, undoImport, type ImportRecord } from '../lib/import/save'
import { MEANINGS, rankMeanings, type Vocab } from '../lib/import/vocab'
import { activeChild, myPrefs, useLeela } from '../lib/store'
import { loadAllHistory } from '../lib/sync'
import { dayKey, dayLabel, fmtLongDate, fmtShortDate, fmtTime, fromLocalInput, toLocalInput } from '../lib/time'
import type { EventType, LeelaEvent } from '../lib/types'

type Step = 'choose' | 'reading' | 'ask' | 'review' | 'saving' | 'done'

interface Answers {
  order?: 'dmy' | 'mdy'
  undatedDay?: string
  feedDefault?: 'nursing' | 'bottle'
  words: Vocab
}

type Q =
  | { kind: 'order' }
  | { kind: 'day' }
  | { kind: 'feed'; count: number }
  | { kind: 'word'; term: string; count: number; examples: string[] }

const ACCEPT = '.pdf,.docx,.txt,.md,.csv,.tsv,.xlsx,.xlsm,.html,.htm,.rtf,text/plain,application/pdf'

const FLAG_TEXT: Record<Flag, string> = {
  duplicate: 'Already in Leela',
  no_time: 'No time written, placed at noon',
  approx_time: 'Time guessed from the words',
  no_end: 'No wake-up time',
  before_birth: 'Before the birth date',
  future: 'Later than now',
  guessed_feed: 'Just says “fed”',
}
const BLOCKING: Flag[] = ['duplicate', 'no_end', 'before_birth', 'future']

const toYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return { y, m, d }
}

function asEvent(d: Draft): LeelaEvent {
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
    source: 'import',
    import_id: null,
    created_by: null,
    updated_by: null,
    created_at: '',
    updated_at: '',
    deleted_at: null,
  }
}

/** Which meaning a corrected entry stands for, so a word can be remembered as that. */
function meaningForDraft(d: Draft): string | null {
  switch (d.type) {
    case 'nursing':
      return 'breastfeed'
    case 'bottle':
      return d.data.contents === 'formula' ? 'formula' : 'bottle'
    case 'pump':
      return 'pump'
    case 'solids':
      return 'solids'
    case 'diaper':
      return d.data.kind === 'dirty' ? 'dirty' : d.data.kind === 'mixed' ? 'mixed' : 'wet'
    case 'sleep':
      return d.data.kind === 'night' ? 'night' : 'nap'
    case 'medicine':
      return 'medicine'
    case 'temperature':
      return 'temp'
    case 'activity':
      return d.data.kind === 'bath' ? 'bath' : d.data.kind === 'tummy' ? 'tummy' : d.data.label === 'Massage' ? 'massage' : null
    default:
      return null
  }
}

export function ImportScreen({ open, onClose }: { open: boolean; onClose: () => void }) {
  const family = useLeela((s) => s.family)!
  const kids = useLeela((s) => s.children)
  const toast = useLeela((s) => s.toast)
  const tz = family.timezone
  const [childId, setChildId] = useState<string | undefined>(() => activeChild()?.id ?? kids[0]?.id)
  const [step, setStep] = useState<Step>('choose')
  const [text, setText] = useState('')
  const [file, setFile] = useState<{ input: Input; name: string; chars: number } | null>(null)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Answers>({ words: {} })
  const [asked, setAsked] = useState<Q[]>([])
  const [result, setResult] = useState<ParseResult | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [saved, setSaved] = useState<{ importId: string; saved: number } | null>(null)
  const [past, setPast] = useState<ImportRecord[]>([])
  const picker = useRef<HTMLInputElement>(null)
  const child = kids.find((c) => c.id === childId) ?? kids[0]

  useEffect(() => {
    if (!open) return
    setStep('choose')
    setError(null)
    setSaved(null)
    setProgress(null)
    void listImports().then(setPast)
  }, [open])

  const input: Input | null = file?.input ?? (text.trim() ? { kind: 'text', text } : null)

  const run = (inp: Input, a: Answers): ParseResult => {
    const prefs = myPrefs()
    return parseLog(inp, {
      timeZone: tz,
      birthDate: child?.birth_date ?? null,
      order: a.order ?? prefs.dateOrder,
      fallbackOrder: tz.startsWith('America/') ? 'mdy' : 'dmy',
      undatedDay: a.undatedDay ? toYmd(a.undatedDay) : undefined,
      now: Date.now(),
      vocab: { ...familyVocab(), ...a.words },
      feedDefault: a.feedDefault ?? prefs.feedDefault,
      skipWords: namesToSkip(),
    })
  }

  const toReview = async (r: ParseResult) => {
    setStep('reading')
    // Older history helps spot entries already in Leela; don't wait forever for it.
    await Promise.race([loadAllHistory(), new Promise((r) => setTimeout(r, 8000))])
    const events = Object.values(useLeela.getState().events)
    setDrafts(markDuplicates(r.drafts, events, child!.id))
    setResult(r)
    setStep('review')
  }

  const read = async () => {
    if (!input || !child) return
    setError(null)
    setStep('reading')
    await new Promise((res) => setTimeout(res, 40))
    let r: ParseResult
    try {
      r = run(input, answers)
    } catch {
      setError('Something in that file tripped Leela up. Try pasting the text instead.')
      setStep('choose')
      return
    }
    if (!r.drafts.length && !r.unknown.length) {
      setError(
        r.unread.length
          ? 'Leela couldn’t find any baby entries in that. Entries need a time or a date and what happened, like “6:30 fed 60 ml”.'
          : 'That looks empty.',
      )
      setStep('choose')
      return
    }
    const prefs = myPrefs()
    const qs: Q[] = []
    if (r.hasNumericDates && !r.orderCertain && !prefs.dateOrder) qs.push({ kind: 'order' })
    if (r.undated) qs.push({ kind: 'day' })
    for (const u of r.unknown.slice(0, 6)) qs.push({ kind: 'word', term: u.term, count: u.count, examples: u.examples })
    if (r.guessedFeeds > 0 && !prefs.feedDefault) qs.push({ kind: 'feed', count: r.guessedFeeds })
    setResult(r)
    if (qs.length) {
      setAsked(qs)
      setAnswers((a) => ({ ...a, undatedDay: a.undatedDay ?? dayKey(Date.now(), tz) }))
      setStep('ask')
    } else await toReview(r)
  }

  const answerAndContinue = async () => {
    if (!input) return
    const words = Object.fromEntries(Object.entries(answers.words).filter(([, v]) => v))
    await learnWords(words)
    const patch: { dateOrder?: 'dmy' | 'mdy'; feedDefault?: 'nursing' | 'bottle' } = {}
    if (answers.order) patch.dateOrder = answers.order
    if (answers.feedDefault) patch.feedDefault = answers.feedDefault
    if (Object.keys(patch).length) await savePrefs(patch)
    await toReview(run(input, answers))
  }

  const chooseFile = async (f: File | undefined) => {
    if (!f) return
    setError(null)
    setOpening(true)
    try {
      const read = await readImportFile(f)
      if (!read.chars) throw new ImportFileError('That file looks empty.')
      setFile(read)
    } catch (e) {
      setError(e instanceof ImportFileError ? e.message : 'That file couldn’t be opened. Try saving it as PDF or Word, or paste the text.')
    } finally {
      setOpening(false)
      if (picker.current) picker.current.value = ''
    }
  }

  const save = async () => {
    if (!result || !child) return
    setStep('saving')
    setProgress({ done: 0, total: drafts.filter((d) => d.include).length })
    try {
      const res = await commitImport({ drafts, childId: child.id, fileName: file?.name ?? 'Pasted text', reader: result.reader, onProgress: (done, total) => setProgress({ done, total }) })
      setSaved(res)
      setStep('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Saving stopped.')
      setStep('review')
    }
  }

  const undo = async (id: string) => {
    try {
      const n = await undoImport(id)
      toast({ text: `Import undone. ${n} ${n === 1 ? 'entry' : 'entries'} removed.` })
      setPast(await listImports())
    } catch (e) {
      toast({ text: `Couldn’t undo: ${e instanceof Error ? e.message : 'unknown error'}`, tone: 'error' })
    }
  }

  const close = () => {
    setFile(null)
    setText('')
    setResult(null)
    setDrafts([])
    onClose()
  }

  // ------------------------------------------------------------------ render
  const includedCount = drafts.filter((d) => d.include).length
  let title = 'Bring in past logs'
  let footer: React.ReactNode = (
    <Button className="w-full" disabled={!input || opening || !child} onClick={() => void read()}>
      Read it
    </Button>
  )
  let onBack: (() => boolean) | undefined
  let body: React.ReactNode

  if (step === 'ask' && result) {
    title = 'A few quick questions'
    onBack = () => {
      setStep('choose')
      return true
    }
    footer = (
      <Button className="w-full" onClick={() => void answerAndContinue()}>
        Continue
      </Button>
    )
    body = (
      <>
        <p className="mb-5 text-[16px] text-ink-2">
          Leela read {result.drafts.length} {result.drafts.length === 1 ? 'entry' : 'entries'}. Answer what you can so it reads the rest right. It remembers your answers for next time, on both your phones.
        </p>
        {asked.map((q) => (
          <QuestionCard key={q.kind === 'word' ? `w-${q.term}` : q.kind} q={q} answers={answers} setAnswers={setAnswers} birthDate={child?.birth_date ?? null} maxDay={dayKey(Date.now(), tz)} />
        ))}
      </>
    )
  } else if (step === 'review' && result) {
    title = 'Check before saving'
    onBack = () => {
      setStep('choose')
      return true
    }
    footer = (
      <Button className="w-full" disabled={!includedCount} onClick={() => void save()}>
        Save {includedCount} {includedCount === 1 ? 'entry' : 'entries'}
      </Button>
    )
    body = (
      <Review
        result={result}
        drafts={drafts}
        setDrafts={setDrafts}
        error={error}
        onReorder={(order) => {
          if (!input) return
          const next = { ...answers, order }
          setAnswers(next)
          void savePrefs({ dateOrder: order })
          void toReview(run(input, next))
        }}
      />
    )
  } else if (step === 'reading') {
    title = 'Reading'
    footer = undefined
    onBack = () => true
    body = (
      <div className="grid place-items-center py-20 text-center" aria-live="polite">
        <span className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-line border-t-brand" aria-hidden="true" />
        <p className="text-[17px] font-semibold">Reading your log…</p>
        <p className="text-[15px] text-ink-2">This happens on your phone. Nothing is uploaded.</p>
      </div>
    )
  } else if (step === 'saving') {
    title = 'Saving'
    footer = undefined
    onBack = () => true
    body = progress && (
      <div className="py-16" aria-live="polite">
        <p className="mb-3 text-center text-[17px] font-semibold">
          Saving {progress.done} of {progress.total}…
        </p>
        <div className="h-3 overflow-hidden rounded-full bg-card-2">
          <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
        </div>
      </div>
    )
  } else if (step === 'done' && saved) {
    title = 'Saved'
    footer = undefined
    body = (
      <div className="py-10 text-center">
        <CheckCircle size={64} weight="duotone" className="mx-auto mb-3 text-[var(--growth)]" aria-hidden="true" />
        <h2 className="font-display text-[26px] font-bold leading-tight">
          {saved.saved} {saved.saved === 1 ? 'entry' : 'entries'} added
        </h2>
        <p className="mx-auto mb-8 max-w-[34ch] text-[16px] text-ink-2">They’re in History, day by day, and in the diary. Your partner sees them too.</p>
        <div className="mx-auto flex max-w-[320px] flex-col gap-2">
          <Button
            onClick={() => {
              useLeela.getState().set({ tab: 'history' })
              close()
            }}
          >
            See History
          </Button>
          <Button variant="secondary" onClick={() => void undo(saved.importId).then(close)}>
            <ArrowCounterClockwise size={18} weight="bold" aria-hidden="true" /> Undo this import
          </Button>
        </div>
      </div>
    )
  } else {
    body = (
      <>
        <p className="mb-5 text-[16px] text-ink-2">
          Add what you wrote down before Leela: a Google Doc, a Word file, a PDF, a spreadsheet or a WhatsApp chat. Leela sorts it into sleep, feeds, diapers and the rest, and shows you everything before saving.
        </p>

        {kids.length > 1 && (
          <div className="mb-5">
            <div className="mb-2 text-[15px] font-semibold text-ink-2">Whose log is this?</div>
            <Choices options={kids.map((k) => ({ id: k.id, label: k.name }))} value={child?.id} onChange={(v) => v && setChildId(v)} />
          </div>
        )}

        <section className="mb-4 rounded-[26px] bg-card p-5" aria-labelledby="file-h">
          <h2 id="file-h" className="mb-1 font-display text-[19px] font-bold">
            Upload a file
          </h2>
          <p className="mb-4 text-[14px] text-ink-2">PDF, Word (.docx), Excel, CSV, text or a WhatsApp chat export.</p>
          {file ? (
            <div className="flex items-center gap-3 rounded-2xl bg-card-2 px-4 py-3">
              <FileText size={26} weight="duotone" className="shrink-0 text-brand" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-semibold">{file.name}</span>
                <span className="block text-[13px] text-ink-2">Ready to read</span>
              </span>
              <button type="button" onClick={() => setFile(null)} className="grid h-10 w-10 place-items-center rounded-full" aria-label="Remove file">
                <X size={18} weight="bold" />
              </button>
            </div>
          ) : (
            <Button variant="secondary" className="w-full" disabled={opening} onClick={() => picker.current?.click()}>
              {opening ? 'Opening…' : 'Choose a file'}
            </Button>
          )}
          <input ref={picker} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => void chooseFile(e.target.files?.[0])} aria-label="Choose a file to import" />
          <details className="mt-4 text-[14px] text-ink-2">
            <summary className="cursor-pointer font-semibold">Getting it out of Google Docs or WhatsApp</summary>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>Google Docs app: open the doc, tap ⋮, then Share & export, then Save as Word (.docx).</li>
              <li>Google Docs on a computer: File, then Download, then PDF or Microsoft Word.</li>
              <li>Google Sheets: File, then Download, then CSV.</li>
              <li>WhatsApp: open the chat, tap ⋮ (or the name on iPhone), then Export chat, Without media.</li>
            </ul>
          </details>
        </section>

        {!file && (
          <section className="mb-4 rounded-[26px] bg-card p-5" aria-labelledby="paste-h">
            <h2 id="paste-h" className="mb-1 font-display text-[19px] font-bold">
              Or paste it
            </h2>
            <p className="mb-3 text-[14px] text-ink-2">Shorthand is fine. Leela knows bf, ebm, ff, wd, dd, tt, pcm and lots more, and learns yours.</p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={9}
              placeholder={'12 Aug\n6:30 am – bf L 10, R 8\n7:15 wet + dirty\n8:00–9:30 nap in cot\n9:45 fed 60 ml formula'}
              className="w-full resize-y rounded-2xl border border-line bg-card-2 px-4 py-3 text-[16px] outline-none placeholder:text-ink-3 focus:border-brand"
              aria-label="Paste your log"
            />
          </section>
        )}

        {error && (
          <p role="alert" className="mb-4 rounded-2xl bg-[var(--health-soft)] px-4 py-3 text-[15px] text-[var(--health)]">
            {error}
          </p>
        )}

        {past.length > 0 && (
          <section className="mt-6" aria-labelledby="past-h">
            <h2 id="past-h" className="mb-2 font-display text-[18px] font-bold">
              Past imports
            </h2>
            <ul className="divide-y divide-line rounded-[22px] bg-card px-4">
              {past.map((p) => {
                const total = Object.values(p.counts ?? {}).reduce((a, b) => a + b, 0)
                return (
                  <li key={p.id} className="flex items-center gap-3 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold">{p.file_name || 'Pasted text'}</span>
                      <span className="block text-[13px] text-ink-2">
                        {fmtShortDate(p.created_at, tz)}, {total} {total === 1 ? 'entry' : 'entries'}
                        {p.status === 'undone' ? ', undone' : ''}
                      </span>
                    </span>
                    {p.status === 'saved' && (
                      <Button size="sm" variant="secondary" onClick={() => void undo(p.id)}>
                        Undo
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </>
    )
  }

  return (
    <Overlay open={open} onClose={close} onBack={onBack} title={title} footer={footer}>
      {body}
    </Overlay>
  )
}

// ---------------------------------------------------------------------------- questions
function QuestionCard({
  q,
  answers,
  setAnswers,
  birthDate,
  maxDay,
}: {
  q: Q
  answers: Answers
  setAnswers: React.Dispatch<React.SetStateAction<Answers>>
  birthDate: string | null
  maxDay: string
}) {
  const [more, setMore] = useState(false)
  const card = 'mb-4 rounded-[26px] bg-card p-5'
  if (q.kind === 'order') {
    return (
      <section className={card}>
        <h2 className="mb-3 font-display text-[19px] font-bold leading-snug">How are dates written in this log?</h2>
        <Choices
          options={[
            { id: 'dmy', label: '05/08 is 5 August' },
            { id: 'mdy', label: '05/08 is May 8' },
          ]}
          value={answers.order}
          onChange={(v) => setAnswers((a) => ({ ...a, order: v }))}
          columns={1}
        />
      </section>
    )
  }
  if (q.kind === 'day') {
    return (
      <section className={card}>
        <h2 className="mb-1 font-display text-[19px] font-bold leading-snug">Which day is this from?</h2>
        <p className="mb-3 text-[15px] text-ink-2">There are no dates in it, so everything goes on one day.</p>
        <input
          type="date"
          value={answers.undatedDay ?? ''}
          min={birthDate ?? undefined}
          max={maxDay}
          onChange={(e) => setAnswers((a) => ({ ...a, undatedDay: e.target.value || a.undatedDay }))}
          className="h-13 w-full rounded-2xl border border-line bg-card-2 px-4 text-[17px]"
          aria-label="Day of these entries"
        />
      </section>
    )
  }
  if (q.kind === 'feed') {
    return (
      <section className={card}>
        <h2 className="mb-1 font-display text-[19px] font-bold leading-snug">When it just says “fed”, what does that mean?</h2>
        <p className="mb-3 text-[15px] text-ink-2">
          {q.count} {q.count === 1 ? 'entry says' : 'entries say'} only that.
        </p>
        <Choices
          options={[
            { id: 'nursing', label: 'Breastfeed' },
            { id: 'bottle', label: 'Bottle' },
          ]}
          value={answers.feedDefault}
          onChange={(v) => setAnswers((a) => ({ ...a, feedDefault: v }))}
          tone="feed"
          columns={2}
        />
      </section>
    )
  }
  const ranked = rankMeanings(q.examples)
  const shown = more ? ranked : ranked.slice(0, 6)
  const value = answers.words[q.term]
  return (
    <section className={card}>
      <div className="mb-2 flex items-start gap-2">
        <Question size={22} weight="duotone" className="mt-1 shrink-0 text-brand" aria-hidden="true" />
        <h2 className="font-display text-[19px] font-bold leading-snug">What does “{q.term}” mean?</h2>
      </div>
      <ul className="mb-3 space-y-1">
        {q.examples.slice(0, 2).map((ex) => (
          <li key={ex} className="truncate rounded-xl bg-card-2 px-3 py-1.5 text-[14px] text-ink-2">
            {ex}
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={`Meaning of ${q.term}`}>
        {shown.map((id) => {
          const m = MEANINGS.find((x) => x.id === id)!
          const on = value === id
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setAnswers((a) => ({ ...a, words: { ...a.words, [q.term]: on ? '' : id } }))}
              className={clsx('min-h-11 rounded-2xl px-3 py-2 text-[15px] font-semibold leading-tight', on ? 'bg-brand text-brand-ink' : 'bg-card-2 ring-1 ring-line', id === 'ignore' && 'col-span-2')}
            >
              {m.label}
            </button>
          )
        })}
      </div>
      {!more && (
        <button type="button" onClick={() => setMore(true)} className="mt-3 text-[14px] font-semibold text-ink-2 underline underline-offset-4">
          Something else
        </button>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------- review
function Review({
  result,
  drafts,
  setDrafts,
  error,
  onReorder,
}: {
  result: ParseResult
  drafts: Draft[]
  setDrafts: React.Dispatch<React.SetStateAction<Draft[]>>
  error: string | null
  onReorder: (order: 'dmy' | 'mdy') => void
}) {
  const family = useLeela((s) => s.family)!
  const prefs = myPrefs()
  const tz = family.timezone
  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [showUnread, setShowUnread] = useState(false)

  const days = useMemo(() => {
    const map = new Map<string, Draft[]>()
    for (const d of drafts) {
      const k = dayKey(d.start, tz)
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(d)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [drafts, tz])
  useEffect(() => {
    setOpenDays(new Set(days.slice(0, 2).map(([k]) => k)))
    // Only when a new result arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  const types = useMemo(() => {
    const m = new Map<EventType, { total: number; on: number }>()
    for (const d of drafts) {
      const c = m.get(d.type) ?? { total: 0, on: 0 }
      c.total++
      if (d.include) c.on++
      m.set(d.type, c)
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total)
  }, [drafts])
  const count = (f: Flag) => drafts.filter((d) => d.flags.includes(f)).length
  const first = drafts[0]?.start
  const last = drafts[drafts.length - 1]?.start
  const setType = (t: EventType, on: boolean) =>
    setDrafts((ds) => ds.map((d) => (d.type !== t ? d : { ...d, include: on && !d.flags.some((f) => BLOCKING.includes(f)) })))
  const editingDraft = drafts.find((d) => d.key === editing)

  return (
    <>
      <section className="mb-4 rounded-[26px] bg-card p-5">
        <h2 className="font-display text-[24px] font-bold leading-tight">
          {drafts.length} {drafts.length === 1 ? 'entry' : 'entries'} found
        </h2>
        {first !== undefined && last !== undefined && (
          <p className="mb-4 text-[15px] text-ink-2">
            {fmtLongDate(first, tz)}
            {dayKey(first, tz) !== dayKey(last, tz) ? ` to ${fmtLongDate(last, tz)}` : ''}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {types.map(([t, c]) => {
            const on = c.on > 0
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() => setType(t, !on)}
                className={clsx('flex h-10 items-center gap-1.5 rounded-full pr-3.5 pl-2 text-[14px] font-semibold', !on && 'opacity-50')}
                style={{ background: toneSoft(TYPES[t].tone), color: toneVar(TYPES[t].tone) }}
              >
                <TypeIcon type={t} size={18} />
                <span className="text-ink">
                  {TYPES[t].label} <span className="num">{c.on}</span>
                </span>
              </button>
            )
          })}
        </div>
        <p className="mt-3 text-[13px] text-ink-3">Tap a kind to leave all of it out, or tap any entry to fix it.</p>
      </section>

      <ul className="mb-4 space-y-2 text-[15px]">
        {result.hasNumericDates && (
          <li className="rounded-2xl bg-card-2 px-4 py-3">
            Dates read as {result.order === 'dmy' ? 'day/month (05/08 is 5 August)' : 'month/day (05/08 is May 8)'}.{' '}
            <button type="button" className="font-semibold text-brand underline underline-offset-4" onClick={() => onReorder(result.order === 'dmy' ? 'mdy' : 'dmy')}>
              Switch
            </button>
          </li>
        )}
        {count('duplicate') > 0 && <li className="rounded-2xl bg-card-2 px-4 py-3">{count('duplicate')} already in Leela, so they’re left out.</li>}
        {count('no_time') > 0 && <li className="rounded-2xl bg-card-2 px-4 py-3">{count('no_time')} had no time written, so they’re placed at noon. Tap one to set its time.</li>}
        {count('no_end') > 0 && <li className="rounded-2xl bg-card-2 px-4 py-3">{count('no_end')} sleeps have no wake-up time and are left out.</li>}
        {count('guessed_feed') > 0 && !prefs.feedDefault && <li className="rounded-2xl bg-card-2 px-4 py-3">{count('guessed_feed')} just say “fed” and are saved as {drafts.find((d) => d.flags.includes('guessed_feed'))?.type === 'bottle' ? 'bottles' : 'breastfeeds'}.</li>}
        {result.unread.length > 0 && (
          <li className="rounded-2xl bg-card-2 px-4 py-3">
            {result.unread.length} {result.unread.length === 1 ? 'line wasn’t' : 'lines weren’t'} read as entries.{' '}
            <button type="button" className="font-semibold text-brand underline underline-offset-4" onClick={() => setShowUnread((v) => !v)}>
              {showUnread ? 'Hide' : 'Show'}
            </button>
            {showUnread && (
              <ul className="mt-2 space-y-1">
                {result.unread.slice(0, 200).map((u) => (
                  <li key={`${u.line}-${u.text}`} className="text-[14px] text-ink-2">
                    <span className="num text-ink-3">{u.line}</span> {u.text}
                    {u.reason === 'totals' ? ' (a daily total)' : u.reason === 'no_date' ? ' (before the first date)' : ''}
                  </li>
                ))}
              </ul>
            )}
          </li>
        )}
      </ul>

      {error && (
        <p role="alert" className="mb-4 rounded-2xl bg-[var(--health-soft)] px-4 py-3 text-[15px] text-[var(--health)]">
          {error}
        </p>
      )}

      <ol className="space-y-2">
        {days.map(([k, list]) => {
          const isOpen = openDays.has(k)
          const on = list.filter((d) => d.include).length
          return (
            <li key={k} className="overflow-hidden rounded-[22px] bg-card">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpenDays((s) => {
                  const n = new Set(s)
                  if (n.has(k)) n.delete(k)
                  else n.add(k)
                  return n
                })}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-semibold">{dayLabel(list[0].start, tz)}</span>
                  <span className="block text-[13px] text-ink-2">
                    {on} of {list.length} to save
                  </span>
                </span>
                <CaretDown size={18} weight="bold" className={clsx('transition-transform', isOpen && 'rotate-180')} aria-hidden="true" />
              </button>
              {isOpen && (
                <ul className="divide-y divide-line border-t border-line px-4">
                  {list.map((d) => {
                    const e = asEvent(d)
                    const detail = eventDetail(e, [], prefs, Date.now())
                    const note = d.flags.filter((f) => f !== 'guessed_feed' || !prefs.feedDefault).map((f) => FLAG_TEXT[f])
                    return (
                      <li key={d.key} className="flex items-start gap-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={d.include}
                          onChange={(ev) => setDrafts((ds) => ds.map((x) => (x.key === d.key ? { ...x, include: ev.target.checked } : x)))}
                          className="mt-1.5 h-5 w-5 shrink-0 accent-[var(--brand)]"
                          aria-label={`Save ${eventTitle(e, family)} at ${fmtTime(d.start, tz)}`}
                        />
                        <button type="button" onClick={() => setEditing(d.key)} className={clsx('flex min-w-0 flex-1 items-start gap-3 text-left', !d.include && 'opacity-55')}>
                          <span className="num w-[66px] shrink-0 whitespace-nowrap pt-0.5 text-[15px] font-semibold">{d.flags.includes('no_time') ? '–' : fmtTime(d.start, tz)}</span>
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl" style={{ background: toneSoft(TYPES[d.type].tone), color: toneVar(TYPES[d.type].tone) }}>
                            <TypeIcon type={d.type} kind={d.data.kind as string | undefined} size={18} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[15px] font-semibold leading-snug">
                              {eventTitle(e, family)}
                              {detail && <span className="font-normal text-ink-2">, {detail}</span>}
                            </span>
                            <span className="block truncate text-[13px] text-ink-3">“{d.source}”</span>
                            {note.length > 0 && <span className="block text-[13px] font-semibold text-[var(--feed)]">{note.join(', ')}</span>}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ol>

      {editingDraft && (
        <DraftSheet
          draft={editingDraft}
          unknown={result.unknown.map((u) => u.term)}
          onClose={() => setEditing(null)}
          onChange={(next) => setDrafts((ds) => ds.map((x) => (x.key === next.key ? next : x)))}
        />
      )}
    </>
  )
}

function DraftSheet({ draft, unknown, onClose, onChange }: { draft: Draft; unknown: string[]; onClose: () => void; onChange: (d: Draft) => void }) {
  const family = useLeela((s) => s.family)!
  const toast = useLeela((s) => s.toast)
  const tz = family.timezone
  const [d, setD] = useState(draft)
  const words = unknown.filter((t) => new RegExp(`(?<![\\p{L}\\d])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\d])`, 'iu').test(d.source))
  const meaning = meaningForDraft(d)
  const types = Object.values(TYPES).filter((t) => t.type !== 'contraction')
  return (
    <Sheet
      open
      onClose={onClose}
      title="Fix this entry"
      footer={
        <Button
          className="w-full"
          onClick={() => {
            onChange({ ...d, flags: d.flags.filter((f) => f !== 'no_time' || d.start !== draft.start) })
            onClose()
          }}
        >
          Done
        </Button>
      }
    >
      <p className="mb-4 rounded-2xl bg-card-2 px-4 py-3 text-[15px] text-ink-2">“{d.source}”</p>
      <label className="mb-2 block text-[15px] font-semibold text-ink-2" htmlFor="draft-type">
        What is it
      </label>
      <select
        id="draft-type"
        value={d.type}
        onChange={(e) => {
          const type = e.target.value as EventType
          setD({ ...d, type, data: type === d.type ? d.data : {}, flags: d.flags.filter((f) => f !== 'guessed_feed') })
        }}
        className="mb-5 h-13 w-full rounded-2xl border border-line bg-card-2 px-3 text-[17px]"
      >
        {types.map((t) => (
          <option key={t.type} value={t.type}>
            {t.label}
          </option>
        ))}
      </select>
      <label className="mb-2 block text-[15px] font-semibold text-ink-2" htmlFor="draft-when">
        When
      </label>
      <input
        id="draft-when"
        type="datetime-local"
        value={toLocalInput(d.start, tz)}
        onChange={(e) => {
          const at = fromLocalInput(e.target.value, tz)
          if (!at) return
          const shift = at.getTime() - d.start
          setD({ ...d, start: at.getTime(), end: d.end ? d.end + shift : null })
        }}
        className="mb-5 h-13 w-full rounded-2xl border border-line bg-card-2 px-3 text-[17px]"
      />
      <div className="mb-5">
        <Toggle label="Save this entry" checked={d.include} onChange={(v) => setD({ ...d, include: v })} />
      </div>
      {meaning &&
        words.map((w) => (
          <Button
            key={w}
            variant="secondary"
            size="md"
            className="mb-2 w-full"
            onClick={() => {
              void learnWords({ [w]: meaning })
              toast({ text: `Leela will read “${w}” as ${MEANINGS.find((m) => m.id === meaning)?.label.toLowerCase()} from now on.` })
            }}
          >
            Always read “{w}” as {MEANINGS.find((m) => m.id === meaning)?.label.toLowerCase()}
          </Button>
        ))}
    </Sheet>
  )
}
