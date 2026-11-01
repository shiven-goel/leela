// Wording for Sweet spot, shared by Today, the Sleep screen and the Sweet spot screen.
import type { SleepWindow, SweetSpot } from './sweetspot'
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
  if (spot.basis === 'logs') return `Based on ${name}’s last ${Math.min(7, spot.pattern.days)} days and age`
  return `Based on what’s typical at ${spot.guide.label}`
}
