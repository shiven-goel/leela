// Reads the files parents are likely to have: Word, PDF, spreadsheets, plain text and web pages.
// All of it happens on the phone; the file itself is never uploaded.
import { strFromU8, unzipSync } from 'fflate'
import type { Input } from './parse'

export interface ReadFile {
  input: Input
  name: string
  /** Words of the file, for the "it looks empty" check. */
  chars: number
}

export class ImportFileError extends Error {}

const ext = (name: string) => name.toLowerCase().split('.').pop() ?? ''

export async function readImportFile(file: File): Promise<ReadFile> {
  const kind = ext(file.name)
  const name = file.name.slice(0, 200)
  if (file.size > 40 * 1024 * 1024) throw new ImportFileError('That file is over 40 MB. Split it into smaller parts and try again.')
  if (kind === 'doc') throw new ImportFileError('This is an old Word file (.doc). Open it and save it as .docx or PDF, then try again.')
  if (kind === 'pages' || kind === 'numbers') throw new ImportFileError('Export it from Pages or Numbers as PDF, Word or CSV first.')
  if (/^(jpe?g|png|heic|webp|gif)$/.test(kind)) throw new ImportFileError('That’s a photo. Leela reads text, so choose the document itself, or add photos from the Notes tab.')

  if (kind === 'docx') {
    const text = docxToText(new Uint8Array(await file.arrayBuffer()))
    return { input: { kind: 'text', text }, name, chars: text.trim().length }
  }
  if (kind === 'xlsx' || kind === 'xlsm') {
    const rows = xlsxToRows(new Uint8Array(await file.arrayBuffer()))
    return { input: { kind: 'rows', rows }, name, chars: rows.flat().join('').length }
  }
  if (kind === 'pdf') {
    const text = await pdfToText(new Uint8Array(await file.arrayBuffer()))
    if (!text.trim()) throw new ImportFileError('This PDF has no text in it, it looks like a scan or photo. Export the original document as PDF or Word instead.')
    return { input: { kind: 'text', text }, name, chars: text.trim().length }
  }
  const raw = await file.text()
  if (kind === 'csv' || kind === 'tsv') {
    const rows = csvToRows(raw)
    return { input: { kind: 'rows', rows }, name, chars: raw.length }
  }
  if (kind === 'html' || kind === 'htm') {
    const text = htmlToText(raw)
    return { input: { kind: 'text', text }, name, chars: text.trim().length }
  }
  if (kind === 'rtf') {
    const text = rtfToText(raw)
    return { input: { kind: 'text', text }, name, chars: text.trim().length }
  }
  // .txt, .md, WhatsApp exports and anything else that is text.
  if (/[\u0000-\u0008\u000e-\u001f]/.test(raw.slice(0, 2000))) throw new ImportFileError('Leela can’t read this kind of file. Try Word (.docx), PDF, CSV, Excel or plain text.')
  return { input: { kind: 'text', text: raw }, name, chars: raw.trim().length }
}

// --------------------------------------------------------------------------- xml helpers
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes)
  } catch {
    throw new ImportFileError('That file seems damaged or isn’t really a Word or Excel file.')
  }
}

// --------------------------------------------------------------------------- Word
/** Paragraphs become lines; table rows become lines with cells separated by tabs. */
export function docxToText(bytes: Uint8Array): string {
  const files = unzip(bytes)
  const doc = files['word/document.xml']
  if (!doc) throw new ImportFileError('That doesn’t look like a Word document.')
  const xml = strFromU8(doc)
  const out: string[] = []
  let para = ''
  let cell = ''
  let row: string[] = []
  let tableDepth = 0
  let inText = false
  const tag = /<(\/?)(w:p|w:tbl|w:tr|w:tc|w:t|w:tab|w:br|w:cr|w:delText)\b[^>]*?(\/?)>|([^<]+)/g
  for (const m of xml.matchAll(tag)) {
    const [, close, name, self, text] = m
    if (text !== undefined) {
      if (inText) para += decodeXml(text)
      continue
    }
    if (name === 'w:t') {
      inText = !close && !self
      continue
    }
    if (name === 'w:delText') continue
    if (name === 'w:tab' && !close) para += '\t'
    else if ((name === 'w:br' || name === 'w:cr') && !close) para += '\n'
    else if (name === 'w:p' && (close || self)) {
      if (tableDepth > 0) cell += (cell ? ' ' : '') + para.trim()
      else out.push(para)
      para = ''
    } else if (name === 'w:tc' && close) {
      row.push(cell.trim())
      cell = ''
    } else if (name === 'w:tr' && close) {
      out.push(row.join('\t'))
      row = []
    } else if (name === 'w:tbl') {
      tableDepth += close ? -1 : 1
    }
  }
  if (para) out.push(para)
  return out.join('\n')
}

// --------------------------------------------------------------------------- Excel
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57])

function serialToText(serial: number, withDate: boolean, withTime: boolean): string {
  const ms = Math.round((serial - 25569) * 86400000)
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
  const time = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
  if (withDate && withTime) return `${date} ${time}`
  return withDate ? date : time
}

/** Every sheet's rows, one after another; dates come out as 2026-08-12 and times as 18:30. */
export function xlsxToRows(bytes: Uint8Array): string[][] {
  const files = unzip(bytes)
  const read = (path: string) => (files[path] ? strFromU8(files[path]) : '')
  const shared: string[] = []
  for (const si of read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    shared.push([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1])).join(''))
  }
  // Which cell styles are dates or times.
  const styles = read('xl/styles.xml')
  const custom = new Map<number, string>()
  for (const f of styles.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom.set(Number(f[1]), decodeXml(f[2]))
  const xfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? ''
  const styleKind: ('date' | 'time' | 'datetime' | null)[] = []
  for (const xf of xfs.matchAll(/<xf\b[^>]*?numFmtId="(\d+)"/g)) {
    const id = Number(xf[1])
    const code = (custom.get(id) ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '').toLowerCase()
    const hasDate = BUILTIN_DATE_FORMATS.has(id) ? id !== 18 && id !== 19 && id !== 20 && id !== 21 && id !== 45 && id !== 46 && id !== 47 : /[dy]/.test(code) || (/m/.test(code) && !/h/.test(code))
    const hasTime = [18, 19, 20, 21, 22, 45, 46, 47].includes(id) || /h|s/.test(code)
    styleKind.push(hasDate && hasTime ? 'datetime' : hasDate ? 'date' : hasTime ? 'time' : null)
  }
  const sheetPaths = Object.keys(files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]))
  const rows: string[][] = []
  for (const path of sheetPaths) {
    const xml = read(path)
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: string[] = []
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]
        const body = c[2] ?? ''
        const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1]
        const col = ref ? [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : row.length
        const t = attrs.match(/\bt="(\w+)"/)?.[1]
        const s = Number(attrs.match(/\bs="(\d+)"/)?.[1] ?? -1)
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
        let text = ''
        if (t === 's' && v !== undefined) text = shared[Number(v)] ?? ''
        else if (t === 'inlineStr') text = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeXml(x[1])).join('')
        else if (t === 'str' || t === 'b' || t === 'e') text = decodeXml(v ?? '')
        else if (v !== undefined) {
          const n = Number(v)
          const kind = s >= 0 ? styleKind[s] : null
          if (kind && Number.isFinite(n)) text = serialToText(n, kind !== 'time' && n >= 1, kind !== 'date' && (kind === 'time' || kind === 'datetime' || n % 1 !== 0))
          else text = v
        }
        while (row.length < col) row.push('')
        row[col] = text
      }
      if (row.some((x) => x.trim())) rows.push(row)
    }
  }
  return rows
}

// --------------------------------------------------------------------------- CSV
export function csvToRows(text: string): string[][] {
  const sample = text.slice(0, 5000)
  const count = (ch: string) => sample.split('\n').slice(0, 10).reduce((n, l) => n + l.split(ch).length - 1, 0)
  const delim = [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0]
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
      continue
    }
    if (ch === '"' && field === '') quoted = true
    else if (ch === delim) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim()))
}

// --------------------------------------------------------------------------- HTML, RTF
export function htmlToText(html: string): string {
  const body = html.replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '')
  const withBreaks = body
    .replace(/<\/(td|th)>\s*/gi, '\t')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeXml(withBreaks)
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
}

export function rtfToText(rtf: string): string {
  return rtf
    .replace(/\\par[d]?\b/g, '\n')
    .replace(/\\tab\b/g, '\t')
    .replace(/\\'([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, n: string) => String.fromCharCode((Number(n) + 65536) % 65536))
    .replace(/\{\\\*[^{}]*\}|\\[a-z]+-?\d* ?|[{}]/gi, '')
}

// --------------------------------------------------------------------------- PDF
/** Text of every page, line by line. The PDF reader is only downloaded when a PDF is chosen. */
export async function pdfToText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const task = pdfjs.getDocument({ data: bytes })
  let doc
  try {
    doc = await task.promise
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    throw new ImportFileError(/password/i.test(msg) ? 'This PDF is password-protected. Save a copy without a password and try again.' : 'That PDF couldn’t be opened.')
  }
  const lines: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    let line = ''
    let lastY: number | null = null
    let lastEnd: number | null = null
    for (const item of content.items) {
      if (!('str' in item)) continue
      const x = item.transform[4]
      const y = item.transform[5]
      if (lastY !== null && Math.abs(y - lastY) > Math.max(2, (item.height || 10) * 0.5)) {
        lines.push(line)
        line = ''
        lastEnd = null
      }
      const gap = lastEnd === null ? 0 : x - lastEnd
      if (line && gap > 1.5 && !line.endsWith(' ') && !item.str.startsWith(' ')) line += gap > 20 ? '\t' : ' '
      line += item.str
      lastY = y
      lastEnd = x + (item.width || 0)
      if (item.hasEOL) {
        lines.push(line)
        line = ''
        lastY = null
        lastEnd = null
      }
    }
    if (line) lines.push(line)
    lines.push('')
  }
  await task.destroy()
  return lines.join('\n')
}
