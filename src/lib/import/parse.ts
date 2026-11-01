// Turns pasted text or a spreadsheet into Leela entries, ready to check before saving.
import { TZDate } from '@date-fns/tz'
import type { EventData, EventType } from '../types'
import { classify, clauses, type Piece } from './classify'
import { expand, unknownTerms, type UnknownTerm, type Vocab } from './vocab'
import {
  dateAtStart,
  detectOrder,
  findDuration,
  findTimes,
  rangeAfter,
  resolveDate,
  resolveDay,
  resolveEnd,
  type DateOrder,
  type DateToken,
  type TimeToken,
  type Ymd,
} from './dates'

export type Flag = 'no_time' | 'approx_time' | 'no_end' | 'before_birth' | 'future' | 'guessed_feed' | 'duplicate'

export interface Draft {
  key: string
  type: EventType
  start: number
  end: number | null
  data: EventData
  notes: string | null
  /** The line it came from, as written. */
  source: string
  line: number
  include: boolean
  flags: Flag[]
}

export interface Unread {
  line: number
  text: string
  reason: 'unknown' | 'totals' | 'no_date'
}

export interface ParseResult {
  drafts: Draft[]
  unread: Unread[]
  order: DateOrder
  orderCertain: boolean
  hasNumericDates: boolean
  /** No dates anywhere: everything was put on `undatedDay`. */
  undated: boolean
  reader: 'text' | 'columns'
  /** Short words Leela couldn't place: worth asking the parent about. */
  unknown: UnknownTerm[]
  /** Feeds written with no detail ("6:30 fed"), set to `feedDefault` or the family's usual. */
  guessedFeeds: number
}

export interface ParseOptions {
  timeZone: string
  /** YYYY-MM-DD */
  birthDate: string | null
  order?: DateOrder
  fallbackOrder: DateOrder
  undatedDay?: Ymd
  now: number
  /** Words this family has taught Leela: word -> meaning id. */
  vocab?: Vocab
  /** What a bare "fed" means for this family, once they've said. */
  feedDefault?: 'nursing' | 'bottle'
  /** Names and words never to ask about (the baby's name, the parents' names). */
  skipWords?: string[]
}

export type Input = { kind: 'text'; text: string } | { kind: 'rows'; rows: string[][] }

interface Rec {
  line: number
  source: string
  text: string
  /** The words as written, before shorthand is expanded: kept for notes on firsts and symptoms. */
  raw?: string
  /** Index into the list of date tokens; -1 before the first date. */
  dateIdx: number
  /** Table rows: times written in their own columns. */
  startText?: string
  endText?: string
  durationMin?: number
}

interface Item {
  rec: Rec
  start?: TimeToken
  end?: TimeToken
  pieces: Piece[]
  minutes?: number
  /** The time came from "this morning", "in the evening" and the like. */
  approx?: boolean
}

// "this morning", "in the evening": a rough time when nothing better is written.
const PART_OF_DAY: [RegExp, number][] = [
  [/\bearly (?:in the )?morning\b/i, 6 * 60],
  [/\bmorning\b/i, 9 * 60],
  [/\b(?:lunch ?time|after lunch)\b/i, 13 * 60],
  [/\bafternoon\b/i, 15 * 60],
  [/\bevening\b/i, 18 * 60],
  [/\b(?:tonight|at night|bed ?time)\b/i, 21 * 60],
]
function partOfDay(text: string): TimeToken | undefined {
  for (const [rx, min] of PART_OF_DAY) if (rx.test(text)) return { fixed: min, index: 0, end: 0 }
  return undefined
}

const ABBREV = /\b(?:dr|mr|mrs|ms|st|vs|approx|vit|no|nos|etc|e\.g|i\.e|min|mins|hrs?|wt|ht|temp)$/i
/** Prose ("She rolled over. Gave vit d at 9.") is read a sentence at a time. */
function sentences(line: string): string[] {
  const out: string[] = []
  let start = 0
  for (const m of line.matchAll(/([.!?])\s+(?=["“(]?[A-Z])/g)) {
    const before = line.slice(start, m.index! + 1)
    if (m[1] === '.' && ABBREV.test(line.slice(start, m.index!))) continue
    out.push(before.trim())
    start = m.index! + m[0].length
  }
  out.push(line.slice(start).trim())
  return out.filter(Boolean)
}

const ymdOf = (ms: number, tz: string): Ymd => {
  const d = new TZDate(ms, tz)
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }
}
const parseYmd = (s: string | null): Ymd | null => {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  return y && m && d ? { y, m, d } : null
}
const dayMs = (v: Ymd, minutes: number, tz: string) => {
  const extra = Math.floor(minutes / 1440)
  const mins = ((minutes % 1440) + 1440) % 1440
  return new TZDate(v.y, v.m - 1, v.d + extra, Math.floor(mins / 60), mins % 60, tz).getTime()
}
const monthsBetween = (birth: Ymd | null, v: Ymd) => (birth ? (v.y - birth.y) * 12 + (v.m - birth.m) + (v.d - birth.d) / 30 : null)

// --------------------------------------------------------------------------- tables
const HEAD = {
  datetime: /^(date ?\/? ?time|timestamp|when|start(?:ed)?(?: date)? ?(?:time)?|start time|time stamp)$/,
  date: /^(date|day|dated)$/,
  time: /^(time|at|start(?:ed)?|from|start time|time started)$/,
  end: /^(end|ended|to|until|finish(?:ed)?|stop(?:ped)?|end time|time ended|woke)$/,
  duration: /^(duration|length|how long|mins?|minutes|hours?|time spent|total time)$/,
  type: /^(type|activity|event|category|what|kind|entry|log|item)$/,
  amount: /^(amount|qty|quantity|volume|ml|oz|ounces|amount \(ml\)|amount \(oz\)|amount ml|amount oz)$/,
  notes: /^(notes?|comments?|details?|description|remarks?|info|start condition|end condition|start location|location|condition)$/,
}

function headerMap(row: string[]): Record<string, number[]> | null {
  const map: Record<string, number[]> = {}
  let hits = 0
  row.forEach((cell, i) => {
    const c = cell.trim().toLowerCase().replace(/[_*]/g, ' ').replace(/\s+/g, ' ')
    if (!c) return
    for (const [k, rx] of Object.entries(HEAD)) {
      if (rx.test(c)) {
        ;(map[k] ??= []).push(i)
        hits++
        return
      }
    }
    // Anything else (Side, Left, Right, Weight, Temperature...) is read as part of the entry.
    ;(map.extra ??= []).push(i)
  })
  return hits >= 2 && (map.date || map.datetime || map.time) ? map : null
}

function rowsToRecs(rows: string[][]): { recs: Rec[]; dateTokens: DateToken[]; table: boolean } {
  const clean = rows.map((r) => r.map((c) => (c ?? '').toString().trim())).filter((r) => r.some(Boolean))
  const headerAt = clean.slice(0, 5).findIndex((r) => headerMap(r) !== null)
  if (headerAt < 0) {
    // No header we recognise: treat each row as a line of text.
    return { ...textToRecs(clean.map((r) => r.filter(Boolean).join('  ')).join('\n')), table: false }
  }
  const header = clean[headerAt]
  const map = headerMap(header)!
  const recs: Rec[] = []
  const dateTokens: DateToken[] = []
  const amountUnit = (i: number) => (/oz|ounce/i.test(header[i]) ? 'oz' : /ml/i.test(header[i]) ? 'ml' : '')
  for (let r = headerAt + 1; r < clean.length; r++) {
    const row = clean[r]
    const cell = (k: string) => (map[k] ?? []).map((i) => row[i]).filter(Boolean)
    let dateText = cell('date')[0] ?? ''
    let startText = cell('time')[0] ?? ''
    // A date cell that also holds the time ("2026-08-12 09:00").
    const dateRest = dateText ? dateAtStart(dateText)?.rest : undefined
    if (!startText && dateRest && findTimes(dateRest).length) startText = dateRest
    const dt = cell('datetime')[0]
    if (dt) {
      const tok = dateAtStart(dt)
      if (tok) {
        dateText = dt
        startText = startText || tok.rest
      } else startText = startText || dt
    }
    let endText = cell('end')[0] ?? ''
    const endDate = endText ? dateAtStart(endText) : null
    if (endDate) endText = endDate.rest
    const durCell = cell('duration')[0]
    let durationMin: number | undefined
    if (durCell) {
      const hm = durCell.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
      durationMin = hm ? Number(hm[1]) * 60 + Number(hm[2]) : (findDuration(durCell)?.minutes ?? (/^\d+(\.\d+)?$/.test(durCell) ? Number(durCell) : undefined))
    }
    const amountCells = (map.amount ?? []).map((i) => (row[i] ? (/[a-z]/i.test(row[i]) ? row[i] : `${row[i]} ${amountUnit(i) || 'ml'}`) : '')).filter(Boolean)
    const extra = (map.extra ?? []).map((i) => (row[i] ? (/^\d+(\.\d+)?$/.test(row[i]) ? `${header[i]} ${row[i]}` : row[i]) : '')).filter(Boolean)
    const text = [...cell('type'), ...amountCells, ...extra, ...cell('notes')].join(' ')
    const tok = dateText ? dateAtStart(dateText) : null
    if (tok) dateTokens.push(tok)
    recs.push({ line: r + 1, source: row.filter(Boolean).join(' | '), text, dateIdx: tok ? dateTokens.length - 1 : -2, startText, endText, durationMin })
  }
  return { recs, dateTokens, table: true }
}

// --------------------------------------------------------------------------- text
// "[12/08/26, 6:32:10 AM] Priya: fed 90ml" (iPhone) or "12/08/2026, 08:15 - Priya: fed 90ml" (Android)
const WHATSAPP = /^\u200e?\[?(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}),?\s+(\d{1,2}[:.]\d{2}(?::\d{2})?\s*(?:[ap]\.?\s?m\.?)?)\]?\s*(?:[-–]\s*)?([^:]{1,40}?):\s?(.*)$/i
const WHATSAPP_NOISE = /<media omitted>|(image|video|audio|sticker|gif|document) omitted|this message was deleted|deleted this message|end-to-end encrypted|missed (voice|video) call|^null$/i

function whatsappToRecs(lines: string[]): { recs: Rec[]; dateTokens: DateToken[] } {
  const recs: Rec[] = []
  const dateTokens: DateToken[] = []
  let dateIdx = -1
  let startText: string | undefined
  lines.forEach((raw, i) => {
    const line = raw.replace(/[\u200e\u200f]/g, '').trim()
    if (!line) return
    const m = line.match(WHATSAPP)
    let text = line
    if (m) {
      const tok = dateAtStart(m[1])
      if (tok) {
        dateTokens.push(tok)
        dateIdx = dateTokens.length - 1
      }
      startText = m[2]
      text = m[4]
    }
    if (!text.trim() || WHATSAPP_NOISE.test(text)) return
    recs.push({ line: i + 1, source: line, text: text.trim(), dateIdx, startText })
  })
  return { recs, dateTokens }
}

function textToRecs(text: string): { recs: Rec[]; dateTokens: DateToken[] } {
  const recs: Rec[] = []
  const dateTokens: DateToken[] = []
  const lines = text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').split('\n')
  const filled = lines.filter((l) => l.trim())
  const chat = filled.filter((l) => WHATSAPP.test(l.replace(/[\u200e\u200f]/g, '').trim())).length
  if (filled.length && chat / filled.length > 0.3) return whatsappToRecs(lines)
  let dateIdx = -1
  lines.forEach((raw, i) => {
    const line = raw.replace(/\t+/g, '  ').trim()
    if (!line) return
    const tok = dateAtStart(line)
    let rest = line
    if (tok) {
      dateTokens.push(tok)
      dateIdx = dateTokens.length - 1
      rest = tok.rest
    }
    rest = rest.replace(/^[\s\-–—•*·>#]+/, '').trim()
    if (!rest || !/[a-z0-9]/i.test(rest)) return
    const parts = sentences(rest)
    for (const part of parts) recs.push({ line: i + 1, source: parts.length > 1 ? part : line, text: part, dateIdx })
  })
  return { recs, dateTokens }
}

// --------------------------------------------------------------------------- main
export function parseLog(input: Input, opts: ParseOptions): ParseResult {
  const { recs, dateTokens, table } = input.kind === 'rows' ? rowsToRecs(input.rows) : { ...textToRecs(input.text), table: false }
  for (const r of recs) {
    r.raw = r.text
    r.text = expand(r.text, opts.vocab)
    if (r.startText) r.startText = expand(r.startText, opts.vocab)
  }
  const birth = parseYmd(opts.birthDate)
  const today = ymdOf(opts.now, opts.timeZone)
  const detected = detectOrder(dateTokens, opts.fallbackOrder)
  const order = opts.order ?? detected.order
  const dates = dateTokens.map((t) => resolveDate(t, order, birth, today))
  const undated = dateTokens.length === 0
  const fallbackDay = opts.undatedDay ?? today

  const unread: Unread[] = []
  const items: Item[] = []

  for (const rec of recs) {
    if (rec.dateIdx === -1 && !undated) {
      unread.push({ line: rec.line, text: rec.source, reason: 'no_date' })
      continue
    }
    const before = items.length
    let reason: Unread['reason'] = 'unknown'
    let lineStart: TimeToken | undefined
    let prev: Item | undefined
    let prevText = ''
    const parts = clauses(rec.text)
    // Times written in their own column (spreadsheets) apply to the whole row.
    const rowStart = rec.startText ? (findTimes(rec.startText)[0] ?? asBareTime(rec.startText)) : undefined
    const rowEnd = rowStart && rec.endText ? (findTimes(rec.endText)[0] ?? asBareTime(rec.endText)) : undefined
    for (const part of parts) {
      let start: TimeToken | undefined
      let end: TimeToken | undefined
      let body = part
      if (rowStart) {
        start = rowStart
        end = rowEnd
        // "till 10:20" written in a notes cell still ends the entry.
        if (!end) {
          const t = findTimes(part)[0]
          if (t && /(?:-|–|—|to|till|until|upto|up to|woke(?: up)?(?: at)?)\s*$/i.test(part.slice(0, t.index))) {
            end = t
            body = blank(part, [t])
          }
        }
      } else {
        const times = findTimes(part)
        if (times.length) {
          start = times[0]
          if (rangeAfter(part, times[0], times[1])) end = times[1]
          // Take the times out so "6:30" isn't read as an amount.
          body = blank(part, times.slice(0, end ? 2 : 1))
          lineStart ??= start
        }
      }
      body = body.replace(/^\s*(?:at|@|from|around|approx\.?|~|by)\b\s*/i, '').replace(/\s+(?:at|@|from|around|by)\s*$/i, '')
      let approx = false
      if (!start && !prev?.start && !lineStart) {
        const guess = partOfDay(part)
        if (guess) {
          start = guess
          approx = true
          lineStart = guess
        }
      }
      const ctxDay = rec.dateIdx >= 0 ? dates[rec.dateIdx] : fallbackDay
      const verdict = classify(body, { ageMonths: ctxDay ? monthsBetween(birth, ctxDay) : null })
      if ('skip' in verdict) {
        if (verdict.skip === 'totals') reason = 'totals'
        // "green" after "dirty diaper", "in the cot" after "nap": a clause that only adds detail.
        if (prev && verdict.skip === 'unknown' && body.split(/\s+/).length <= 6) {
          const again = classify(`${prevText}, ${body}`, { ageMonths: ctxDay ? monthsBetween(birth, ctxDay) : null })
          const sameKinds = 'pieces' in again && again.pieces.map((p) => p.type).join() === prev.pieces.map((p) => p.type).join()
          if ('pieces' in again && sameKinds) {
            for (const [i, p] of again.pieces.entries()) p.durationMin ??= prev.pieces[i]?.durationMin
            prev.pieces = again.pieces
            prevText = `${prevText}, ${body}`
          }
        }
        continue
      }
      const item: Item = { rec, start: start ?? prev?.start ?? lineStart, end: start ? end : undefined, pieces: verdict.pieces, approx: approx || (!start && (prev?.approx ?? false)) }
      if (rec.durationMin !== undefined) for (const p of item.pieces) p.durationMin ??= rec.durationMin
      // Same moment, same kind of entry: "wet & dirty", "left 10, right 5", "dal, rice".
      if (prev && prev.start === item.start && mergeInto(prev, item)) {
        prevText = `${prevText}, ${body}`
        continue
      }
      items.push(item)
      prev = item
      prevText = body
    }
    if (items.length === before) unread.push({ line: rec.line, text: rec.source, reason })
  }

  // Which way does the log run inside a day? Most logs go forward; a few put the newest first.
  let up = 0
  let down = 0
  const byDay = new Map<number, Item[]>()
  for (const it of items) {
    const k = undated ? -1 : it.rec.dateIdx
    if (!byDay.has(k)) byDay.set(k, [])
    byDay.get(k)!.push(it)
  }
  for (const list of byDay.values()) {
    const fixed = list.map((i) => i.start?.fixed).filter((v): v is number => v !== undefined)
    for (let i = 1; i < fixed.length; i++) {
      if (fixed[i] > fixed[i - 1]) up++
      else if (fixed[i] < fixed[i - 1]) down++
    }
  }
  const reverse = down >= 3 && down > up * 1.5

  // Place every item on the clock.
  interface Placed {
    it: Item
    piece: Piece
    start: number
    end: number | null
    flags: Flag[]
  }
  const placed: Placed[] = []
  for (const [k, list] of byDay) {
    const day = k === -1 ? fallbackDay : dates[k]
    if (!day) {
      for (const it of list) unread.push({ line: it.rec.line, text: it.rec.source, reason: 'no_date' })
      continue
    }
    // Resolve each distinct start token once, in document order.
    const tokens: TimeToken[] = []
    for (const it of list) if (it.start && !it.approx && !tokens.includes(it.start)) tokens.push(it.start)
    const minutes = resolveDay(tokens, reverse)
    const minuteOf = new Map(tokens.map((t, i) => [t, minutes[i]]))
    for (const it of list) {
      const flags: Flag[] = []
      const startMin = it.start ? (it.approx ? it.start.fixed! : minuteOf.get(it.start)!) : 12 * 60
      if (!it.start) flags.push('no_time')
      else if (it.approx) flags.push('approx_time')
      const endMin: number | null = it.end ? resolveEnd(startMin, it.end) : null
      for (const piece of it.pieces) {
        let end = endMin
        if (end === null && piece.durationMin) end = startMin + piece.durationMin
        if (piece.type === 'nursing' && it.end && piece.data.left_s === undefined && piece.data.right_s === undefined && piece.data.total_s === undefined && endMin !== null) {
          piece.data.total_s = (endMin - startMin) * 60
        }
        placed.push({ it, piece, start: dayMs(day, startMin, opts.timeZone), end: end === null ? null : dayMs(day, end, opts.timeZone), flags: [...flags] })
      }
    }
  }
  placed.sort((a, b) => a.start - b.start || a.it.rec.line - b.it.rec.line)

  // Sleep written as "down at 8:10" ... "woke 10:40" becomes one sleep.
  const out: Placed[] = []
  let open: Placed | null = null
  const closeOpen = () => {
    if (open && open.end === null) open.flags.push('no_end')
    open = null
  }
  for (const p of placed) {
    if (p.piece.type !== 'sleep') {
      out.push(p)
      continue
    }
    if (p.piece.marker === 'wake') {
      if (open && p.start > open.start && p.start - open.start < 16 * 3600_000) {
        open.end = p.start
        if (p.piece.data.kind && !open.piece.data.kind) open.piece.data.kind = p.piece.data.kind
        open = null
      }
      continue
    }
    if (p.piece.marker === 'sleep_start' && p.end === null) {
      closeOpen()
      open = p
      out.push(p)
      continue
    }
    closeOpen()
    out.push(p)
  }
  closeOpen()

  // "6:30 fed" with no detail: what the family told us, else how this log usually feeds.
  const bottles = out.filter((p) => p.piece.type === 'bottle').length
  const nursing = out.filter((p) => p.piece.type === 'nursing').length
  const feedAs: EventType = opts.feedDefault ?? (bottles > nursing ? 'bottle' : 'nursing')
  let guessedFeeds = 0
  const birthMs = birth ? dayMs(birth, 0, opts.timeZone) : null
  const drafts: Draft[] = out.map((p, i) => {
    let type = p.piece.type as EventType | 'feed'
    const flags = p.flags
    if (type === 'feed') {
      type = feedAs
      guessedFeeds++
      if (!opts.feedDefault) flags.push('guessed_feed')
    }
    if (birthMs !== null && p.start < birthMs - 86_400_000) flags.push('before_birth')
    if (p.start > opts.now + 10 * 60_000) flags.push('future')
    let end = p.end
    if (end !== null && end <= p.start) end = null
    const include = !flags.some((f) => f === 'before_birth' || f === 'future' || f === 'no_end')
    return {
      key: `d${i}-${p.it.rec.line}`,
      type: type as EventType,
      start: p.start,
      end,
      data: p.piece.data,
      // Firsts, symptoms and visits keep the parent's own words.
      notes: (p.piece.notes ? (type === 'milestone' || type === 'symptom' ? (p.it.rec.raw ?? p.piece.notes) : p.piece.notes) : null)?.slice(0, 4000) ?? null,
      source: p.it.rec.source,
      line: p.it.rec.line,
      include,
      flags,
    }
  })

  // Words worth asking about: from lines that read like log entries but weren't fully understood.
  const understood = new Set(drafts.map((d) => d.line))
  const lines = recs.map((r) => ({ text: r.text, logLike: findTimes(r.text).length > 0 || Boolean(r.startText) || !understood.has(r.line) }))
  const skip = new Set((opts.skipWords ?? []).flatMap((w) => w.toLowerCase().split(/\s+/)).filter(Boolean))
  const unknown = unknownTerms(lines, KNOWN, skip).filter((t) => !isKnownWord(t.term)).slice(0, 8)

  return {
    drafts,
    unknown,
    guessedFeeds,
    unread: unread.sort((a, b) => a.line - b.line),
    order,
    orderCertain: detected.certain,
    hasNumericDates: detected.numeric,
    undated,
    reader: table ? 'columns' : 'text',
  }
}

const KNOWN = new Set<string>()
/** A word the reader understands by itself ("formula", "nap") never needs asking about. */
function isKnownWord(term: string): boolean {
  const v = classify(term, { ageMonths: null })
  return 'pieces' in v || ('skip' in v && v.skip === 'totals')
}

/** A time cell like "6:30" or "18:45" on its own. */
function asBareTime(text: string): TimeToken | undefined {
  const m = text.trim().match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?$/)
  if (!m) return undefined
  const h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  if (h > 23 || min > 59) return undefined
  return h === 0 || h > 12 || m[1].startsWith('0') ? { fixed: h * 60 + min, index: 0, end: text.length } : { h12: h, min, index: 0, end: text.length }
}

function blank(text: string, tokens: TimeToken[]): string {
  let s = text
  for (const t of [...tokens].sort((a, b) => b.index - a.index)) s = s.slice(0, t.index) + ' '.repeat(t.end - t.index) + s.slice(t.end)
  return s.replace(/\s+(?:-|–|—|to|till|until)\s+(?=\s*$)/i, ' ').replace(/^\s*(?:-|–|—)\s*/, '').replace(/\s+/g, ' ').trim()
}

/** Folds a clause into the one before it when they describe the same entry. */
function mergeInto(prev: Item, next: Item): boolean {
  if (prev.pieces.length !== 1 || next.pieces.length !== 1) return false
  const a = prev.pieces[0]
  const b = next.pieces[0]
  const isFeed = (t: string) => t === 'nursing' || t === 'bottle'
  // "Feed, Breast, L 10m": the vague word gives way to the specific one.
  if (a.type === 'feed' && isFeed(b.type)) {
    prev.pieces = [b]
    return true
  }
  if (isFeed(a.type) && b.type === 'feed') return true
  if (a.type !== b.type) return false
  switch (a.type) {
    case 'diaper': {
      const kinds = new Set([a.data.kind, b.data.kind].filter(Boolean))
      const wet = kinds.has('wet') || kinds.has('mixed')
      const dirty = kinds.has('dirty') || kinds.has('mixed')
      a.data = { ...b.data, ...a.data, kind: wet && dirty ? 'mixed' : wet ? 'wet' : dirty ? 'dirty' : (a.data.kind ?? b.data.kind) }
      return true
    }
    case 'nursing': {
      const sum = (x?: number, y?: number) => (x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0))
      const left = sum(a.data.left_s, b.data.left_s)
      const right = sum(a.data.right_s, b.data.right_s)
      a.data = { ...a.data, ...b.data }
      if (left !== undefined || right !== undefined) {
        a.data.left_s = left ?? 0
        a.data.right_s = right ?? 0
        delete a.data.total_s
      }
      a.durationMin = ((a.data.left_s ?? 0) + (a.data.right_s ?? 0)) / 60 || a.durationMin || b.durationMin
      return true
    }
    case 'solids':
      a.data = { ...a.data, ...b.data, foods: [...(a.data.foods ?? []), ...(b.data.foods ?? [])].slice(0, 8) }
      return true
    case 'bottle': {
      const contents = new Set([a.data.contents, b.data.contents].filter(Boolean))
      const amount = a.data.amount_ml === undefined && b.data.amount_ml === undefined ? undefined : (a.data.amount_ml ?? 0) + (b.data.amount_ml ?? 0)
      a.data = { ...a.data, contents: contents.size > 1 ? 'mixed' : (a.data.contents ?? b.data.contents) }
      if (amount !== undefined) a.data.amount_ml = amount
      if (!a.data.contents) delete a.data.contents
      return true
    }
    case 'growth':
      a.data = { ...a.data, ...b.data }
      return true
    case 'symptom':
      if (a.data.kind === 'vaccine' && b.data.kind === 'vaccine') {
        a.data = { ...a.data, vaccine: [a.data.vaccine, b.data.vaccine].filter(Boolean).join(', ') || undefined }
        a.notes = [a.notes, b.notes].filter(Boolean).join(', ')
        return true
      }
      if (a.data.kind !== 'symptom' || b.data.kind !== 'symptom') return false
      a.data = { ...a.data, tags: [...new Set([...(a.data.tags ?? []), ...(b.data.tags ?? [])])] }
      a.notes = [a.notes, b.notes].filter(Boolean).join(', ')
      return true
    default:
      return false
  }
}

