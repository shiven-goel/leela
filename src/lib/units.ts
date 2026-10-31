import type { Prefs } from './types'

export const CM_PER_IN = 2.54

export function lengthUnit(prefs: Prefs): 'cm' | 'in' {
  return prefs.length === 'in' ? 'in' : 'cm'
}

export function tempUnit(prefs: Prefs): 'c' | 'f' {
  return prefs.temp === 'f' ? 'f' : 'c'
}

export function cToF(c: number): number {
  return (c * 9) / 5 + 32
}

export function fToC(f: number): number {
  return ((f - 32) * 5) / 9
}

const round = (n: number, digits = 1) => {
  const p = 10 ** digits
  return Math.round(n * p) / p
}

export function fmtTemp(c: number, prefs: Prefs): string {
  return tempUnit(prefs) === 'f' ? `${round(cToF(c))} °F` : `${round(c)} °C`
}

export function fmtLength(cm: number, prefs: Prefs): string {
  return lengthUnit(prefs) === 'in' ? `${round(cm / CM_PER_IN)} in` : `${round(cm)} cm`
}

export function fmtWeight(kg: number): string {
  return `${round(kg, 2)} kg`
}

export function fmtMl(ml: number): string {
  return `${Math.round(ml)} ml`
}

export function fmtLitres(ml: number): string {
  return ml >= 1000 ? `${round(ml / 1000)} litres` : fmtMl(ml)
}

/** Fever threshold: 38.0 °C / 100.4 °F. */
export const FEVER_C = 38
