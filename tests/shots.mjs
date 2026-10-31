// Design review screenshots of the dev preview (seeded data). Usage: node tests/shots.mjs <outdir>
import { chromium } from '@playwright/test'

const out = process.argv[2]
const base = 'http://localhost:5173/'
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const shots = [
  ['today-awake', '?preview&tab=today', 'day'],
  ['today-asleep', '?preview=asleep', 'day'],
  ['today-feeding', '?preview=feeding', 'day'],
  ['today-night', '?preview=asleep', 'night'],
  ['history', '?preview&tab=history', 'day'],
  ['diary', '?preview&tab=diary', 'day'],
  ['family', '?preview&tab=family', 'day'],
  ['auth', '', 'day'],
]
const errors = []
for (const [name, q, theme] of shots) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'Asia/Kolkata' })
  await ctx.addInitScript((t) => localStorage.setItem('leela-theme', t), theme)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name} console: ${m.text()}`))
  await page.goto(base + q)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true })
  await ctx.close()
}
await browser.close()
console.log(errors.length ? errors.join('\n') : 'no errors')
