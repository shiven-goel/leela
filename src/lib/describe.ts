import { ACTIVITY_KINDS, MILESTONE_KINDS, SLEEP_PLACES, TEMP_METHODS, TYPES } from './config'
import { nursingSeconds, sleepKind } from './counting'
import { durationText } from './time'
import type { Family, LeelaEvent, Prefs, TimerSegment } from './types'
import { fmtLength, fmtTemp, fmtWeight } from './units'

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

export function eventTitle(e: LeelaEvent, family: Family | null): string {
  switch (e.type) {
    case 'sleep':
      return family && sleepKind(e, family) === 'night' ? 'Night sleep' : 'Nap'
    case 'activity':
      return ACTIVITY_KINDS.find((k) => k.id === e.data.kind)?.label ?? e.data.label ?? 'Activity'
    case 'milestone':
      return MILESTONE_KINDS.find((k) => k.id === e.data.kind)?.label ?? e.data.label ?? 'Milestone'
    case 'symptom':
      return e.data.kind === 'visit' ? 'Doctor visit' : e.data.kind === 'vaccine' ? 'Vaccine' : 'Symptoms'
    default:
      return TYPES[e.type].label
  }
}

export function eventDetail(
  e: LeelaEvent,
  segments: TimerSegment[],
  prefs: Prefs,
  now: number,
): string {
  const d = e.data
  const dur = () => {
    const end = e.ended_at ? Date.parse(e.ended_at) : now
    return durationText(end - Date.parse(e.started_at))
  }
  const parts: string[] = []
  switch (e.type) {
    case 'sleep': {
      parts.push(e.timer_state ? `Asleep for ${dur()}` : dur())
      const place = SLEEP_PLACES.find((p) => p.id === d.place)
      if (place) parts.push(place.label.toLowerCase())
      break
    }
    case 'nursing': {
      if (e.timer_state) parts.push(e.timer_state === 'paused' ? 'Paused' : `Feeding on the ${d.last_side ?? 'left'}`)
      if (!e.timer_state && d.left_s === undefined && d.right_s === undefined && typeof d.total_s === 'number') {
        parts.push(`${Math.round(d.total_s / 60)}m`)
        break
      }
      const s = nursingSeconds(e, segments, now)
      const l = Math.round(s.left / 60)
      const r = Math.round(s.right / 60)
      if (e.timer_state || (l && r)) parts.push(`left ${l}m, right ${r}m`)
      else if (l) parts.push(`left ${l}m`)
      else if (r) parts.push(`right ${r}m`)
      break
    }
    case 'bottle':
      if (d.amount_ml !== undefined) parts.push(`${Math.round(d.amount_ml)} ml`)
      if (d.contents) parts.push(d.contents === 'breast' ? 'breast milk' : d.contents === 'mixed' ? 'mixed' : 'formula')
      break
    case 'pump': {
      if (e.timer_state) parts.push(`Pumping for ${dur()}`)
      const total = d.total_ml ?? ((d.left_ml ?? 0) + (d.right_ml ?? 0) || undefined)
      if (d.left_ml || d.right_ml) parts.push(`left ${d.left_ml ?? 0} ml, right ${d.right_ml ?? 0} ml`)
      else if (total) parts.push(`${total} ml`)
      break
    }
    case 'solids': {
      const foods = (d.foods ?? []).map((f) => f.name).filter(Boolean)
      if (foods.length) parts.push(foods.join(', '))
      if (d.reaction) parts.push(d.reaction === 'liked' ? 'loved it' : d.reaction === 'disliked' ? 'not a fan' : 'okay')
      break
    }
    case 'diaper':
      if (d.kind) parts.push(cap(String(d.kind)))
      if (d.color) parts.push(String(d.color))
      if (d.rash) parts.push('rash')
      break
    case 'potty':
      if (d.kind) parts.push(d.kind === 'both' ? 'Pee and poo' : cap(String(d.kind)))
      if (d.outcome) parts.push(d.outcome === 'potty' ? 'on the potty' : 'accident')
      break
    case 'growth':
      if (d.weight_kg) parts.push(fmtWeight(d.weight_kg))
      if (d.length_cm) parts.push(`length ${fmtLength(d.length_cm, prefs)}`)
      if (d.head_cm) parts.push(`head ${fmtLength(d.head_cm, prefs)}`)
      break
    case 'temperature':
      if (d.temp_c !== undefined) parts.push(fmtTemp(d.temp_c, prefs))
      if (d.method) parts.push(TEMP_METHODS.find((m) => m.id === d.method)?.label.toLowerCase() ?? '')
      break
    case 'medicine':
      parts.push([d.name, d.dose, d.unit].filter(Boolean).join(' '))
      break
    case 'symptom':
      if (d.vaccine) parts.push(String(d.vaccine))
      if (d.tags?.length) parts.push(d.tags.join(', '))
      break
    case 'activity':
      if (e.timer_state) parts.push(`Going for ${dur()}`)
      else if (e.ended_at) parts.push(dur())
      break
    case 'contraction':
      if (e.timer_state) parts.push(`${dur()} so far`)
      else if (e.ended_at) {
        const secs = Math.round((Date.parse(e.ended_at) - Date.parse(e.started_at)) / 1000)
        parts.push(secs < 120 ? `${secs}s` : durationText(secs * 1000))
      }
      if (d.intensity) parts.push(String(d.intensity))
      break
    default:
      break
  }
  if (e.type === 'note') {
    const body = noteBody(e)
    if (body) parts.push(body.split('\n').find((l) => l.trim()) ?? '')
  } else if (e.notes && parts.filter(Boolean).length === 0) parts.push(e.notes.split('\n')[0])
  return parts.filter(Boolean).join(', ')
}

/** A note's full text: long notes keep it in data.body, older ones in notes. */
export function noteBody(e: LeelaEvent): string {
  return typeof e.data.body === 'string' ? e.data.body : (e.notes ?? '')
}

/** A note's heading: its title, else its first line. */
export function noteTitle(e: LeelaEvent): string {
  const t = typeof e.data.title === 'string' ? e.data.title.trim() : ''
  if (t) return t
  const first = noteBody(e).split('\n').find((l) => l.trim())?.trim() ?? ''
  return first.length > 70 ? `${first.slice(0, 68).trimEnd()}…` : first || 'Note'
}
