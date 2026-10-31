import type { ReactNode } from 'react'
import { eventEndMs } from '../lib/counting'
import type { NapEstimate } from '../lib/nap'
import { minuteOfDay } from '../lib/time'
import type { Family, LeelaEvent } from '../lib/types'

const H = 3_600_000
const SIZE = 320
const C = SIZE / 2
const R = 116 // sleep track
const R_FEED = 88
const R_DIAPER = 72

/** Clockwise from the top, with noon at the top and midnight at the bottom. */
function angleOf(t: number, timeZone: string): number {
  return ((minuteOfDay(t, timeZone) - 720) / 1440) * 360
}

function point(angle: number, r: number) {
  const rad = (angle * Math.PI) / 180
  return { x: C + r * Math.sin(rad), y: C - r * Math.cos(rad) }
}

function arcPath(a1: number, a2: number, r: number): string {
  let sweep = a2 - a1
  while (sweep < 0) sweep += 360
  if (sweep >= 359.9) sweep = 359.9
  const p1 = point(a1, r)
  const p2 = point(a1 + sweep, r)
  const large = sweep > 180 ? 1 : 0
  return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/**
 * Leela's day ring: the last 21 hours and the next 3 around a 24-hour clock.
 * Sleep is the thick arc, feeds are the gold dots, diapers the teal ones.
 */
export function DayRing({
  events,
  childId,
  family,
  now,
  estimate,
  center,
  label,
}: {
  events: LeelaEvent[]
  childId: string
  family: Family
  now: number
  estimate: NapEstimate | null
  center: ReactNode
  label: string
}) {
  const tz = family.timezone
  const from = now - 21 * H
  const to = now + 3 * H

  const sleeps: { d: string; running: boolean; key: string }[] = []
  const feeds: { x: number; y: number; key: string }[] = []
  const diapers: { x: number; y: number; key: string }[] = []

  for (const e of events) {
    if (e.deleted_at) continue
    if (e.child_id && e.child_id !== childId) continue
    const start = Date.parse(e.started_at)
    if (e.type === 'sleep') {
      const end = Math.min(eventEndMs(e, now), now)
      if (end < from || start > now) continue
      const s = Math.max(start, from)
      if (end - s < 60_000) continue
      sleeps.push({ d: arcPath(angleOf(s, tz), angleOf(end, tz), R), running: Boolean(e.timer_state), key: e.id })
    } else if (start >= from && start <= now) {
      if (e.type === 'nursing' || e.type === 'bottle' || e.type === 'solids') {
        feeds.push({ ...point(angleOf(start, tz), R_FEED), key: e.id })
      } else if (e.type === 'diaper' || e.type === 'potty') {
        diapers.push({ ...point(angleOf(start, tz), R_DIAPER), key: e.id })
      }
    }
  }

  const nowA = angleOf(now, tz)
  const nowP = point(nowA, R)
  const nightA1 = ((toMin(family.night_start) - 720) / 1440) * 360
  const nightA2 = ((toMin(family.night_end) - 720) / 1440) * 360
  const futureEnd = angleOf(to, tz)
  const est =
    estimate && estimate.kind !== 'newborn' && estimate.end > now && estimate.start < to
      ? arcPath(angleOf(Math.max(estimate.start, now), tz), angleOf(Math.min(estimate.end, to), tz), R)
      : null

  const sun = point(0, R + 31)
  const moon = point(180, R + 31)
  const six = point(270, R + 31)
  const eighteen = point(90, R + 31)

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[330px]">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full" role="img" aria-label={label}>
        {/* Day and night halves of the clock, following the family's night window. */}
        <circle cx={C} cy={C} r={R} fill="none" stroke="var(--ring-day)" strokeWidth={26} />
        <path d={arcPath(nightA1, nightA2, R)} fill="none" stroke="var(--ring-night)" strokeWidth={26} />
        {/* The next three hours are still to come. */}
        <path d={arcPath(nowA, futureEnd, R)} fill="none" stroke="var(--card)" strokeWidth={26} opacity={0.7} />

        {sleeps.map((s) => (
          <path key={s.key} d={s.d} fill="none" stroke="var(--sleep)" strokeWidth={20} strokeLinecap="round" />
        ))}
        {est && (
          <path
            d={est}
            fill="none"
            stroke="var(--sleep)"
            strokeWidth={20}
            strokeLinecap="round"
            strokeDasharray="2 9"
            opacity={0.85}
          />
        )}

        {feeds.map((f) => (
          <circle key={f.key} cx={f.x} cy={f.y} r={5.5} fill="var(--feed)" />
        ))}
        {diapers.map((f) => (
          <circle key={f.key} cx={f.x} cy={f.y} r={4.5} fill="var(--diaper)" />
        ))}

        {/* Now */}
        <circle cx={nowP.x} cy={nowP.y} r={9} fill="var(--card)" />
        <circle cx={nowP.x} cy={nowP.y} r={5.5} fill="var(--ink)" />

        {/* Noon sun, midnight moon, 6 AM and 6 PM */}
        <g fill="none" stroke="var(--ink-3)" strokeWidth={2} strokeLinecap="round">
          <circle cx={sun.x} cy={sun.y} r={4.5} />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
            const r1 = 7.5
            const r2 = 10
            const rad = (a * Math.PI) / 180
            return (
              <line
                key={a}
                x1={sun.x + r1 * Math.sin(rad)}
                y1={sun.y - r1 * Math.cos(rad)}
                x2={sun.x + r2 * Math.sin(rad)}
                y2={sun.y - r2 * Math.cos(rad)}
              />
            )
          })}
        </g>
        <path
          d={`M ${moon.x + 3} ${moon.y - 7} a 7.5 7.5 0 1 0 5 12.5 a 6 6 0 0 1 -5 -12.5 z`}
          fill="var(--ink-3)"
        />
        <text x={six.x} y={six.y + 4} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--ink-3)">
          6a
        </text>
        <text x={eighteen.x} y={eighteen.y + 4} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--ink-3)">
          6p
        </text>
      </svg>
      <div className="pointer-events-none absolute inset-[22%] flex flex-col items-center justify-center text-center">
        {center}
      </div>
    </div>
  )
}
