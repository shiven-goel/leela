import { useEffect, useState } from 'react'

/** Re-renders on an interval, aligned to the clock, so timers on every phone tick together. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let timer: number
    const tick = () => {
      setNow(Date.now())
      timer = window.setTimeout(tick, intervalMs - (Date.now() % intervalMs))
    }
    timer = window.setTimeout(tick, intervalMs - (Date.now() % intervalMs))
    return () => window.clearTimeout(timer)
  }, [intervalMs])
  return now
}
