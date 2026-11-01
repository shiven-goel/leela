// Screenshots of notes, diary, import and the diary book in the dev preview. Usage: node tests/shots-notes.mjs <outdir>
import { chromium } from '@playwright/test'

const out = process.argv[2]
const base = 'http://localhost:5173/'
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const errors = []
async function open(name, q, theme = 'day') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'Asia/Kolkata' })
  await ctx.addInitScript((t) => localStorage.setItem('leela-theme', t), theme)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text()) && errors.push(`${name} console: ${m.text().slice(0, 300)}`))
  await page.goto(base + q)
  await page.waitForTimeout(1200)
  return { ctx, page }
}
const shot = async (page, name, full = true) => page.screenshot({ path: `${out}/${name}.png`, fullPage: full })

let { ctx, page } = await open('notes', '?preview&tab=notes')
await shot(page, 'notes')
await ctx.close()
;({ ctx, page } = await open('diary', '?preview&tab=diary'))
await shot(page, 'diary')
await ctx.close()
;({ ctx, page } = await open('note-editor', '?preview&tab=notes&overlay=note'))
await page.getByLabel('Title').fill('Rolled over!')
await page.getByRole('textbox', { name: 'Note' }).fill('She rolled over for the first time this morning, from tummy to back, and looked so surprised.\n\nGave vit d 1 ml at 9. Nani came over in the evening and we did tummy time 15 min together.')
await shot(page, 'note-editor', false)
await page.getByRole('button', { name: 'Save note' }).click()
await page.waitForTimeout(800)
await shot(page, 'note-suggestions', false)
await ctx.close()

;({ ctx, page } = await open('import', '?preview&tab=history&overlay=import'))
await shot(page, 'import-choose')
await page.getByLabel('Paste your log').fill(`14/09/2026
6:10 dbf 15 L
7:00 w
7:40 ff 90
8:15 ns 45m
9:30 w
10:15 d
11:00 dbf 12 R
12:30 tt 10 min
1:15 ns 1h
2:40 w + d
3:30 pcm 1.5ml, tmp 38.1
6:00 fed
8:30 fed`)
await page.getByRole('button', { name: 'Read it' }).click()
await page.waitForTimeout(1500)
await shot(page, 'import-questions')
// answer: w = wet, ns = nap, d = dirty, fed = breastfeed
for (const [term, label] of [['w', 'Wet diaper'], ['ns', 'Nap'], ['d', 'Dirty diaper']]) {
  const group = page.getByRole('radiogroup', { name: `Meaning of ${term}` })
  if (await group.count()) {
    const btn = group.getByRole('radio', { name: label, exact: true })
    if (await btn.count()) await btn.click()
    else {
      await group.locator('xpath=..').getByRole('button', { name: 'Something else' }).click()
      await group.getByRole('radio', { name: label, exact: true }).click()
    }
  }
}
const feed = page.locator('section', { hasText: 'When it just says' }).getByRole('radio', { name: 'Breastfeed', exact: true })
if (await feed.count()) await feed.click()
await page.getByRole('button', { name: 'Continue' }).click()
await page.getByText('Check before saving').waitFor({ timeout: 15000 })
await page.waitForTimeout(500)
await shot(page, 'import-review')
await ctx.close()

;({ ctx, page } = await open('book', '?preview&tab=diary&overlay=book'))
await page.getByText('Here’s how it will look').waitFor({ timeout: 15000 })
await page.waitForTimeout(800)
await shot(page, 'book')
await page.emulateMedia({ media: 'print' })
await page.pdf({ path: `${out}/book.pdf`, format: 'A4', printBackground: true }).catch((e) => errors.push('pdf: ' + e.message))
await ctx.close()

await browser.close()
console.log(errors.length ? errors.join('\n') : 'no errors')
