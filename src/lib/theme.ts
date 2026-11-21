import type { Family } from './types'

/**
 * dark: the everyday look, soft dark with clear text, gentle around the baby (the default).
 * night: warmer and dimmer, amber text on deep navy, for the middle of the night.
 * day: light, for bright daylight.
 */
export type ThemeMode = 'dark' | 'night' | 'day'

export function getThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem('leela-theme')
    return v === 'day' || v === 'night' ? v : 'dark'
  } catch {
    return 'dark'
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

const BAR: Record<ThemeMode, string> = { dark: '#0e1120', night: '#0a0d1d', day: '#f1f3fa' }

export function applyTheme(_family?: Family | null) {
  const theme = getThemeMode()
  if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', BAR[theme]))
}
