import {
  Bathtub,
  Baby,
  BookOpen,
  BowlFood,
  DropHalfBottom,
  HandHeart,
  MoonStars,
  NotePencil,
  Pill,
  Plant,
  Pulse,
  Ruler,
  Sparkle,
  Star,
  Stethoscope,
  Sun,
  Television,
  Thermometer,
  Toilet,
  Tooth,
  type IconProps,
} from '@phosphor-icons/react'
import type { ComponentType } from 'react'
import type { EventType } from '../lib/types'

type Svg = { size?: number; className?: string; weight?: IconProps['weight'] }

// Original icons for the two things Phosphor doesn't draw: a feeding bottle and a diaper.
export function BottleIcon({ size = 24, className }: Svg) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" className={className} aria-hidden="true">
      <path d="M96 92h64l10 28v96a24 24 0 0 1-24 24h-36a24 24 0 0 1-24-24v-96Z" fill="currentColor" opacity="0.2" />
      <path
        d="M110 40c0-10 8-18 18-18s18 8 18 18v24m-50 28h64l10 28v96a24 24 0 0 1-24 24h-36a24 24 0 0 1-24-24v-96Zm-8-28h80v28H88zM86 152h28m-28 36h28"
        fill="none"
        stroke="currentColor"
        strokeWidth="16"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function DiaperIcon({ size = 24, className }: Svg) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" className={className} aria-hidden="true">
      <path d="M32 72h192v28c0 56-40 100-96 100S32 156 32 100Z" fill="currentColor" opacity="0.2" />
      <path
        d="M32 72h192v28c0 56-40 100-96 100S32 156 32 100Zm0 28c24 0 40 12 52 36m140-36c-24 0-40 12-52 36"
        fill="none"
        stroke="currentColor"
        strokeWidth="16"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="78" cy="96" r="6" fill="currentColor" />
      <circle cx="178" cy="96" r="6" fill="currentColor" />
    </svg>
  )
}

const PH: Partial<Record<EventType, ComponentType<IconProps>>> = {
  sleep: MoonStars,
  nursing: HandHeart,
  solids: BowlFood,
  pump: DropHalfBottom,
  potty: Toilet,
  growth: Ruler,
  temperature: Thermometer,
  medicine: Pill,
  symptom: Stethoscope,
  activity: Sun,
  milestone: Star,
  note: NotePencil,
  contraction: Pulse,
}

const ACTIVITY_ICONS: Record<string, ComponentType<IconProps>> = {
  tummy: Baby,
  bath: Bathtub,
  outdoor: Sun,
  indoor: Plant,
  story: BookOpen,
  screen: Television,
  skin: HandHeart,
  teeth: Tooth,
}

export function TypeIcon({ type, kind, size = 22, className }: { type: EventType; kind?: string; size?: number; className?: string }) {
  if (type === 'bottle') return <BottleIcon size={size} className={className} />
  if (type === 'diaper') return <DiaperIcon size={size} className={className} />
  const Comp = (type === 'activity' && kind && ACTIVITY_ICONS[kind]) || PH[type] || Sparkle
  return <Comp size={size} weight="duotone" className={className} aria-hidden="true" />
}
