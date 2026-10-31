import { TZDate, tz } from '@date-fns/tz'
import { addDays, differenceInCalendarDays, format, startOfDay } from 'date-fns'

export type DateLike = Date | string | number

const toDate = (d: DateLike) => (d instanceof Date ? d : new Date(d))

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function fmtTime(d: DateLike, timeZone: string): string {
  return format(toDate(d), 'h:mm a', { in: tz(timeZone) })
}

export function fmtShortDate(d: DateLike, timeZone: string): string {
  return format(toDate(d), 'd MMM', { in: tz(timeZone) })
}

export function fmtLongDate(d: DateLike, timeZone: string): string {
  return format(toDate(d), 'EEEE, d MMMM yyyy', { in: tz(timeZone) })
}

export function dayStart(d: DateLike, timeZone: string): Date {
  return startOfDay(toDate(d), { in: tz(timeZone) })
}

export function addDaysTz(d: DateLike, days: number, timeZone: string): Date {
  return addDays(toDate(d), days, { in: tz(timeZone) })
}

export function dayKey(d: DateLike, timeZone: string): string {
  return format(toDate(d), 'yyyy-MM-dd', { in: tz(timeZone) })
}

export function daysBetween(later: DateLike, earlier: DateLike, timeZone: string): number {
  return differenceInCalendarDays(toDate(later), toDate(earlier), { in: tz(timeZone) })
}

export function dayLabel(d: DateLike, timeZone: string, now: DateLike = Date.now()): string {
  const diff = daysBetween(now, d, timeZone)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff > 1 && diff < 7) return format(toDate(d), 'EEEE', { in: tz(timeZone) })
  return format(toDate(d), 'EEE, d MMM', { in: tz(timeZone) })
}

/** Minutes since local midnight in the family's time zone. */
export function minuteOfDay(d: DateLike, timeZone: string): number {
  const date = new TZDate(toDate(d).getTime(), timeZone)
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60
}

/** "yyyy-MM-ddTHH:mm" in the family's time zone, for <input type="datetime-local">. */
export function toLocalInput(d: DateLike, timeZone: string): string {
  return format(toDate(d), "yyyy-MM-dd'T'HH:mm", { in: tz(timeZone) })
}

export function fromLocalInput(value: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!m) return null
  const [, y, mo, da, h, mi] = m.map(Number)
  return new Date(new TZDate(y, mo - 1, da, h, mi, timeZone).getTime())
}

/** A date at a given local time ("HH:mm") on the same local day as `day`. */
export function atLocalTime(day: DateLike, hhmm: string, timeZone: string): Date {
  const base = new TZDate(toDate(day).getTime(), timeZone)
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(new TZDate(base.getFullYear(), base.getMonth(), base.getDate(), h || 0, m || 0, timeZone).getTime())
}

export function durationText(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

export function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

export function agoText(d: DateLike, now: number = Date.now()): string {
  const ms = now - toDate(d).getTime()
  if (ms < 60_000) return 'just now'
  return `${durationText(ms)} ago`
}

/** Age as "3 months, 2 weeks" style text. */
export function ageText(birthDate: string, now: DateLike = Date.now()): string {
  const birth = new Date(`${birthDate}T00:00:00`)
  const days = Math.floor((toDate(now).getTime() - birth.getTime()) / 86_400_000)
  if (days < 0) return 'Not born yet'
  if (days < 14) return days === 1 ? '1 day old' : `${days} days old`
  if (days < 60) {
    const w = Math.floor(days / 7)
    return `${w} weeks old`
  }
  const months = Math.floor(days / 30.4375)
  if (months < 24) {
    const rem = Math.floor((days - months * 30.4375) / 7)
    return rem > 0 ? `${months} months, ${rem} ${rem === 1 ? 'week' : 'weeks'}` : `${months} months old`
  }
  const years = Math.floor(months / 12)
  const remM = months % 12
  return remM ? `${years} y ${remM} m` : `${years} years old`
}
