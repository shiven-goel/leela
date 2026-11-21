// Wording for Sweet spot, shared by Today, the Sleep screen and the Sweet spot screen.
import type { FeedForecast, SleepWindow, SweetSpot } from './sweetspot'
import { durationText, fmtTime } from './time'

/** "2:05 – 2:35 PM", or "11:45 AM – 12:15 PM" across noon. */
export function fmtRange(start: number, end: number, tz: string): string {
  const a = fmtTime(start, tz)
  const b = fmtTime(end, tz)
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`
}

/** "25 min", "1h 10m". */
export function spanText(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000))
  return m < 60 ? `${m} min` : durationText(m * 60_000)
}

/** "45–90 minutes", "1–2 hours", "2½–3½ hours". */
export function rangeText(lo: number, hi: number): string {
  if (hi <= 90) return `${lo}–${hi} minutes`
  const h = (m: number) => {
    const q = Math.round((m / 60) * 4) / 4
    const whole = Math.floor(q)
    const frac = q - whole
    return `${whole || ''}${frac === 0.25 ? '¼' : frac === 0.5 ? '½' : frac === 0.75 ? '¾' : ''}` || '0'
  }
  return `${h(lo)}–${h(hi)} hours`
}
export const sleepName = (w: SleepWindow) => (w.kind === 'bedtime' ? 'Bedtime' : `Nap ${w.napNumber ?? ''}`.trim())
export const minutesText = (m: number) => durationText(Math.round(m) * 60_000)

/** One line describing what Sweet spot is based on. */
export function basisText(spot: SweetSpot, name: string): string {
  if (spot.basis === 'custom') return 'Using your own wake windows'
  if (spot.basis === 'logs') {
    const days = Math.min(14, spot.pattern.days)
    return `Learned from ${name}’s last ${days} ${days === 1 ? 'day' : 'days'}, recent days counting most`
  }
  return `Based on what’s typical at ${spot.guide.label} until more is logged`
}

/** The next feed in words: "Feed when she wakes, ~10:40 AM" or "Next feed ~4:10 PM". */
export function feedText(feed: FeedForecast, now: number, tz: string): { main: string; detail: string } {
  const every = `${feed.basis === 'logs' ? 'lately' : 'typically'} every ${minutesText(feed.everyMin)} when awake`
  if (feed.when === 'on-waking') return { main: `Feed on waking, ~${fmtTime(feed.at, tz)}`, detail: 'No feeds during long sleeps lately' }
  if (feed.at <= now) return { main: 'Next feed due now', detail: every }
  if (feed.when === 'before-sleep') return { main: `Feed before sleep, ~${fmtTime(feed.at, tz)}`, detail: 'A feed usually comes just before the long sleep' }
  const range = feed.range && feed.range[1] - feed.range[0] >= 20 * 60_000 ? `, likely ${fmtRange(feed.range[0], feed.range[1], tz)}` : ''
  return { main: `Next feed ~${fmtTime(feed.at, tz)}`, detail: `${every}${range}` }
}

/** "Rough guess" when the times at this hour vary a lot for this baby. */
export const confidenceText = (w?: SleepWindow) => (w?.confidence === 'low' ? 'rough guess: times vary at this hour' : w?.confidence === 'medium' ? 'fairly sure' : '')
