// Shorthand parents use in baby logs, plus the words each family teaches Leela.
// Expansions run before anything is read, so "dbf 15 L" reads as "breastfed 15 L".

export interface Meaning {
  id: string
  label: string
  /** What the word is replaced with before reading. Empty means "skip this word". */
  text: string
}

/** What a parent can say an unknown word means. */
export const MEANINGS: Meaning[] = [
  { id: 'breastfeed', label: 'Breastfeed', text: 'breastfed' },
  { id: 'bottle', label: 'Bottle feed', text: 'bottle' },
  { id: 'formula', label: 'Formula', text: 'formula' },
  { id: 'breastmilk', label: 'Breast milk', text: 'breast milk' },
  { id: 'pump', label: 'Pumping', text: 'pumped' },
  { id: 'solids', label: 'Solid food', text: 'solids' },
  { id: 'wet', label: 'Wet diaper', text: 'wet diaper' },
  { id: 'dirty', label: 'Dirty diaper', text: 'dirty diaper' },
  { id: 'mixed', label: 'Wet and dirty diaper', text: 'wet and dirty diaper' },
  { id: 'nap', label: 'Nap', text: 'nap' },
  { id: 'night', label: 'Night sleep', text: 'night sleep' },
  { id: 'asleep', label: 'Fell asleep', text: 'asleep' },
  { id: 'woke', label: 'Woke up', text: 'woke up' },
  { id: 'left', label: 'Left side', text: 'left' },
  { id: 'right', label: 'Right side', text: 'right' },
  { id: 'medicine', label: 'Medicine', text: 'medicine' },
  { id: 'vitd', label: 'Vitamin D', text: 'vitamin d' },
  { id: 'temp', label: 'Temperature', text: 'temperature' },
  { id: 'bath', label: 'Bath', text: 'bath' },
  { id: 'tummy', label: 'Tummy time', text: 'tummy time' },
  { id: 'massage', label: 'Massage', text: 'massage' },
  { id: 'fussy', label: 'Fussy or crying', text: 'fussy' },
  { id: 'ignore', label: 'Nothing to log (a name or other word)', text: '' },
]

export const meaningById = (id: string) => MEANINGS.find((m) => m.id === id)

/** Built-in shorthand, slang and Hinglish. Keys are whole words, lower case. */
const BUILT_IN: Record<string, string> = {
  // feeding
  dbf: 'breastfed', bfed: 'breastfed', bfd: 'breastfed', brst: 'breast', brstfd: 'breastfed', bfeed: 'breastfeed',
  nrs: 'nursed', nursd: 'nursed', nrsd: 'nursed', ff: 'formula', frm: 'formula', formla: 'formula', fmla: 'formula',
  btl: 'bottle', bot: 'bottle', bttl: 'bottle', botl: 'bottle', fd: 'fed', fdg: 'feeding', fdng: 'feeding', feeed: 'feed',
  mls: 'ml', exp: 'expressed', xpressed: 'expressed', pmp: 'pumped', pmpd: 'pumped',
  doodh: 'milk', dudh: 'milk', piya: 'drank', pilaya: 'fed', khaya: 'ate', khana: 'ate', khilaya: 'ate',
  // diapers
  wd: 'wet diaper', dd: 'dirty diaper', dipe: 'diaper', diap: 'diaper', dpr: 'diaper', chg: 'changed diaper',
  chgd: 'changed diaper', chngd: 'changed diaper', chnge: 'changed diaper', poopy: 'poop', pooey: 'poop', pooped: 'poop', 
  // sleep
  slp: 'sleep', slpt: 'slept', sleept: 'slept', asl: 'asleep', aslp: 'asleep', wu: 'woke up', wkup: 'woke up', wokeup: 'woke up',
  wokup: 'woke up', awke: 'awake', nite: 'night', nyt: 'night', '2nite': 'tonight', tonite: 'tonight', soyi: 'slept',
  soyee: 'slept', sogayi: 'slept', sogaya: 'slept', uthi: 'woke up', utha: 'woke up', jaagi: 'woke up', jaga: 'woke up', jagi: 'woke up',
  // health
  tmp: 'temp', pcm: 'paracetamol', paracet: 'paracetamol', pcml: 'paracetamol', vitd: 'vitamin d', vitd3: 'vitamin d', abx: 'antibiotic',
  vax: 'vaccine', vacc: 'vaccine', vaxx: 'vaccine', vaccn: 'vaccine', imm: 'immunisation', doc: 'doctor', dawai: 'medicine',
  dawa: 'medicine', dava: 'medicine', bukhar: 'fever', bukhaar: 'fever', ulti: 'vomited', khansi: 'cough', zukam: 'cold', jukam: 'cold',
  // care and play
  tt: 'tummy time', bth: 'bath', nahaya: 'bath', nahlaya: 'bath', nahana: 'bath', mssg: 'massage', masaj: 'massage', malish: 'massage',
  // general
  mrng: 'morning', morn: 'morning', aftn: 'afternoon', eve: 'evening', abt: 'about', approx: 'about', b4: 'before', aftr: 'after',
}

/** Patterns that aren't single words: "w/d", "w+d", "#1", "#2". */
const PHRASES: [RegExp, string][] = [
  [/\bw\s*[/&+]\s*d\b/gi, 'wet and dirty diaper'],
  [/\bp\s*[/&+]\s*p\b/gi, 'pee and poop'],
  [/(^|\s)#1\b/g, '$1pee'],
  [/(^|\s)#2\b/g, '$1poop'],
  [/\bno\.?\s?1\b(?!\s*(?:dose|time))/gi, 'pee'],
  [/\bno\.?\s?2\b(?!\s*(?:dose|time))/gi, 'poop'],
  [/\bb\/f\b|\bb\.f\.?(?=\s|$)/gi, 'breastfed'],
  [/\bvit\.?\s*-?\s*d3?\b/gi, 'vitamin d'],
  [/\bw\/(?=\s|$)/gi, 'with'],
  [/\bpotty\s+ki\b/gi, 'poop'],
  [/\bsusu\s+ki\b/gi, 'pee'],
]

export type Vocab = Record<string, string>

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Rewrites shorthand into words the reader knows. `learned` maps a word to a meaning id
 * (from MEANINGS) and wins over the built-in list.
 */
export function expand(text: string, learned: Vocab = {}): string {
  let s = text
  for (const [term, meaningId] of Object.entries(learned)) {
    const m = meaningById(meaningId)
    if (!m || !term.trim()) continue
    s = s.replace(new RegExp(`(?<![\\p{L}\\d])${escape(term)}(?![\\p{L}\\d])`, 'giu'), m.text)
  }
  for (const [rx, to] of PHRASES) s = s.replace(rx, to)
  s = s.replace(/[\p{L}\d_]+/gu, (w) => {
    const lower = w.toLowerCase()
    if (learned[lower] !== undefined) return w
    const to = BUILT_IN[lower]
    return to === undefined ? w : to
  })
  return s
}

// Words common enough that they never need explaining.
const COMMON = new Set(
  `a about above after again against all almost also always am an and another any are around as at away baby back bad be because been before being below best better between big bit both but by came can cannot could day days did do does doing done down during each early evening every few first for from full gave get gets getting give given go goes going gone good got great had half happy has have having he her here hers herself him himself his hour hours how i if in into is it its itself just last later less let like little long look lot lots made make many may me more morning most much my myself never new next nice night no none nor not now of off often oh ok okay on once one only or other our out over own quite really right same she should since slightly so some soon still such than that the their them then there these they this those though through till time times to today together tomorrow tonight too took twice under until up us very was we well went were what when where which while who why will with without woke would yes yesterday yet you your
  afternoon ate awake bath bed bedtime bottle breast breastfed breastfeed breastfeeding burp burped change changed cough cream cried crying diaper diapers dirty doctor dose drank drops drink evening fed feed feeding feeds fever formula fussy happy hospital left massage medicine milk minute minutes mins min ml morning nap napped naps nappy night nursed nursing oz pee peed poop pooped poo potty pumped pumping right rolled sleep sleeping slept smile smiled solids spit sun temp temperature tummy vaccine vitamin wet woke
  mom mum mama mommy mummy dad papa daddy dada grandma grandpa nani nana dadi dada aunt uncle sister brother family home park walk car pram stroller cot crib cradle room house played play toy toys book read song songs sang
  cot crib bassinet cradle jhula pram stroller carrier sling arms lap held car seat swing
  yellow green brown black red white pale seedy runny soft firm watery loose hard mushy
  banana apple pear papaya mango carrot potato pumpkin avocado rice dal khichdi ragi suji oats cereal puree egg curd yogurt
  calpol crocin dolo paracetamol ibuprofen gripe water colic drops syrup ors zinc iron calcium probiotic saline
  side sides each total started start ended end stopped stop finished again later earlier extra top l r lt rt lhs rhs h m hr hrs min mins
  ki ka ke hai tha thi aur se ko bhi nahi`.split(/\s+/),
)

export interface UnknownTerm {
  term: string
  count: number
  examples: string[]
}

/**
 * Short words Leela can't place, from lines that look like log entries. Names (always
 * capitalised mid-sentence), common words and the family's own names are left alone.
 */
export function unknownTerms(lines: { text: string; logLike: boolean }[], known: Set<string>, skip: Set<string>): UnknownTerm[] {
  const found = new Map<string, UnknownTerm & { caps: number }>()
  for (const { text, logLike } of lines) {
    if (!logLike) continue
    // Letters stuck to numbers ("45m", "L10") are units or sides, not words.
    const words = text.match(/(?<![\p{L}\d])[\p{L}][\p{L}'’]*(?![\p{L}\d])/gu) ?? []
    words.forEach((w, i) => {
      const lower = w.toLowerCase().replace(/['’]s$/, '')
      // "vitamin d", "hep b": a letter that belongs to the word before it.
      const prevWord = (words[i - 1] ?? '').toLowerCase()
      if (lower.length === 1 && /^(vitamin|vit|hep|hepatitis|number|no|type|plan|grade)$/.test(prevWord)) return
      if (lower.length > 8 || COMMON.has(lower) || known.has(lower) || skip.has(lower) || BUILT_IN[lower] !== undefined) return
      if (/^(am|pm|hrs?|mins?|ml|oz|kg|cm|lbs?|st|nd|rd|th)$/.test(lower)) return
      const entry = found.get(lower) ?? { term: lower, count: 0, examples: [], caps: 0 }
      entry.count++
      if (i > 0 && /^\p{Lu}\p{Ll}+$/u.test(w)) entry.caps++
      if (entry.examples.length < 3 && !entry.examples.includes(text)) entry.examples.push(text)
      found.set(lower, entry)
    })
  }
  return [...found.values()]
    .filter((t) => t.caps < t.count && (t.count >= 2 || t.term.length <= 4))
    .sort((a, b) => b.count - a.count)
    .map(({ term, count, examples }) => ({ term, count, examples }))
}

/** Puts the likeliest meanings first, from what sits next to the word. */
export function rankMeanings(examples: string[]): string[] {
  // Clock times say nothing about the word, so they're taken out first.
  const t = examples.join(' ').toLowerCase().replace(/\b\d{1,2}[:.]\d{2}(?:\s*[ap]\.?m\.?)?|\b\d{1,2}\s*[ap]\.?m\b\.?/g, ' ')
  const score = new Map<string, number>(MEANINGS.map((m, i) => [m.id, -i / 100]))
  const bump = (ids: string[], n: number) => ids.forEach((id) => score.set(id, (score.get(id) ?? 0) + n))
  if (/\d\s*(ml|oz)\b|\b\d{2,3}\b/.test(t)) bump(['bottle', 'formula', 'breastmilk', 'pump'], 3)
  if (/\d\s*(m|min|mins|minutes|h|hr|hrs)\b/.test(t)) bump(['breastfeed', 'nap', 'tummy', 'pump', 'night'], 2)
  if (/\b(l|r|left|right)\b/.test(t)) bump(['breastfeed', 'pump'], 3)
  if (/^\s*[\d:.apm\s-]*\s*\w{1,3}\s*$/.test(examples[0] ?? '')) bump(['wet', 'dirty', 'mixed', 'asleep', 'woke'], 4)
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}
