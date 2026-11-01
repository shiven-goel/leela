import { useLayoutEffect, useRef, useState } from 'react'

/** The rendered width of an element, so charts draw at real pixels (crisp lines, unstretched text). */
export function useWidth<T extends HTMLElement>(fallback = 360) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(Math.max(200, Math.round(el.getBoundingClientRect().width)))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}
