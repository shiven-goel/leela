// Dates and clock times the way parents actually write them in a log.

export type DateOrder = 'dmy' | 'mdy'

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11,
  november: 11, dec: 12, december: 12,
}
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const WEEKDAY = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)'

/** A date found at the start of a line, before the year and day/month order are known. */
export interface DateToken {
  kind: 'ymd' | 'numeric' | 'named' | 'dayN'
  /** ymd: y, m, d. numeric: a/b as written. named: d and m known. dayN: n. */
  a: number
  b: number
  y?: number
  /** Text left on the line after the date. */
  rest: string
}

const PREFIX = new RegExp(`^[\\s#*>•·\\-–—_=|\\[]*(?:(?:date|day|on)\\s*[:\\-–]\\s*)?(?:${WEEKDAY}\\.?,?\\s*)?`, 'i')
const RX_YMD = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?![\d:])/
const RX_NUM = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?![\d:/])/
const RX_NUM_YEAR = /^(\d{1,2})[.-](\d{1,2})[.-](\d{2}|\d{4})(?![\d:])/
const RX_DAY_MONTH = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?[-\\s.]?\\s*${MONTH}\\b\\.?,?(?:[\\s,'-]*(\\d{4}|\\d{2})(?![\\d:.]))?`, 'i')
const RX_MONTH_DAY = new RegExp(`^${MONTH}\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b(?![:.]\\d)(?:,?\\s*(\\d{4})(?![\\d:]))?`, 'i')
const RX_DAY_N = /^day\s*(\d{1,3})\b/i

function year(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const n = Number(raw)
  return raw.length === 2 ? 2000 + n : n
}

function tidyRest(s: string): string {
  return s.replace(/^[\s,:;.)\]*_\-–—|]+/, '').replace(/[\s*_]+$/, '')
}

/** Reads a date at the very start of a line ("12 Aug", "12/08/2026", "Monday, August 12", "Day 14"). */
export function dateAtStart(line: string): DateToken | null {
  const pre = line.match(PREFIX)?.[0] ?? ''
  const s = line.slice(pre.length).replace(/^\*+|^_+/, '')
  let m: RegExpMatchArray | null
  if ((m = s.match(RX_YMD))) return { kind: 'ymd', y: Number(m[1]), a: Number(m[2]), b: Number(m[3]), rest: tidyRest(s.slice(m[0].length)) }
  if ((m = s.match(RX_DAY_MONTH))) return { kind: 'named', a: Number(m[1]), b: MONTHS[m[2].toLowerCase()], y: year(m[3]), rest: tidyRest(s.slice(m[0].length)) }
  if ((m = s.match(RX_MONTH_DAY))) return { kind: 'named', a: Number(m[2]), b: MONTHS[m[1].toLowerCase()], y: year(m[3]), rest: tidyRest(s.slice(m[0].length)) }
  if ((m = s.match(RX_NUM_YEAR))) return { kind: 'numeric', a: Number(m[1]), b: Number(m[2]), y: year(m[3]), rest: tidyRest(s.slice(m[0].length)) }
  if ((m = s.match(RX_NUM))) {
    // "1/2 tsp" and the like are not dates.
    const after = s.slice(m[0].length)
    if (/^\s*(tsp|tbsp|cup|spoon|bottle|ml|oz)/i.test(after)) return null
    return { kind: 'numeric', a: Number(m[1]), b: Number(m[2]), y: year(m[3]), rest: tidyRest(after) }
  }
  if ((m = s.match(RX_DAY_N))) return { kind: 'dayN', a: Number(m[1]), b: 0, rest: tidyRest(s.slice(m[0].length)) }
  return null
}

/** Which way round numeric dates are written, from the evidence in the file. */
export function detectOrder(tokens: DateToken[], fallback: DateOrder): { order: DateOrder; certain: boolean; numeric: boolean } {
  let dmy = 0
  let mdy = 0
  let numeric = false
  for (const t of tokens) {
    if (t.kind !== 'numeric') continue
    numeric = true
    if (t.a > 12 && t.b <= 12) dmy++
    else if (t.b > 12 && t.a <= 12) mdy++
  }
  if (dmy === 0 && mdy === 0) return { order: fallback, certain: false, numeric }
  return { order: dmy >= mdy ? 'dmy' : 'mdy', certain: true, numeric }
}

export interface Ymd {
  y: number
  m: number
  d: number
}

const valid = (y: number, m: number, d: number) => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}
const key = (v: Ymd) => v.y * 10000 + v.m * 100 + v.d

/** Turns a token into a calendar date; a missing year is the latest one that fits between birth and today. */
export function resolveDate(t: DateToken, order: DateOrder, birth: Ymd | null, today: Ymd): Ymd | null {
  if (t.kind === 'dayN') {
    if (!birth || t.a < 1) return null
    const dt = new Date(Date.UTC(birth.y, birth.m - 1, birth.d + t.a - 1))
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
  }
  let m: number
  let d: number
  if (t.kind === 'ymd') {
    m = t.a
    d = t.b
  } else if (t.kind === 'named') {
    d = t.a
    m = t.b
  } else {
    ;[d, m] = order === 'dmy' ? [t.a, t.b] : [t.b, t.a]
  }
  if (t.y) return valid(t.y, m, d) ? { y: t.y, m, d } : null
  const lo = birth ? key(birth) - 7 : 0
  const hi = key(today) + 1
  for (let y = today.y; y >= today.y - 6; y--) {
    if (!valid(y, m, d)) continue
    const k = key({ y, m, d })
    if (k <= hi && k >= lo) return { y, m, d }
  }
  return valid(today.y, m, d) ? { y: today.y, m, d } : null
}

// ---------------------------------------------------------------------------
// Clock times
// ---------------------------------------------------------------------------

export interface TimeToken {
  /** Minutes after midnight when the clock reading is certain. */
  fixed?: number
  /** Hour 1-12 and minutes when am/pm wasn't written. */
  h12?: number
  min?: number
  index: number
  end: number
}

const UNIT_AFTER = /^\s*(?:ml|mls|millilit\w*|cc|oz|ounces?|kgs?|kilos?|g|gms?|grams?|lbs?|pounds?|cms?|mm|in\b|inch\w*|"|°|º|deg\w*|%|iu|mg|mcg|drops?|tsp|tbsp|spoons?|scoops?|times|x\b|diapers?|nappies|nappy|feeds?|naps?|days?|weeks?|wks?|months?|mths?|mos?|yrs?|years?|mins?|minutes?|m\b|secs?|seconds?|h\b|hrs?\b|hours?|pcs?|pieces?|bites?)/i
const PHYSICAL_AFTER = /^\s*(?:ml|mls|cc|oz|ounces?|kgs?|kilos?|g\b|gms?|grams?|lbs?|pounds?|cms?|mm|in\b|inch\w*|"|°|º|deg\w*|%|iu|mg)/i
const MERIDIEM = /^\s*([ap])\.?\s?m\b\.?/i
const MERIDIEM_TIGHT = /^([ap])(?![a-z])/i

function meridiem(after: string): { mer: 'am' | 'pm'; len: number } | null {
  const m = after.match(MERIDIEM) ?? after.match(MERIDIEM_TIGHT)
  if (!m) return null
  return { mer: m[1].toLowerCase() === 'a' ? 'am' : 'pm', len: m[0].length }
}

function toFixed(h: number, min: number, mer: 'am' | 'pm'): number {
  const hh = (h % 12) + (mer === 'pm' ? 12 : 0)
  return hh * 60 + min
}

/**
 * Every clock time in a piece of text. Numbers followed by units (60 ml, 10 min) are skipped;
 * a bare hour only counts with am/pm, after "at" or "@", in a range like "8-9:30", or when it
 * opens the line followed by a dash ("6 - fed").
 */
export function findTimes(text: string): TimeToken[] {
  const out: TimeToken[] = []
  const lower = text.toLowerCase()
  for (const w of lower.matchAll(/\b(noon|midday|midnight)\b/g)) {
    out.push({ fixed: w[1] === 'midnight' ? 0 : 720, index: w.index!, end: w.index! + w[0].length })
  }
  const RANGE_NEXT = /^\s*(?:-|–|—|to\b|till\b|until\b)\s*(\d{1,2})(?:[:.](\d{2}))?\s*([ap]\.?\s?m\b\.?|[ap](?![a-z]))?/i
  const rx = /(?<![\w.:/])(\d{1,4})(?:([:.])(\d{2})(?::\d{2})?)?(?![\d])/g
  for (const m of text.matchAll(rx)) {
    const index = m.index!
    let end = index + m[0].length
    const raw = m[1]
    const sep = m[2]
    const mm = m[3] !== undefined ? Number(m[3]) : 0
    const after = text.slice(end)
    const mer = meridiem(after)
    const before = lower.slice(Math.max(0, index - 10), index)
    const prev = out[out.length - 1]
    const afterRange = prev ? /^\s*(?:-|–|—|to|till|until|upto|up to)\s*$/i.test(text.slice(prev.end, index)) : false
    const rangeNext = after.match(RANGE_NEXT)
    const rangeNextIsTime = Boolean(rangeNext && !UNIT_AFTER.test(after.slice(rangeNext[0].length)))
    const cue = /(?:\bat|@|around|approx\.?|~|\bby|\bfrom)\s*$/.test(before)
    const push = (t: Omit<TimeToken, 'index' | 'end'>) => out.push({ ...t, index, end })

    if (sep) {
      const h = Number(raw)
      if (raw.length > 2 || mm > 59 || h > 23) continue
      if (!mer && /^\s*(?:h\b|hrs?\b|hours?|mins?\b|minutes?)/i.test(after)) continue // "1:20 hrs" is a length
      if (!mer && sep === '.' && PHYSICAL_AFTER.test(after)) continue // "4.25 kg", "37.80 °C"
      // "4.25" is usually a weight; a dotted time needs am/pm, a cue, a range or the start of the line.
      if (sep === '.' && !mer && !(index === 0 || cue || afterRange || rangeNextIsTime)) continue
      if (mer) {
        if (h < 1 || h > 12) continue
        end += mer.len
        push({ fixed: toFixed(h, mm, mer.mer) })
      } else if (h === 0 || h > 12 || (raw.length === 2 && raw.startsWith('0'))) {
        push({ fixed: h * 60 + mm })
      } else {
        push({ h12: h, min: mm })
      }
      continue
    }

    const n = Number(raw)
    if (raw.length >= 3) {
      // 0630, 1830 hrs, 630am
      const h = Math.floor(n / 100)
      const mi = n % 100
      if (mi > 59) continue
      if (mer && h >= 1 && h <= 12) {
        end += mer.len
        push({ fixed: toFixed(h, mi, mer.mer) })
      } else if (raw.length === 4 && h <= 23 && (/^\s*hrs?\b/i.test(after) || (index === 0 && /^\s*[-–—:)]/.test(after) && !(n >= 1900 && n <= 2099)))) {
        push({ fixed: h * 60 + mi })
      }
      continue
    }
    if (mer) {
      if (n < 1 || n > 12) continue
      end += mer.len
      push({ fixed: toFixed(n, 0, mer.mer) })
      continue
    }
    if (n < 1 || n > 12 || UNIT_AFTER.test(after)) continue
    if (rangeNextIsTime || afterRange || cue || (index === 0 && /^\s*[-–—:)]\s*(?!\d)/.test(after))) push({ h12: n, min: 0 })
  }
  return out.sort((x, y) => x.index - y.index)
}

/** Two times joined by "-", "to" or "till" form a range. */
export function rangeAfter(text: string, a: TimeToken, b: TimeToken | undefined): boolean {
  if (!b) return false
  const between = text.slice(a.end, b.index)
  // "8-9:30", "10:00 nap till 11:30", "slept 9pm woke 6am"
  return /^\s*(?:[a-z']+\s+){0,3}?(?:-|–|—|to|till|until|upto|up to|woke(?: up)?(?: at)?|up at|awake at)\s*$/i.test(between)
}

/** The two readings of an ambiguous time, in minutes after midnight. */
export function candidates(t: TimeToken): number[] {
  if (t.fixed !== undefined) return [t.fixed]
  const base = ((t.h12 ?? 0) % 12) * 60 + (t.min ?? 0)
  return [base, base + 720]
}

const WRAP_PENALTY = 240

/**
 * Picks am or pm for every ambiguous time in one day so the day reads in order with as few
 * jumps past midnight as possible. Returns minutes after the day's start (can exceed 1440
 * when the log runs past midnight).
 */
export function resolveDay(tokens: TimeToken[], reverse = false): number[] {
  if (!tokens.length) return []
  // A log written newest-first is read back to front, then turned round again.
  const seq = reverse ? [...tokens].reverse() : tokens
  const cands = seq.map(candidates)
  // Mild priors for the first entry: mornings for 5-11, afternoons for 12 and 1-4.
  const prior = (t: TimeToken, c: number) => {
    if (t.fixed !== undefined) return 0
    const h = t.h12 ?? 0
    const pm = c >= 720
    if (h === 12) return pm ? 0 : 60
    if (h >= 5 && h <= 11) return pm ? 30 : 0
    return pm ? 0 : 30
  }
  const forward = (from: number, to: number) => (to >= from ? to - from : to - from + 1440 + WRAP_PENALTY)
  let cost: number[] = cands[0].map((c) => prior(seq[0], c))
  const back: number[][] = [cands[0].map(() => -1)]
  for (let i = 1; i < seq.length; i++) {
    const nextCost: number[] = []
    const nextBack: number[] = []
    for (const c of cands[i]) {
      let best = Infinity
      let arg = 0
      cands[i - 1].forEach((p, j) => {
        const v = cost[j] + forward(p, c)
        if (v < best) {
          best = v
          arg = j
        }
      })
      nextCost.push(best)
      nextBack.push(arg)
    }
    cost = nextCost
    back.push(nextBack)
  }
  let k = cost.indexOf(Math.min(...cost))
  const picked: number[] = new Array(seq.length)
  for (let i = seq.length - 1; i >= 0; i--) {
    picked[i] = cands[i][k]
    k = back[i][k]
  }
  // Unroll past midnight so later entries land on the next day.
  const out: number[] = new Array(seq.length)
  let offset = 0
  for (let i = 0; i < seq.length; i++) {
    if (i > 0 && picked[i] < picked[i - 1]) offset += 1440
    out[i] = picked[i] + offset
  }
  return reverse ? out.reverse() : out
}

/** The end of a range, read relative to its start: the soonest reading after it. */
export function resolveEnd(startMin: number, end: TimeToken): number {
  let best = -1
  let bestGap = Infinity
  for (const c of candidates(end)) {
    const gap = (((c - startMin) % 1440) + 1440) % 1440
    if (gap > 0 && gap < bestGap) {
      bestGap = gap
      best = startMin + gap
    }
  }
  return best < 0 ? startMin : best
}

/** "1h 20m", "1.5 hrs", "90 min", "1:20 hrs" in minutes. */
export function findDuration(text: string): { minutes: number; index: number; end: number } | null {
  const lower = text.toLowerCase()
  let m = lower.match(/(\d{1,2}):(\d{2})\s*(?:h\b|hrs?\b|hours?)/)
  if (m) return { minutes: Number(m[1]) * 60 + Number(m[2]), index: m.index!, end: m.index! + m[0].length }
  m = lower.match(/(\d+(?:\.\d+)?)\s*(?:h\b|hrs?\b|hours?)\s*(?:and\s*)?(?:(\d{1,2})\s*(?:m\b|mins?\b|minutes?))?/)
  if (m) return { minutes: Math.round(Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0)), index: m.index!, end: m.index! + m[0].length }
  m = lower.match(/(\d{1,3})\s*(?:m\b|mins?\b|minutes?)/)
  if (m) return { minutes: Number(m[1]), index: m.index!, end: m.index! + m[0].length }
  return null
}
