// Checks that the end-to-end fixtures and note texts read the way the browser test expects.
// Run with: npx tsx tests/e2e/parse-fixtures.test.ts <fixtures dir>
import { readFileSync } from 'node:fs'
import { TZDate } from '@date-fns/tz'
import { readImportFile } from '../../src/lib/import/files'
import { parseLog, type Input } from '../../src/lib/import/parse'

const dir = process.argv[2]
const tz = 'Asia/Kolkata'
const birth = new Date(Date.now() - 400 * 86_400_000).toLocaleDateString('en-CA', { timeZone: tz })
const base = { timeZone: tz, birthDate: birth, fallbackOrder: 'dmy' as const, now: Date.now() }
const show = (name: string, input: Input, extra: Record<string, unknown> = {}) => {
  const r = parseLog(input, { ...base, ...extra })
  console.log(`--- ${name} (${r.reader}): ${r.drafts.length} entries, unknown [${r.unknown.map((u) => u.term).join(', ')}], guessed feeds ${r.guessedFeeds}`)
  for (const d of r.drafts) console.log('  ', new TZDate(d.start, tz).toString().slice(4, 21), d.end ? '→ ' + new TZDate(d.end, tz).toString().slice(16, 21) : '', d.type, JSON.stringify(d.data), d.flags.join(','))
  for (const u of r.unread) console.log('   ?', u.reason, u.text.slice(0, 80))
}
for (const f of ['three-weeks-ago.docx', 'sheet-log.xlsx', 'tracker-export.csv', 'WhatsApp Chat with Mom.txt']) {
  const file = new File([readFileSync(`${dir}/${f}`)], f)
  const read = await readImportFile(file)
  show(f, read.input)
}
const clock = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
const today = new TZDate(Date.now(), tz)
const undatedDay = { y: today.getFullYear(), m: today.getMonth() + 1, d: today.getDate() }
const prose = 'It still feels unreal that she is ours. Her grandparents came over and could not stop holding her. She grabbed my finger and held on tight. Everyone says she has her mother’s eyes. We took so many photos today. '
const longBody = `${prose.repeat(60)}\n\nGave calpol 2.5 ml at ${clock(90)}. She rolled over!`
show('note: big day', { kind: 'text', text: longBody }, { undatedDay })
show('note: qz (unknown)', { kind: 'text', text: `${clock(80)} qz\n${clock(70)} qz` }, { undatedDay })
show('note: qz (learned)', { kind: 'text', text: `${clock(80)} qz\n${clock(70)} qz` }, { undatedDay, vocab: { qz: 'wet' } })
const dayLong = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: tz })
show('paste: a year ago', { kind: 'text', text: `${dayLong(380)}\n7:00 am fed 60 ml formula\n9:30 wet diaper\n11:00-12:30 nap\nfirst smile` })
show('paste: dad uses qz', { kind: 'text', text: `${dayLong(3)}\n6:00 qz` }, { vocab: { qz: 'wet' } })
show('note: grandma', { kind: 'text', text: 'Grandma visited and brought a tiny jumper.' }, { undatedDay })
