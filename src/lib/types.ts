export type EventType =
  | 'sleep'
  | 'nursing'
  | 'bottle'
  | 'pump'
  | 'solids'
  | 'diaper'
  | 'potty'
  | 'growth'
  | 'temperature'
  | 'medicine'
  | 'symptom'
  | 'activity'
  | 'milestone'
  | 'note'
  | 'contraction'

export type Side = 'left' | 'right'
export type TimerState = 'running' | 'paused' | null

// Type-specific fields stored in events.data. Everything is optional so old rows never break the app.
export interface EventData {
  // sleep
  place?: 'crib' | 'stroller' | 'car' | 'carrier' | 'other'
  kind?: string
  // nursing
  left_s?: number
  right_s?: number
  last_side?: Side
  /** Breastfeeding time when the sides weren't recorded (imported logs). */
  total_s?: number
  // bottle
  amount_ml?: number
  contents?: 'breast' | 'formula' | 'mixed'
  // pumping
  left_ml?: number
  right_ml?: number
  total_ml?: number
  // solids
  foods?: { name: string; first?: boolean; allergen?: boolean }[]
  eaten?: 'taste' | 'some' | 'most' | 'all'
  reaction?: 'liked' | 'neutral' | 'disliked'
  // diaper / potty
  color?: string
  texture?: string
  rash?: boolean
  outcome?: 'potty' | 'accident'
  // growth
  weight_kg?: number
  length_cm?: number
  head_cm?: number
  // temperature
  temp_c?: number
  method?: 'armpit' | 'oral' | 'ear' | 'forehead' | 'rectal'
  // medicine
  name?: string
  dose?: string
  unit?: string
  // symptoms & visits
  tags?: string[]
  vaccine?: string
  // activities & milestones
  label?: string
  // notes: long text lives here, the short `notes` column is for comments on other entries
  title?: string
  body?: string
  /** An entry added from a note keeps a link to it. */
  from_note?: string
  // contractions
  intensity?: 'mild' | 'moderate' | 'strong'
  [key: string]: unknown
}

export interface LeelaEvent {
  id: string
  family_id: string
  child_id: string | null
  type: EventType
  started_at: string
  ended_at: string | null
  timer_state: TimerState
  data: EventData
  photo_paths: string[]
  notes: string | null
  source: 'app' | 'import'
  import_id: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  /** Client-only: an optimistic copy the server hasn't confirmed yet. */
  _local?: boolean
}

export interface TimerSegment {
  id: string
  event_id: string
  family_id: string
  side: Side | null
  started_at: string
  ended_at: string | null
}

export interface Family {
  id: string
  name: string
  code: string
  owner_id: string | null
  timezone: string
  night_start: string
  night_end: string
}

export interface Member {
  family_id: string
  user_id: string
  joined_at: string
  last_seen_at: string
}

export interface Profile {
  id: string
  display_name: string
  avatar_path: string | null
  prefs: Prefs
}

export interface Prefs {
  length?: 'cm' | 'in'
  temp?: 'c' | 'f'
  /** Words this parent has taught Leela: word -> meaning id (see import/vocab.ts). */
  vocab?: Record<string, string>
  /** What a bare "fed" means in this parent's notes. */
  feedDefault?: 'nursing' | 'bottle'
  /** How this parent writes numeric dates. */
  dateOrder?: 'dmy' | 'mdy'
}

export interface Child {
  id: string
  family_id: string
  name: string
  birth_date: string | null
  due_date: string | null
  sex: 'female' | 'male' | null
  avatar_path: string | null
  settings: Record<string, unknown>
  created_at: string
  deleted_at: string | null
}
