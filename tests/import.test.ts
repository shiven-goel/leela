// Run with: npx tsx tests/import.test.ts
import { TZDate } from '@date-fns/tz'
import { parseLog, type ParseResult } from '../src/lib/import/parse'

const tz = 'Asia/Kolkata'
const now = new TZDate(2026, 10, 1, 9, 0, tz).getTime()
const opts = { timeZone: tz, birthDate: '2026-07-20', fallbackOrder: 'dmy' as const, now }

function show(name: string, r: ParseResult) {
  console.log(`\n=== ${name}  (order ${r.order}${r.orderCertain ? '' : '?'}, reader ${r.reader}${r.undated ? ', undated' : ''})`)
  for (const d of r.drafts) {
    const st = new TZDate(d.start, tz)
    const en = d.end ? new TZDate(d.end, tz) : null
    const f = (x: TZDate) => `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`
    console.log(`${d.include ? ' ' : 'x'} ${f(st)}${en ? '-' + f(en).slice(6) : '      '} ${d.type.padEnd(11)} ${JSON.stringify(d.data)}${d.notes ? ' «' + d.notes + '»' : ''}${d.flags.length ? ' [' + d.flags.join(',') + ']' : ''}   ← ${d.source}`)
  }
  for (const u of r.unread) console.log(`  ? line ${u.line} (${u.reason}): ${u.text}`)
}

const A = `Baby Leela – daily log

Monday, 4 August 2026
6:30 am - BF left 10 min, right 8 min
7:15 - wet + dirty diaper (yellow, seedy)
8:00-9:30 nap in cot
9:45 - fed 60 ml formula
10:30 tummy time 10 min
11:15 bf L12 R10
12:00 - potty
1:30 - 3:00 nap
3:15 60ml EBM in bottle
4:00 wet diaper
5:30 bath and massage
6:15 bf both sides 20 min
7:30 vit D drops 1 ml
8:15 down for the night
11:40 bf left 15
2:30 feed 90ml
5:50 woke up

5/8/26
6.10 fed 90 ml formula
7.00 pee
weight 4.6 kg, length 57 cm, head 38.5 cm (doctor visit)
10.20 nap 1h 20m in the pram
temp 38.4 armpit, gave calpol 2.5ml
pentavalent 2nd dose + rotavirus + OPV
first smile today!!
fussy in the evening, lots of crying
Total feeds: 9`

const B = `Aug 12
21:30 Bedtime (crib)
19:45 Bottle 4 oz formula
18:00 Nursed R 15m
15:10-16:40 nap
13:05 Diaper - dirty, green
12:30 Ate avocado and banana, loved it
09:00 woke`

const C = [
  ['Type', 'Start', 'End', 'Duration', 'Start Condition', 'Start Location', 'End Condition', 'Notes'],
  ['Sleep', '2026-08-12 20:15', '2026-08-13 05:50', '09:35', '', 'Crib', '', ''],
  ['Feed', '2026-08-13 06:10', '2026-08-13 06:30', '00:20', 'Breast', '', 'L 10m, R 10m', ''],
  ['Feed', '2026-08-13 09:00', '', '', 'Bottle', '', '120ml', 'Formula'],
  ['Diaper', '2026-08-13 09:10', '', '', '', '', 'Both', ''],
  ['Pump', '2026-08-13 11:00', '2026-08-13 11:20', '00:20', '', '', 'L 60ml R 50ml', ''],
]

const D = `6:00 fed 90ml
7:30 wet
9:00-10:15 nap
11:00 fed 100ml`

const E = `Day 1
Born at 3:42 pm, 3.1 kg
Day 2
10am first bath
11 am - jaundice check at hospital
Day 3
2 am nursed 25 mins
sunbath 15 min`

const F = `12/08/2026
1:00 feed
4:00 feed
7:00 fed 80ml
10:00 nap till 11:30
1:00 poop
4:00 feed
7:00 bath
10:00 feed`

show('A: Google Doc style', parseLog({ kind: 'text', text: A }, opts))
show('B: newest first, 24h', parseLog({ kind: 'text', text: B }, { ...opts, fallbackOrder: 'mdy' }))
show('C: spreadsheet export', parseLog({ kind: 'rows', rows: C }, opts))
show('D: no dates', parseLog({ kind: 'text', text: D }, opts))
show('E: Day N headers', parseLog({ kind: 'text', text: E }, opts))
show('F: ambiguous times all day', parseLog({ kind: 'text', text: F }, opts))

const G = `[12/08/26, 6:32:10 AM] Priya: fed 90ml
[12/08/26, 7:05:43 AM] Shiven: changed wet nappy
[12/08/26, 7:06:01 AM] Shiven: ‎image omitted
12/08/2026, 08:15 - Priya: nap started
12/08/2026, 09:40 - Priya: woke up
12/08/2026, 22:10 - Shiven: bf 15 min
and she burped twice`

const H = `4th Aug
0630 hrs - 3 oz formula
1415hrs fed 4oz
Fed at 6:30pm - 90 ml
Breastfed 15 min (L) + 30ml formula top-up
Today she rolled over for the first time! We were so happy.
She had her first taste of banana

8/13/2026
9am nap 45 min
3pm 2 oz EBM`

const I = `4 August
Time	What
6:30	Fed 60 ml
7:15	Wet nappy
11:00	Slept till 1pm
2:00 – vomited a little after feed
4.30 diaper rash cream applied`

show('G: WhatsApp export', parseLog({ kind: 'text', text: G }, opts))
show('H: mixed formats', parseLog({ kind: 'text', text: H }, opts))
show('I: pasted table', parseLog({ kind: 'text', text: I }, opts))

const J = `14/09/2026
6:10 dbf 15 L
7:00 w
7:40 ff 90
8:15 ns 45m
9:30 w
10:15 d
11:00 dbf 12 R
12:30 tt 10 min
1:15 ns 1h
2:40 w + d
3:30 pcm 1.5ml, tmp 38.1
Priya took her for a walk`
const r1 = parseLog({ kind: 'text', text: J }, { ...opts, skipWords: ['Priya', 'Leela'] })
show('J: family shorthand, before learning', r1)
console.log('ask about:', r1.unknown.map((u) => `${u.term}×${u.count}`).join(', '))
const r2 = parseLog({ kind: 'text', text: J }, { ...opts, skipWords: ['Priya', 'Leela'], vocab: { w: 'wet', d: 'dirty', ns: 'nap' } })
show('J: after learning w, d and ns', r2)
console.log('ask about:', r2.unknown.map((u) => `${u.term}×${u.count}`).join(', ') || 'nothing')

const K = `She rolled over for the first time this morning, from tummy to back, and looked so surprised.

Gave vit d 1 ml at 9. Nani came over in the evening and we did tummy time 15 min together. Dr. Rao said her weight is 6.2 kg now.`
show('K: a note written as prose', parseLog({ kind: 'text', text: K }, { ...opts, undatedDay: { y: 2026, m: 10, d: 31 } }))
