import type { EventType } from './types'

export type Tone =
  | 'sleep'
  | 'feed'
  | 'diaper'
  | 'pump'
  | 'health'
  | 'growth'
  | 'activity'
  | 'milestone'
  | 'note'
  | 'contraction'

export interface TypeMeta {
  type: EventType
  label: string
  /** What the log button says, e.g. "Log bottle". */
  action: string
  tone: Tone
  /** Can run as a live, shared timer. */
  timer: boolean
  /** Belongs to a person rather than a child. */
  familyLevel?: boolean
}

export const TYPES: Record<EventType, TypeMeta> = {
  sleep: { type: 'sleep', label: 'Sleep', action: 'Log sleep', tone: 'sleep', timer: true },
  nursing: { type: 'nursing', label: 'Breastfeed', action: 'Log breastfeed', tone: 'feed', timer: true },
  bottle: { type: 'bottle', label: 'Bottle', action: 'Log bottle', tone: 'feed', timer: false },
  solids: { type: 'solids', label: 'Solids', action: 'Log solids', tone: 'feed', timer: false },
  pump: { type: 'pump', label: 'Pumping', action: 'Log pumping', tone: 'pump', timer: true, familyLevel: true },
  diaper: { type: 'diaper', label: 'Diaper', action: 'Log diaper', tone: 'diaper', timer: false },
  potty: { type: 'potty', label: 'Potty', action: 'Log potty', tone: 'diaper', timer: false },
  growth: { type: 'growth', label: 'Growth', action: 'Log growth', tone: 'growth', timer: false },
  temperature: { type: 'temperature', label: 'Temperature', action: 'Log temperature', tone: 'health', timer: false },
  medicine: { type: 'medicine', label: 'Medicine', action: 'Log medicine', tone: 'health', timer: false },
  symptom: { type: 'symptom', label: 'Symptoms & visits', action: 'Log symptoms', tone: 'health', timer: false },
  activity: { type: 'activity', label: 'Activity', action: 'Log activity', tone: 'activity', timer: true },
  milestone: { type: 'milestone', label: 'Milestone', action: 'Save milestone', tone: 'milestone', timer: false },
  note: { type: 'note', label: 'Diary note', action: 'Save note', tone: 'note', timer: false },
  contraction: { type: 'contraction', label: 'Contraction', action: 'Log contraction', tone: 'contraction', timer: true, familyLevel: true },
}

export const MORE_GROUPS: { title: string; types: EventType[] }[] = [
  { title: 'Feeding', types: ['nursing', 'bottle', 'solids', 'pump'] },
  { title: 'Sleep and changes', types: ['sleep', 'diaper', 'potty'] },
  { title: 'Health', types: ['temperature', 'medicine', 'symptom', 'growth'] },
  { title: 'Play and memories', types: ['activity', 'milestone', 'note'] },
  { title: 'Tools', types: ['contraction'] },
]

export const ACTIVITY_KINDS = [
  { id: 'tummy', label: 'Tummy time' },
  { id: 'bath', label: 'Bath' },
  { id: 'outdoor', label: 'Outdoor play' },
  { id: 'indoor', label: 'Indoor play' },
  { id: 'story', label: 'Story time' },
  { id: 'screen', label: 'Screen time' },
  { id: 'skin', label: 'Skin-to-skin' },
  { id: 'teeth', label: 'Teeth brushing' },
] as const

export const MILESTONE_KINDS = [
  { id: 'smile', label: 'First smile' },
  { id: 'laugh', label: 'First laugh' },
  { id: 'roll', label: 'Rolled over' },
  { id: 'sit', label: 'Sat up' },
  { id: 'crawl', label: 'Crawled' },
  { id: 'tooth', label: 'First tooth' },
  { id: 'word', label: 'First word' },
  { id: 'stand', label: 'Stood up' },
  { id: 'steps', label: 'First steps' },
] as const

export const SYMPTOM_TAGS = ['Cough', 'Runny nose', 'Fussy', 'Vomiting', 'Rash', 'Diarrhea', 'Constipation', 'Teething', 'Gas']

export const SLEEP_PLACES = [
  { id: 'crib', label: 'Crib or bassinet' },
  { id: 'stroller', label: 'Stroller' },
  { id: 'car', label: 'Car seat' },
  { id: 'carrier', label: 'Carrier or held' },
  { id: 'other', label: 'Somewhere else' },
] as const

export const TEMP_METHODS = [
  { id: 'armpit', label: 'Armpit' },
  { id: 'oral', label: 'Mouth' },
  { id: 'ear', label: 'Ear' },
  { id: 'forehead', label: 'Forehead' },
  { id: 'rectal', label: 'Rectal' },
] as const

export const COMMON_ALLERGENS = ['Peanut', 'Egg', 'Milk', 'Wheat', 'Soy', 'Fish', 'Shellfish', 'Tree nuts', 'Sesame']

export const MAX_FAMILY_MEMBERS = 6

export function toneVar(tone: Tone): string {
  return `var(--${tone})`
}

export function toneSoft(tone: Tone): string {
  return `var(--${tone}-soft)`
}
