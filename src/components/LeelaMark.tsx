/** The LAPdiary mark: "LAP" in ivory, with the A's crossbar a small amber curve, like a lap. */
export function LeelaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <rect width="100" height="100" rx="24" fill="#15171F" />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4.2">
        <path d="M21 38 V62 H33" stroke="#EDE6D8" />
        <path d="M40 62 L50 37.5 L60 62" stroke="#EDE6D8" />
        <path d="M44.4 53 Q50 58.6 55.6 53" stroke="#D9A86C" strokeWidth="3.4" />
        <path d="M67 62 V38 H74 Q81.5 38 81.5 45 Q81.5 52 74 52 H67" stroke="#EDE6D8" />
      </g>
    </svg>
  )
}
