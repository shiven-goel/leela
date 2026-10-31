import { useId } from 'react'

/** Leela's mark: a crescent holding a small star, day turning to night. */
export function LeelaMark({ className }: { className?: string }) {
  const id = useId()
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <mask id={`m${id}`}>
          <rect width="64" height="64" fill="#fff" />
          <circle cx="40" cy="25" r="16" fill="#000" />
        </mask>
      </defs>
      <rect width="64" height="64" rx="18" fill="var(--brand, #3B2FB0)" />
      <circle cx="31" cy="34" r="19" fill="#F7C873" mask={`url(#m${id})`} />
      <circle cx="42" cy="27" r="4.2" fill="#F7C873" />
    </svg>
  )
}
