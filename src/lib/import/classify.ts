// Reads one clause of a baby log ("fed 60 ml formula", "wet + dirty", "nap 1h 20m in the pram")
// and turns it into Leela entries. Everything here runs on the phone; nothing is sent anywhere.
import type { EventData, EventType } from '../types'
import { findDuration } from './dates'

export type PieceType = EventType | 'feed'

export interface Piece {
  /** 'feed' is a feed of unknown kind ("6:30 fed"), settled once the whole file is read. */
  type: PieceType
  data: EventData
  notes?: string
  /** Sleep written across two lines: "down at 8:15" ... "woke 10:40". */
  marker?: 'sleep_start' | 'wake'
  durationMin?: number
}

export interface Context {
  /** Baby's age in months on the entry's date, when known. */
  ageMonths: number | null
}

export type Verdict = { pieces: Piece[] } | { skip: 'totals' } | { skip: 'unknown' }

const has = (rx: RegExp, s: string) => rx.test(s)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// --------------------------------------------------------------------------- vocabulary
const TOTALS = /\b(totals?|summary|overall|in all|altogether)\b|\b\d+\s*(?:feeds|diapers|nappies|naps|wet|dirty|poops?|times)\b(?!\s*(?:of|at))/
const NOTE = /^(?:notes?|diary|memo|remarks?|comment)\s*[:\-–]\s*/

const WEIGHT = /\b(weight|weighed|weighs|wt|weighing)\b/
const LENGTH = /\b(length|height|ht|long|tall|lt)\b/
const HEAD = /\b(head(?:\s*circ\w*)?|hc|ofc)\b/
const MASS_UNIT = /(\d+(?:\.\d+)?)\s*(kgs?|kilos?|kilograms?|g|gms?|grams?|lbs?|pounds?)\b(?:\s*(\d+(?:\.\d+)?)\s*(?:oz|ounces?))?/
const LEN_UNIT = /(\d+(?:\.\d+)?)\s*(cms?|centimet\w*|in\b|inch\w*|")/g

const TEMP = /\b(temp|temperature|fever|febrile|pyrexia|thermometer)\b|\d\s*(?:°|º|deg)/
const TEMP_VALUE = /(\d{2,3}(?:\.\d{1,2})?)\s*(?:°|º|deg(?:rees?)?)?\s*([cf])?(?![\w.])/g

const VACCINE = /\b(vaccin\w*|immuni[sz]\w*|shots?|jabs?|bcg|opv|f?ipv|hep(?:atitis)?[\s-]?b|hepb|penta\w*|rota\w*|pcv\d*|dtap|dtwp|dpt|hexa\w*|hib|mmr|measles|typhoid|tcv|influenza|flu shot|varicella|chicken ?pox|japanese encephalitis)\b/
const VACCINE_NAMES: [RegExp, string][] = [
  [/\bbcg\b/, 'BCG'],
  [/\bopv\b/, 'OPV'],
  [/\bf?ipv\b/, 'IPV'],
  [/\bhep(?:atitis)?[\s-]?b\b|\bhepb\b/, 'Hep B'],
  [/\bpenta\w*/, 'Pentavalent'],
  [/\bhexa\w*/, 'Hexavalent'],
  [/\brota\w*/, 'Rotavirus'],
  [/\bpcv\d*\b/, 'PCV'],
  [/\bdtap\b|\bdtwp\b|\bdpt\b/, 'DTP'],
  [/\bhib\b/, 'Hib'],
  [/\bmmr\b|\bmeasles\b/, 'MMR'],
  [/\btyphoid\b|\btcv\b/, 'Typhoid'],
  [/\binfluenza\b|\bflu shot\b/, 'Flu'],
  [/\bvaricella\b|\bchicken ?pox\b/, 'Varicella'],
]
const VISIT = /\b(doctor|dr\b\.?|paediatrician|pediatrician|paed|peds?|clinic|hospital|check ?-?up|appointment|appt|consult\w*|well[- ]baby)\b/

const MEDS: [RegExp, string | null][] = [
  [/\b(vit(?:amin)?\.?\s*d3?|d3(?: drops?)?|dvion|d-?rise|uprise|tayo|calcirol)\b/, 'Vitamin D'],
  [/\b(paracetamol|acetaminophen)\b/, 'Paracetamol'],
  [/\b(calpol|crocin|dolo|tylenol|panadol|febrex|p\s?250|t\s?98)\b/, null],
  [/\b(ibuprofen|motrin|brufen|advil|nurofen|ibugesic)\b/, null],
  [/\b(gripe water|woodward'?s)\b/, 'Gripe water'],
  [/\b(colic ?aid|colicaid|simethicone|infacol|mylicon|colimex|cyclopam)\b/, null],
  [/\b(tonoferon|ferrous|feronia|dexorange|iron drops?|iron syrup)\b/, 'Iron'],
  [/\b(calcium|calcimax|ostocalcium)\b/, 'Calcium'],
  [/\b(zincovit|zinconia|zinc)\b/, 'Zinc'],
  [/\b(multi-?vitamins?|visyneral|a to z drops)\b/, 'Multivitamin'],
  [/\b(ors|electral|pedialyte)\b/, 'ORS'],
  [/\b(probiotics?|bifilac|enterogermina|vizylac|darolac|biogaia)\b/, null],
  [/\b(amoxicillin|amoxyclav|augmentin|azithromycin|cefixime|cefpodoxime|antibiotics?)\b/, null],
  [/\b(saline(?: drops?)?|nasivion|otrivin|nasoclear)\b/, 'Saline drops'],
  [/\b(cetirizine|levocetirizine|zyrtec|allegra|antihistamine)\b/, null],
  [/\b(ondansetron|emeset|vomikind|domperidone|domstal)\b/, null],
  [/\b(lactulose|duphalac|cremaffin)\b/, null],
  [/\b(desitin|sudocrem|bepanthen|rash cream|nappy cream|diaper cream)\b/, null],
]
const MED_GENERIC = /\b(medicines?|medication|meds?|dose|dosage|syrup|drops|tablet|tab|suspension|ointment|cream)\b/
const DOSE = /(\d+(?:\.\d+)?)\s*(ml|mls|mg|drops?|iu|tsp|teaspoons?|tabs?|tablets?|sachets?|puffs?)\b/

const PUMP = /\b(pump(?:ed|ing)?|expressed|expressing)\b/
const BOTTLE = /\b(bottles?|bottle-?fed|formula|fm|ebm|top ?-?up|topup|paladai|spoon ?fed|cup fed|nan(?:\s*pro)?|lactogen|similac|aptamil|enfamil|dexolac|nestogen)\b/
const FORMULA = /\b(formula|fm|nan(?:\s*pro)?|lactogen|similac|aptamil|enfamil|dexolac|nestogen|neocate)\b/
const BREASTMILK = /\b(breast ?milk|ebm|expressed(?: milk)?|pumped milk|mother'?s milk|mom'?s milk|mum'?s milk)\b/
const NURSING = /\b(bf|b\.f|breast ?fed|breast ?fe+d(?:ing)?|breastfeeding|breast|nurs(?:e|ed|ing)|latch(?:ed|ing)?|lhs|rhs|dbf|direct feed|on the (?:left|right))\b/
const FEED = /\b(fed|feeds?|feeding|milk|drank|drink|ate milk)\b/
const AMOUNT = /(\d+(?:\.\d+)?)\s*(ml|mls|millilit\w*|cc|oz|ounces?)\b/g

const SOLIDS = /\b(solids?|pur[eé]e[ds]?|mash(?:ed)?|porridge|cereal|khichdi|khichri|khichadi|dal|daal|dalia|rice|ragi|suji|sooji|upma|idli|dosa|banana|apple|pear|papaya|mango|chikoo|carrot|potato|sweet potato|pumpkin|avocado|egg|yog(?:h)?urt|curd|dahi|ghee|roti|chapati|oats|lunch|dinner|breakfast|snack|ate|eaten|meal|tried|tasted)\b/
const FOOD_WORDS = /\b(khichdi|khichri|dal|daal|dalia|rice|ragi|suji|sooji|upma|idli|dosa|banana|apple|pear|papaya|mango|chikoo|carrot|potato|sweet potato|pumpkin|avocado|egg|yog(?:h)?urt|curd|dahi|roti|chapati|oats|cereal|porridge|peas|beetroot|spinach|broccoli|chicken|fish|cheese|paneer|lentils?|quinoa|toast|bread|pasta|puree)\b/g

const WET = /\b(wet|pee(?:d|s)?|peeing|urine|urinated|wee(?:d)?|susu|soo ?soo|pp)\b/
const DIRTY = /\b(poo(?:p|ped|ps|py|s)?|dirty|soiled|stools?|bm|bowel|motions?|potty|messy|number two|no\.? ?2|#2|poty)\b/
const DIAPER = /\b(diapers?|nappy|nappies|diaper change|changed|change)\b/
const DRY = /\bdry\b/

const SLEEP = /\b(sleep(?:ing|s)?|slept|asleep|nap(?:s|ped|ping)?|dozed?(?: off)?|snooz\w*|zzz+|down (?:at|for)|(?:went|put|go|gone|laid) (?:\w+ )?down|put (?:her |him |baby )?to sleep|bed ?time|to bed|in bed|night sleep)\b|^down\b/
const WAKE = /\b(woke(?: up)?|wakes? up|waking up|awake|up at|got up|wake ?up)\b|^up\b/
const NIGHT = /\b(night|bed ?time|to bed|overnight)\b/
const NAP = /\bnap/

const ACTIVITIES: [RegExp, string | null, string?][] = [
  [/\btummy ?time\b/, 'tummy'],
  [/\b(bath(?:ed|time)?|sponge(?:d)?(?: bath)?|shower(?:ed)?)\b/, 'bath'],
  [/\b(massage(?:d)?|maalish|malish)\b/, null, 'Massage'],
  [/\b(walk|stroll|park|outside|outdoors?|garden|sun ?bath\w*|sunlight|balcony)\b/, 'outdoor'],
  [/\b(play(?:ed|ing|time)?|play ?gym|toys?)\b/, 'indoor'],
  [/\b(read(?:ing)?|story|stories|books?)\b/, 'story'],
  [/\b(tv|screen time|cartoons?|videos?)\b/, 'screen'],
  [/\b(skin ?to ?skin|kangaroo(?: care)?|kmc)\b/, 'skin'],
  [/\b(brush(?:ed)? (?:teeth|gums)|teeth brush\w*)\b/, 'teeth'],
]

const MILESTONES: [RegExp, string][] = [
  [/\b(?:first|1st) (?:social )?smile\b|\bsmiled for the first time\b|\bsocial smile\b/, 'smile'],
  [/\b(?:first|1st) (?:laugh|giggle)\b|\blaughed for the first time\b/, 'laugh'],
  [/\brolled\b|\broll(?:ed|s|ing)? over\b|\bturned over\b/, 'roll'],
  [/\bsat up\b|\bsitting up\b|\bsat (?:by (?:her|him)self|unsupported|without support)\b|\bsits? (?:by (?:her|him)self|unsupported)\b/, 'sit'],
  [/\bcrawl(?:ed|ing|s)?\b/, 'crawl'],
  [/\b(?:first|1st) tooth\b|\btooth (?:came|cut|erupted|is out|showing|popped)\b|\bteeth (?:came|cut)\b/, 'tooth'],
  [/\b(?:first|1st) word\b|\bsaid (?:mama|dada|papa|baba|amma|mumma|mummy)\b/, 'word'],
  [/\bstood\b|\bstanding up\b|\bpulled (?:her|him)self up\b/, 'stand'],
  [/\b(?:first|1st) steps?\b|\btook (?:her|his) first steps?\b|\bwalked (?:on (?:her|his) own|unassisted|by (?:her|him)self)\b/, 'steps'],
]
const MILESTONE_OTHER = /\b(?:first|1st) (?!(?:feed|bottle|nap|time|diaper|nappy|poo\w*|pee|night|day|week|month|bath|dose|shot)\b)\w+|\bholds? (?:her|his) head\b|\bhead control\b|\bgrasp\w*\b|\bcoo(?:ed|ing)\b|\bbabbl\w*\b|\brecogni[sz]\w*\b|\breached for\b/

const SYMPTOMS: [RegExp, string][] = [
  [/\bcough\w*/, 'Cough'],
  [/\b(cold|runny nose|blocked nose|stuffy|congest\w*|sneez\w*|snotty|nasal)\b/, 'Runny nose'],
  [/\b(fuss\w*|cranky|irritable|crying|cried|inconsolable|unsettled|colic\w*)\b/, 'Fussy'],
  [/\b(vomit\w*|threw up|throw(?:ing)? up|puk\w*|projectile)\b/, 'Vomiting'],
  [/\b(rash\w*|eczema|baby acne)\b/, 'Rash'],
  [/\b(diarrh\w*|loose (?:motions?|stools?|poo\w*)|watery (?:stools?|poo\w*))\b/, 'Diarrhea'],
  [/\b(constipat\w*|hard (?:stools?|poo\w*)|straining)\b/, 'Constipation'],
  [/\bteething\b/, 'Teething'],
  [/\b(gas(?:sy)?|wind|bloat\w*)\b/, 'Gas'],
]

// --------------------------------------------------------------------------- helpers
function amountsMl(lower: string): number[] {
  const out: number[] = []
  for (const m of lower.matchAll(AMOUNT)) {
    const v = Number(m[1])
    out.push(m[2].startsWith('o') ? Math.round((v * 29.5735) / 5) * 5 : Math.round(v))
  }
  return out
}

/** Minutes per breast from "L 10 R 5", "left 10 min, right 8", "10 min left", "10L 5R". */
function sides(text: string): { left?: number; right?: number; last?: 'left' | 'right'; both?: boolean; each?: boolean } {
  let s = ` ${text} `
  let left: number | undefined
  let right: number | undefined
  let last: 'left' | 'right' | undefined
  const take = (side: 'left' | 'right', n: number) => {
    if (side === 'left') left = (left ?? 0) + n
    else right = (right ?? 0) + n
    last = side
  }
  const sideOf = (w: string): 'left' | 'right' => (w.startsWith('l') ? 'left' : 'right')
  const SIDE = '(l|left|lhs|lt|r|right|rhs|rt)'
  // side first: "left 10", "l: 10 min", "left side 10m", "l10"
  s = s.replace(new RegExp(`\\b${SIDE}(?:\\s*(?:side|breast|boob))?\\s*[:=\\-]?\\s*(\\d{1,3})\\s*(?:m\\b|mins?\\b|minutes?\\b)?`, 'g'), (_, w: string, n: string) => {
    take(sideOf(w), Number(n))
    return ' '
  })
  // number first: "10 min left", "10m on the right", "10L"
  s = s.replace(new RegExp(`\\b(\\d{1,3})\\s*(?:m\\b|mins?\\b|minutes?\\b)?\\s*(?:on\\s+)?(?:the\\s+)?${SIDE}\\b`, 'g'), (_, n: string, w: string) => {
    take(sideOf(w), Number(n))
    return ' '
  })
  if (left === undefined && right === undefined) {
    const lone = text.match(/\b(left|lhs|right|rhs)\b(?:\s*(?:side|breast))?/) ?? text.match(/\((l|r)\)/)
    if (lone) last = sideOf(lone[1])
  }
  return { left, right, last, both: /\bboth(?: sides| breasts)?\b/.test(text), each: /\beach\b/.test(text) }
}

function tempC(lower: string): number | undefined {
  for (const m of lower.matchAll(TEMP_VALUE)) {
    const v = Number(m[1])
    const unit = m[2]
    if ((unit === 'f' || (!unit && v >= 86)) && v >= 86 && v <= 110) return Math.round(((v - 32) * 5) / 9 * 10) / 10
    if (v >= 30 && v <= 43.5) return v
  }
  return undefined
}

function weightKg(lower: string): number | undefined {
  const plausible = (kg: number) => (kg >= 0.8 && kg <= 40 ? Math.round(kg * 1000) / 1000 : undefined)
  const m = lower.match(MASS_UNIT)
  if (m) {
    const v = Number(m[1])
    const u = m[2]
    if (u.startsWith('k')) return plausible(v)
    if (u.startsWith('g')) return v >= 800 ? plausible(v / 1000) : undefined
    const oz = m[3] ? Number(m[3]) : 0
    return plausible(v * 0.45359237 + oz * 0.0283495)
  }
  if (has(WEIGHT, lower)) {
    const n = lower.match(/(\d+(?:\.\d+)?)/)
    if (n) {
      const v = Number(n[1])
      if (v >= 1 && v <= 30) return v
      if (v >= 800 && v <= 30000) return v / 1000
    }
  }
  return undefined
}

function lengths(lower: string): { length_cm?: number; head_cm?: number } {
  const out: { length_cm?: number; head_cm?: number } = {}
  const headAt = lower.search(HEAD)
  for (const m of lower.matchAll(LEN_UNIT)) {
    const v = Number(m[1])
    const cm = m[2].startsWith('c') ? v : Math.round(v * 2.54 * 10) / 10
    // A number right after "head" (or "HC") is the head; anything else is length.
    const isHead = headAt >= 0 && m.index! > headAt && m.index! - headAt < 24 && out.head_cm === undefined
    if (isHead) out.head_cm = cm
    else if (out.length_cm === undefined) out.length_cm = cm
  }
  return out
}

function medicineName(lower: string, original: string): string | undefined {
  for (const [rx, name] of MEDS) {
    const m = lower.match(rx)
    if (m) return name ?? cap(original.slice(m.index!, m.index! + m[0].length).trim())
  }
  return undefined
}

function dose(lower: string): Pick<EventData, 'dose' | 'unit'> {
  const m = lower.match(DOSE)
  if (!m) return {}
  const n = m[1]
  const u = m[2]
  if (u.startsWith('ml')) return { dose: n, unit: 'ml' }
  if (u === 'mg') return { dose: n, unit: 'mg' }
  if (u.startsWith('drop')) return { dose: n, unit: 'drops' }
  if (u === 'iu') return { dose: `${n} IU` }
  if (u.startsWith('t') && !u.startsWith('tab')) return { dose: String(Number(n) * 5), unit: 'ml' }
  if (u.startsWith('tab')) return { dose: n, unit: 'tablet' }
  if (u.startsWith('sachet')) return { dose: n, unit: 'sachet' }
  if (u.startsWith('puff')) return { dose: n, unit: 'puff' }
  return { dose: n }
}

function foods(lower: string, original: string): { name: string; first?: boolean }[] {
  const first = /\b(first time|first taste|new food|introduced|tried)\b/.test(lower)
  const after = lower.match(/\b(?:ate|had|tried|tasted|gave|offered|solids?|lunch|dinner|breakfast|snack)\b\s*[:\-–]?\s*(.+)$/)
  let names: string[] = []
  if (after) {
    const start = lower.indexOf(after[1])
    names = original
      .slice(start)
      .split(/,|\band\b|&|\+|\bwith\b|\//i)
      .map((x) =>
        x
          .replace(/\(.*?\)/g, '')
          .replace(/\b\d+(?:\.\d+)?\s*(?:g|gm|grams?|tsp|tbsp|spoons?|bites?|ml|oz|cups?|bowls?)\b/gi, '')
          .replace(/\b(a little|little|some|few|bit of|a bit|bites?|spoons?|of)\b/gi, '')
          .replace(/[^\p{L}\s'-]/gu, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      .map((x) =>
        x
          .replace(/\b(loved|liked|enjoyed|refused|hated|disliked|didn'?t like|did not like|spat out|rejected|it|well|a lot|lots|very much|happily)\b/gi, '')
          .replace(/\b(her|his|their|my|our|first|taste|tastes|tasting|time|times|the|a|an|today|tonight|for|to|was|is|she|he|baby|had|ate|tried|new|food|foods|of|some|little|bit)\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      .filter((x) => x && x.split(' ').length <= 4 && !/^(the|a|an|good|all|most|half|some|today|again)$/i.test(x))
  }
  if (!names.length) names = [...lower.matchAll(FOOD_WORDS)].map((m) => m[0])
  const seen = new Set<string>()
  return names
    .map((n) => cap(n))
    .filter((n) => !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()))
    .slice(0, 6)
    .map((name) => (first ? { name, first: true } : { name }))
}

function diaperData(lower: string, babyPotty: boolean): EventData | null {
  const bmAsMilk = /\bbm\b/.test(lower) && /\d\s*(?:ml|oz)\b/.test(lower)
  const dirtyText = bmAsMilk ? lower.replace(/\bbm\b/g, '') : lower
  const wet = has(WET, lower)
  const dirty = has(DIRTY, dirtyText) && (babyPotty || !/\bpotty\b/.test(dirtyText) || has(/\bpoo|\bdirty|\bstool|\bsoiled|\bmotion/, dirtyText))
  const word = has(DIAPER, lower)
  const dry = has(DRY, lower)
  if (!wet && !dirty && !word && !dry) return null
  const data: EventData = {}
  if ((wet && dirty) || (word && /\bboth\b/.test(lower))) data.kind = 'mixed'
  else if (dirty) data.kind = 'dirty'
  else if (wet) data.kind = 'wet'
  else if (dry) data.kind = 'dry'
  if (dirty) {
    const color = lower.match(/\b(yellow|mustard|green|brown|black|dark|tarry|red|blood\w*|white|pale|grey|gray|clay)\b/)?.[1]
    if (color) data.color = { mustard: 'yellow', dark: 'black', tarry: 'black', grey: 'white', gray: 'white', pale: 'white', clay: 'white' }[color] ?? (color.startsWith('blood') ? 'red' : color)
    const tex = lower.match(/\b(runny|watery|loose|liquid|explosive|soft|seedy|pasty|mushy|hard|firm|pellets?|formed)\b/)?.[1]
    if (tex) data.texture = ['runny', 'watery', 'loose', 'liquid', 'explosive'].includes(tex) ? 'runny' : ['soft', 'seedy', 'pasty', 'mushy'].includes(tex) ? 'soft' : 'firm'
  }
  if (/\brash\b/.test(lower)) data.rash = true
  return data
}

function sleepPlace(lower: string): EventData['place'] | undefined {
  if (/\b(crib|cot|bassinet|cradle|jhula|moses basket|next ?2 ?me)\b/.test(lower)) return 'crib'
  if (/\b(stroller|pram|buggy|pushchair)\b/.test(lower)) return 'stroller'
  if (/\b(car ?seat|in the car|car ride|drive)\b/.test(lower)) return 'car'
  if (/\b(carrier|sling|wrap|held|holding|arms|lap|contact nap|on (?:me|mom|mum|mama|dad|papa))\b/.test(lower)) return 'carrier'
  return undefined
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim()

// --------------------------------------------------------------------------- classify
/** Turns one clause into entries, or says why it can't. `text` has its leading time already removed. */
export function classify(text: string, ctx: Context): Verdict {
  const original = tidy(text)
  const lower = original.toLowerCase().replace(/[’`]/g, "'").replace(/[–—]/g, '-')
  if (!lower || !/[a-z]/.test(lower)) return { skip: 'unknown' }

  const note = lower.match(NOTE)
  if (note) return { pieces: [{ type: 'note', data: {}, notes: original.slice(note[0].length).trim() }] }

  const ml = amountsMl(lower)
  const dur = findDuration(lower)
  const pieces: Piece[] = []
  const babyPotty = ctx.ageMonths === null || ctx.ageMonths < 18

  // Daily totals ("6 wet diapers today", "Total sleep 14h") aren't single entries.
  if (has(TOTALS, lower) && !has(/\bat\b|@/, lower)) return { skip: 'totals' }

  // Growth
  const w = weightKg(lower)
  const len = has(LENGTH, lower) || has(HEAD, lower) ? lengths(lower) : {}
  if ((w !== undefined && (has(WEIGHT, lower) || has(MASS_UNIT, lower))) || len.length_cm !== undefined || len.head_cm !== undefined) {
    if (!(w !== undefined && !has(WEIGHT, lower) && has(/\b(ate|fed|formula|milk|bottle)\b/, lower))) {
      const data: EventData = {}
      if (w !== undefined) data.weight_kg = w
      if (len.length_cm !== undefined) data.length_cm = len.length_cm
      if (len.head_cm !== undefined) data.head_cm = len.head_cm
      return { pieces: [{ type: 'growth', data }] }
    }
  }

  // Temperature
  if (has(TEMP, lower)) {
    const t = tempC(lower)
    if (t !== undefined) {
      const data: EventData = { temp_c: t }
      const method = lower.match(/\b(armpit|axilla\w*|underarm|oral|mouth|tongue|ear|tympanic|forehead|temporal|rectal\w*|bum|bottom)\b/)?.[1]
      if (method)
        data.method = /arm|axil/.test(method) ? 'armpit' : /oral|mouth|tongue/.test(method) ? 'oral' : /ear|tymp/.test(method) ? 'ear' : /fore|temporal/.test(method) ? 'forehead' : 'rectal'
      pieces.push({ type: 'temperature', data })
      // "fever 38.4, gave Calpol 2.5 ml" carries on below.
    }
  }

  // Vaccines and doctor visits
  if (has(VACCINE, lower)) {
    const names = VACCINE_NAMES.filter(([rx]) => rx.test(lower)).map(([, n]) => n)
    pieces.push({ type: 'symptom', data: { kind: 'vaccine', vaccine: names.join(', ') || undefined }, notes: original })
    return { pieces }
  }
  if (has(VISIT, lower)) {
    pieces.push({ type: 'symptom', data: { kind: 'visit' }, notes: original })
    return { pieces }
  }

  // Medicine
  const med = medicineName(lower, original)
  if (med || (has(MED_GENERIC, lower) && !has(BOTTLE, lower))) {
    const name = med ?? (cap(original.replace(/\b\d.*$/, '').replace(new RegExp(MED_GENERIC.source, 'g'), '').replace(/\b(gave|given|give|took|taken|administered|applied|put|some|her|his|the)\b/gi, '').replace(/[^\p{L}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim()) || 'Medicine')
    pieces.push({ type: 'medicine', data: { name, ...dose(lower) } })
    return { pieces }
  }
  if (pieces.length) return { pieces }

  // Pumping (and feeds of pumped milk, which are bottles)
  if (has(PUMP, lower) && !has(/\b(fed|gave|bottle|feed)\b/, lower)) {
    const sideMl = (side: 'l' | 'r') => {
      const w = side === 'l' ? '(?:l|left|lhs)' : '(?:r|right|rhs)'
      // Side first ("L 60ml") is tried before number first ("60 ml from the left").
      const m = lower.match(new RegExp(`\\b${w}\\s*[:=-]?\\s*(\\d+(?:\\.\\d+)?)\\s*(ml|oz)?`)) ?? lower.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(ml|oz)?\\s*(?:from\\s+)?(?:the\\s+)?${w}\\b`))
      if (!m) return undefined
      const v = Number(m[1])
      return m[2] === 'oz' ? Math.round((v * 29.5735) / 5) * 5 : Math.round(v)
    }
    const data: EventData = {}
    const l = sideMl('l')
    const r = sideMl('r')
    if (l !== undefined) data.left_ml = l
    if (r !== undefined) data.right_ml = r
    if (l === undefined && r === undefined && ml.length) data.total_ml = ml.reduce((a, b) => a + b, 0)
    return { pieces: [{ type: 'pump', data, durationMin: dur?.minutes }] }
  }

  // Feeds
  const bottle = has(BOTTLE, lower) || (ml.length > 0 && (has(FEED, lower) || has(BREASTMILK, lower) || /\bbm\b/.test(lower) || !has(SOLIDS, lower)))
  const sd = sides(lower)
  const sideMinutes = sd.left !== undefined || sd.right !== undefined
  const nursingWords = has(NURSING, lower) && !has(BREASTMILK, lower) && !(has(BOTTLE, lower) && !sideMinutes)
  const nursing = nursingWords || sideMinutes || (has(FEED, lower) && !ml.length && !!dur && !has(SOLIDS, lower))
  if (bottle && ml.length) {
    const formula = has(FORMULA, lower)
    const breast = has(BREASTMILK, lower) || /\bbm\b/.test(lower) || (has(PUMP, lower) && !formula)
    const data: EventData = { amount_ml: ml.reduce((a, b) => a + b, 0) }
    data.contents = formula && breast ? 'mixed' : formula ? 'formula' : breast ? 'breast' : undefined
    if (!data.contents) delete data.contents
    if (nursingWords && (sideMinutes || dur)) pieces.push(nursingPiece(sd, dur?.minutes))
    pieces.push({ type: 'bottle', data })
  } else if (nursing) {
    pieces.push(nursingPiece(sd, dur?.minutes))
  } else if (bottle) {
    const data: EventData = {}
    if (has(FORMULA, lower)) data.contents = 'formula'
    else if (has(BREASTMILK, lower)) data.contents = 'breast'
    // "ff 90", "bottle 120": a bare number on a bottle is millilitres.
    const bare = lower.match(/(?<![\d.:])(\d{2,3})(?![\d.:]|\s*(?:min|mins|minutes|m\b|h\b|hrs?|hours?|times|x\b|%))/)
    if (bare && Number(bare[1]) >= 10 && Number(bare[1]) <= 400) data.amount_ml = Number(bare[1])
    pieces.push({ type: 'bottle', data })
  } else if (has(FEED, lower) && !has(SOLIDS, lower)) {
    pieces.push({ type: 'feed', data: {} })
  }

  // "vomited a little after feed" is about the vomit, not a new feed.
  if (pieces.length === 1 && pieces[0].type === 'feed') {
    const tags = SYMPTOMS.filter(([rx]) => rx.test(lower)).map(([, t]) => t)
    if (tags.length) return { pieces: [{ type: 'symptom', data: { kind: 'symptom', tags: [...new Set(tags)] }, notes: original }] }
  }

  // Solids
  if (!pieces.some((p) => p.type === 'bottle' || p.type === 'nursing' || p.type === 'feed') && has(SOLIDS, lower)) {
    const data: EventData = { foods: foods(lower, original) }
    if (/\b(loved|liked|enjoyed|happily|yummy)\b/.test(lower)) data.reaction = 'liked'
    else if (/\b(refused|disliked|hated|spat (?:it )?out|didn'?t like|did not like|rejected)\b/.test(lower)) data.reaction = 'disliked'
    if (/\b(taste|few bites|lick|couple of bites)\b/.test(lower)) data.eaten = 'taste'
    else if (/\b(finished|all of it|full bowl|whole bowl|everything)\b/.test(lower)) data.eaten = 'all'
    else if (/\bmost\b/.test(lower)) data.eaten = 'most'
    else if (/\b(some|half|bit)\b/.test(lower)) data.eaten = 'some'
    pieces.push({ type: 'solids', data })
  }

  // Diapers (potty means poo in a nappy for babies; toilet training for toddlers)
  if (!babyPotty && /\b(potty|toilet)\b/.test(lower) && !has(DIAPER, lower)) {
    const data: EventData = { outcome: /\baccident\b/.test(lower) ? 'accident' : 'potty' }
    const pee = has(WET, lower)
    const poo = /\b(poo\w*|stool|bm)\b/.test(lower)
    data.kind = pee && poo ? 'both' : poo ? 'poo' : 'pee'
    pieces.push({ type: 'potty', data })
  } else {
    const dd = diaperData(lower, babyPotty)
    if (dd && !(dd.kind === undefined && !has(DIAPER, lower)) && !(has(/\bchange(d)?\b/, lower) && !has(/\b(diaper|nappy|nappies)\b/, lower) && dd.kind === undefined)) {
      pieces.push({ type: 'diaper', data: dd })
    }
  }

  // Sleep
  const sleepy = has(SLEEP, lower)
  const wake = has(WAKE, lower)
  if (sleepy || wake) {
    const data: EventData = {}
    const place = sleepPlace(lower)
    if (place) data.place = place
    if (has(NAP, lower)) data.kind = 'nap'
    else if (has(NIGHT, lower)) data.kind = 'night'
    if (wake && !sleepy) pieces.push({ type: 'sleep', data, marker: 'wake' })
    else if (dur && !pieces.some((p) => p.type === 'nursing' || p.type === 'pump')) pieces.push({ type: 'sleep', data, durationMin: dur.minutes })
    else pieces.push({ type: 'sleep', data, marker: 'sleep_start' })
  }

  // Play and care
  if (!pieces.length) {
    for (const [rx, kind, label] of ACTIVITIES) {
      if (!rx.test(lower)) continue
      const data: EventData = kind ? { kind } : { label }
      pieces.push({ type: 'activity', data, durationMin: dur?.minutes })
      break
    }
  }

  // Firsts
  if (!pieces.length || pieces.every((p) => p.type === 'activity')) {
    const hit = MILESTONES.find(([rx]) => rx.test(lower))
    if (hit) return { pieces: [{ type: 'milestone', data: { kind: hit[1] }, notes: original }] }
    if (MILESTONE_OTHER.test(lower)) return { pieces: [{ type: 'milestone', data: { label: cap(original.replace(/^[\W\d]+/, '')).slice(0, 60) }, notes: original }] }
  }

  // Symptoms only stand on their own; "fed 60 ml, a bit fussy" stays a feed.
  if (!pieces.length) {
    const tags = SYMPTOMS.filter(([rx]) => rx.test(lower)).map(([, t]) => t)
    if (tags.length) return { pieces: [{ type: 'symptom', data: { kind: 'symptom', tags: [...new Set(tags)] }, notes: original }] }
  }

  return pieces.length ? { pieces } : { skip: 'unknown' }
}

function nursingPiece(sd: ReturnType<typeof sides>, totalMin: number | undefined): Piece {
  const data: EventData = {}
  if (sd.left !== undefined || sd.right !== undefined) {
    data.left_s = (sd.left ?? 0) * 60
    data.right_s = (sd.right ?? 0) * 60
    if (sd.last) data.last_side = sd.last
  } else if (totalMin !== undefined) {
    if (sd.both && sd.each) {
      data.left_s = totalMin * 60
      data.right_s = totalMin * 60
    } else if (sd.last && !sd.both) {
      data[sd.last === 'left' ? 'left_s' : 'right_s'] = totalMin * 60
      data[sd.last === 'left' ? 'right_s' : 'left_s'] = 0
      data.last_side = sd.last
    } else {
      data.total_s = totalMin * 60
    }
  } else if (sd.last) {
    data.last_side = sd.last
  }
  const minutes = data.total_s !== undefined ? data.total_s / 60 : data.left_s !== undefined || data.right_s !== undefined ? ((data.left_s ?? 0) + (data.right_s ?? 0)) / 60 : totalMin
  return { type: 'nursing', data, durationMin: minutes || undefined }
}

/** Splits a line into clauses at commas, "+", "&", "and", "then", ";" (never inside brackets). */
export function clauses(text: string): string[] {
  const SEP = /^\s*(?:;|\||\+|&|,(?!\d{3})|\band\b|\bthen\b|\balso\b|\s\/\s|\/(?=[a-z]))\s*/i
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < text.length; ) {
    const ch = text[i]
    if (ch === '(' || ch === '[') depth++
    if ((ch === ')' || ch === ']') && depth > 0) depth--
    if (depth === 0) {
      const rest = text.slice(i)
      // Word separators only count at a word start.
      const m = (i === 0 || /[\s,;+&|/]/.test(text[i - 1]) || /^[,;+&|/]/.test(rest)) ? rest.match(SEP) : null
      if (m && m[0].length) {
        out.push(cur)
        cur = ''
        i += m[0].length
        continue
      }
    }
    cur += ch
    i++
  }
  out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}
