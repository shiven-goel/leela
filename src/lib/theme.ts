import { inNightWindow } from './counting'
import type { Family } from './types'

export type ThemeMode = 'auto' | 'day' | 'night'

export function getThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem('leela-theme')
    return v === 'day' || v === 'night' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export function setThemeMode(mode: ThemeMode, family: Family | null) {
  try {
    localStorage.setItem('leela-theme', mode)
  } catch {
    /* private mode */
  }
  applyTheme(family)
}

/** Night mode follows the family's night window unless someone picks day or night. */
export function applyTheme(family: Family | null) {
  const mode = getThemeMode()
  const night =
    mode === 'night' ||
    (mode === 'auto' &&
      (family
        ? inNightWindow(Date.now(), family)
        : (() => {
            const h = new Date().getHours()
            return h >= 19 || h < 7
          })()))
  const theme = night ? 'night' : 'day'
  if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme
  const meta = document.querySelectorAll('meta[name="theme-color"]')
  meta.forEach((m) => m.setAttribute('content', night ? '#0A0D1D' : '#F1F3FA'))
}
