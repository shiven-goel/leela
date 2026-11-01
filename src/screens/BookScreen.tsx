import clsx from 'clsx'
import { Printer } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Overlay } from '../components/Overlay'
import { Button, Choices } from '../components/ui'
import { buildBook, type Book, type BookMemory, type BookMonth } from '../lib/book'
import { photoUrl } from '../lib/photos'
import { activeChild, myPrefs, useLeela } from '../lib/store'
import { loadAllHistory } from '../lib/sync'
import { durationText, fmtLongDate } from '../lib/time'
import { fmtLength, fmtWeight } from '../lib/units'
import type { Prefs } from '../lib/types'

type Size = 'A4' | 'A5'

// Fixed, print-safe colours: the book looks the same whatever theme the phone is in.
const INK = '#1b1f3b'
const INK2 = '#565b7d'
const ACCENT = '#3b2fb0'
const WARM = '#fbefd7'
const NOTE = '#efe8fa'

export function BookScreen({ open, onClose }: { open: boolean; onClose: () => void }) {
  const family = useLeela((s) => s.family)!
  const events = useLeela((s) => s.events)
  const segments = useLeela((s) => s.segments)
  const members = useLeela((s) => s.members)
  const profiles = useLeela((s) => s.profiles)
  const child = activeChild()
  const prefs = myPrefs()
  const [size, setSize] = useState<Size>('A4')
  const [loading, setLoading] = useState(true)
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    // Older months come from the server; if it's slow, make the book from what's on the phone.
    void Promise.race([loadAllHistory(), new Promise((r) => setTimeout(r, 8000))]).finally(() => setLoading(false))
  }, [open])

  const book = useMemo(
    () => (child && open ? buildBook(Object.values(events), Object.values(segments), child, family) : null),
    [events, segments, child, family, open],
  )
  const authors = members.map((m) => profiles[m.user_id]?.display_name).filter(Boolean) as string[]

  const print = async () => {
    setPrinting(true)
    // Let the print copy render and fetch every photo's address, then wait for the photos
    // themselves so none print blank.
    const until = Date.now() + 15000
    await new Promise((r) => setTimeout(r, 120))
    while (document.querySelector('.print-root [data-photo-pending]') && Date.now() < until) await new Promise((r) => setTimeout(r, 150))
    const imgs = [...document.querySelectorAll<HTMLImageElement>('.print-root img')]
    const ready = (img: HTMLImageElement) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((r) => {
            img.addEventListener('load', () => r(), { once: true })
            img.addEventListener('error', () => r(), { once: true })
          })
    await Promise.race([Promise.all(imgs.map(ready)), new Promise((r) => setTimeout(r, Math.max(1000, until - Date.now())))])
    window.print()
    setPrinting(false)
  }

  return (
    <Overlay
      open={open}
      onClose={onClose}
      title="Diary book"
      footer={
        <div className="space-y-3">
          <Choices
            options={[
              { id: 'A4', label: 'A4 pages' },
              { id: 'A5', label: 'A5, book size' },
            ]}
            value={size}
            onChange={(v) => v && setSize(v)}
            columns={2}
          />
          <Button className="w-full" tone="milestone" disabled={loading || printing || !book} onClick={() => void print()}>
            <Printer size={20} weight="bold" aria-hidden="true" /> {printing ? 'Getting photos ready…' : 'Save as PDF or print'}
          </Button>
          <p className="text-center text-[13px] text-ink-3">Your phone’s print screen opens. Choose Save as PDF. On iPhone, tap Share in the print screen, then Save to Files.</p>
        </div>
      }
    >
      {!child || !book ? null : loading ? (
        <div className="grid place-items-center py-20" aria-busy="true">
          <span className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-line border-t-brand" aria-hidden="true" />
          <p className="text-[16px] text-ink-2">Gathering everything since birth…</p>
        </div>
      ) : (
        <>
          <p className="mb-4 text-[15px] text-ink-2">
            {book.months.filter((m) => m.n > 0).length} {book.months.length === 1 ? 'month' : 'months'}, {book.counts.notes} notes, {book.counts.firsts} firsts and {book.counts.photos} photos. Here’s how it will look.
          </p>
          <div className="overflow-hidden rounded-[18px] bg-white shadow-lift ring-1 ring-line">
            <BookPages book={book} authors={authors} prefs={prefs} tz={family.timezone} preview />
          </div>
        </>
      )}
      {open &&
        book &&
        !loading &&
        createPortal(
          <div className="print-root">
            <style>{`@page { size: ${size} portrait; margin: ${size === 'A4' ? '16mm 15mm' : '12mm 11mm'}; }`}</style>
            <BookPages book={book} authors={authors} prefs={prefs} tz={family.timezone} size={size} />
          </div>,
          document.body,
        )}
    </Overlay>
  )
}

function BookPages({ book, authors, prefs, tz, preview, size = 'A4' }: { book: Book; authors: string[]; prefs: Prefs; tz: string; preview?: boolean; size?: Size }) {
  const scale = size === 'A5' ? 0.82 : 1
  const pt = (n: number) => `${Math.round(n * scale * 10) / 10}pt`
  return (
    <div className="book" style={{ color: INK, fontFamily: 'var(--font-sans)', fontSize: pt(11.5), lineHeight: 1.55, background: '#fff' }}>
      {/* Cover */}
      <Page preview={preview}>
        <div style={{ minHeight: preview ? 520 : '240mm', display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center' }}>
          {book.coverPhoto && (
            <div style={{ margin: '0 auto 28pt', width: '78%', aspectRatio: '4 / 5', borderRadius: 18, overflow: 'hidden', background: WARM }}>
              <BookPhoto path={book.coverPhoto} />
            </div>
          )}
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: pt(44), lineHeight: 1.05, color: ACCENT }}>{book.title}</div>
          {book.birth.date && <div style={{ marginTop: 10, fontSize: pt(15), color: INK2 }}>Born {fmtLongDate(`${book.birth.date}T12:00:00`, tz)}</div>}
          {authors.length > 0 && <div style={{ marginTop: 4, fontSize: pt(13), color: INK2 }}>Written by {listText(authors)}</div>}
        </div>
      </Page>

      {/* Hello, world */}
      {book.birth.date && (
        <Page preview={preview}>
          <H1 pt={pt}>Hello, world</H1>
          <p style={{ fontSize: pt(14), color: INK2, marginBottom: 18 }}>You arrived on {fmtLongDate(`${book.birth.date}T12:00:00`, tz)}.</p>
          {(book.birth.weight_kg ?? book.birth.length_cm ?? book.birth.head_cm) !== undefined && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <Stat pt={pt} label="Weight" value={book.birth.weight_kg !== undefined ? fmtWeight(book.birth.weight_kg) : '–'} />
            <Stat pt={pt} label="Length" value={book.birth.length_cm !== undefined ? fmtLength(book.birth.length_cm, prefs) : '–'} />
            <Stat pt={pt} label="Head" value={book.birth.head_cm !== undefined ? fmtLength(book.birth.head_cm, prefs) : '–'} />
          </div>}
        </Page>
      )}

      {book.months.map((m) => (
        <MonthChapter key={m.n} m={m} pt={pt} prefs={prefs} tz={tz} birth={book.birth.date} preview={preview} />
      ))}

      {book.growth.length > 1 && (
        <Page preview={preview}>
          <H1 pt={pt}>How you grew</H1>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: pt(11) }}>
            <thead>
              <tr style={{ textAlign: 'left', color: INK2 }}>
                <th style={TH}>Date</th>
                <th style={TH}>Weight</th>
                <th style={TH}>Length</th>
                <th style={TH}>Head</th>
              </tr>
            </thead>
            <tbody>
              {book.growth.map((g) => (
                <tr key={g.at} className="book-avoid">
                  <td style={TD}>{fmtLongDate(g.at, tz)}</td>
                  <td style={TD}>{g.weight_kg !== undefined ? fmtWeight(g.weight_kg) : ''}</td>
                  <td style={TD}>{g.length_cm !== undefined ? fmtLength(g.length_cm, prefs) : ''}</td>
                  <td style={TD}>{g.head_cm !== undefined ? fmtLength(g.head_cm, prefs) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Page>
      )}

      <Page preview={preview} last>
        <div style={{ textAlign: 'center', paddingTop: preview ? 40 : '90mm', color: INK2 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: pt(20), color: INK }}>To be continued</div>
          <div style={{ marginTop: 6, fontSize: pt(11) }}>Made {fmtLongDate(Date.now(), tz)} with Leela</div>
        </div>
      </Page>
    </div>
  )
}

function MonthChapter({ m, pt, prefs, tz, birth, preview }: { m: BookMonth; pt: (n: number) => string; prefs: Prefs; tz: string; birth: string | null; preview?: boolean }) {
  const perDay = (n: number) => (m.days >= 1 ? n / m.days : n)
  const t = m.totals
  const hasStats = t.feeds + t.diapers + t.sleepMs > 0
  const range = `${fmtLongDate(m.from, tz)} to ${fmtLongDate(m.to - 1, tz)}`
  return (
    <Page preview={preview}>
      <div className="book-avoid" style={{ marginBottom: 14 }}>
        <div style={{ fontSize: pt(11), color: INK2 }}>{m.n === 0 ? 'Before you were born' : range}</div>
        <H1 pt={pt}>{m.n === 0 ? 'Waiting for you' : `Month ${m.n}`}</H1>
        {m.n > 0 && birth && <div style={{ fontSize: pt(11), color: INK2, marginTop: -6 }}>{m.n === 1 ? 'Your first month' : `From ${m.n - 1} to ${m.n} months old`}</div>}
      </div>

      {m.n > 0 && hasStats && (
        <div className="book-avoid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
          <Stat pt={pt} label="Sleep a day" value={t.sleepMs ? durationText(perDay(t.sleepMs)) : '–'} />
          <Stat pt={pt} label="Feeds a day" value={t.feeds ? String(Math.round(perDay(t.feeds) * 10) / 10) : '–'} />
          <Stat pt={pt} label="Diapers a day" value={t.diapers ? String(Math.round(perDay(t.diapers) * 10) / 10) : '–'} />
          <Stat pt={pt} label="Weight" value={m.growth?.weight_kg !== undefined ? fmtWeight(m.growth.weight_kg) : '–'} />
        </div>
      )}

      {(m.firsts.length > 0 || m.newFoods.length > 0 || m.health.length > 0 || m.growth?.length_cm !== undefined) && (
        <div className="book-avoid" style={{ background: WARM, borderRadius: 14, padding: '10pt 12pt', marginBottom: 16 }}>
          {m.firsts.length > 0 && <Line pt={pt} label="Firsts" text={listText(m.firsts)} />}
          {m.newFoods.length > 0 && <Line pt={pt} label="New foods" text={listText(m.newFoods)} />}
          {m.growth?.length_cm !== undefined && <Line pt={pt} label="Length" text={fmtLength(m.growth.length_cm, prefs)} />}
          {m.health.length > 0 && <Line pt={pt} label="Health" text={m.health.join('; ')} />}
        </div>
      )}

      {m.memories.map((mem) => (
        <Memory key={mem.id} mem={mem} pt={pt} tz={tz} />
      ))}
      {m.memories.length === 0 && m.n > 0 && <p style={{ color: INK2, fontStyle: 'italic' }}>A quiet month in the diary. Add notes and photos in Leela and they’ll appear here.</p>}
    </Page>
  )
}

function Memory({ mem, pt, tz }: { mem: BookMemory; pt: (n: number) => string; tz: string }) {
  const photos = mem.photos
  return (
    <article style={{ marginBottom: 18 }}>
      <div className="book-avoid">
        <div style={{ fontSize: pt(10.5), color: INK2, marginBottom: mem.title ? 0 : 4 }}>{fmtLongDate(mem.at, tz)}</div>
        {mem.title && (
          <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: pt(17), lineHeight: 1.2, margin: '1pt 0 4pt' }}>
            {mem.kind === 'milestone' ? `★ ${mem.title}` : mem.title}
          </h3>
        )}
      </div>
      {mem.text && mem.text !== mem.title && (
        <div style={{ whiteSpace: 'pre-wrap', background: mem.kind === 'note' ? NOTE : 'transparent', borderRadius: 12, padding: mem.kind === 'note' ? '8pt 11pt' : 0, marginBottom: photos.length ? 8 : 0 }}>{mem.text}</div>
      )}
      {photos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: photos.length === 1 ? '1fr' : '1fr 1fr', gap: 6, marginTop: 6 }}>
          {photos.map((p) => (
            <div key={p} className="book-avoid" style={{ aspectRatio: photos.length === 1 ? '4 / 3' : '1 / 1', borderRadius: 12, overflow: 'hidden', background: WARM }}>
              <BookPhoto path={p} />
            </div>
          ))}
        </div>
      )}
    </article>
  )
}

function BookPhoto({ path }: { path: string }) {
  // undefined while the photo's address is being fetched, so printing can wait for it.
  const [url, setUrl] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    void photoUrl(path).then((u) => alive && setUrl(u))
    return () => {
      alive = false
    }
  }, [path])
  if (url === undefined) return <span data-photo-pending="" style={{ display: 'block', width: '100%', height: '100%' }} />
  return url ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : null
}

function Page({ children, preview, last }: { children: React.ReactNode; preview?: boolean; last?: boolean }) {
  return (
    <section className={clsx(!last && 'book-page')} style={preview ? { padding: '28px 22px', borderBottom: last ? 'none' : '1px dashed #dfe3f0' } : undefined}>
      {children}
    </section>
  )
}

function H1({ children, pt }: { children: React.ReactNode; pt: (n: number) => string }) {
  return <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: pt(30), lineHeight: 1.1, color: ACCENT, margin: '0 0 8pt' }}>{children}</h2>
}

function Stat({ label, value, pt }: { label: string; value: string; pt: (n: number) => string }) {
  return (
    <div style={{ border: '1px solid #dfe3f0', borderRadius: 12, padding: '7pt 9pt' }}>
      <div style={{ fontSize: pt(9.5), color: INK2 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: pt(16), lineHeight: 1.2 }}>{value}</div>
    </div>
  )
}

function Line({ label, text, pt }: { label: string; text: string; pt: (n: number) => string }) {
  return (
    <div style={{ fontSize: pt(11.5), margin: '1pt 0' }}>
      <span style={{ fontWeight: 700 }}>{label}:</span> {text}
    </div>
  )
}

const TH: React.CSSProperties = { padding: '5pt 4pt', borderBottom: '1px solid #dfe3f0', fontWeight: 600 }
const TD: React.CSSProperties = { padding: '4pt 4pt', borderBottom: '1px solid #eef0f7' }

function listText(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
