// Run with: npx tsx tests/files.test.ts <dir with sample.docx and sample.xlsx>
import { readFileSync } from 'node:fs'
import { TZDate } from '@date-fns/tz'
import { docxToText, xlsxToRows } from '../src/lib/import/files'
import { parseLog } from '../src/lib/import/parse'

const dir = process.argv[2]
const text = docxToText(new Uint8Array(readFileSync(`${dir}/sample.docx`)))
console.log('--- docx text\n' + text)
const rows = xlsxToRows(new Uint8Array(readFileSync(`${dir}/sample.xlsx`)))
console.log('--- xlsx rows\n' + JSON.stringify(rows))
const tz = 'Asia/Kolkata'
const opts = { timeZone: tz, birthDate: '2026-07-20', fallbackOrder: 'dmy' as const, now: new TZDate(2026, 10, 1, 9, 0, tz).getTime() }
for (const [name, input] of [['docx', { kind: 'text' as const, text }], ['xlsx', { kind: 'rows' as const, rows }]] as const) {
  const r = parseLog(input, opts)
  console.log(`--- parsed ${name} (${r.reader})`)
  for (const d of r.drafts) console.log(new TZDate(d.start, tz).toString().slice(4, 21), d.end ? '→ ' + new TZDate(d.end, tz).toString().slice(16, 21) : '', d.type, JSON.stringify(d.data), d.flags.join(','))
  for (const u of r.unread) console.log('  ?', u.reason, u.text)
}
