// Two-phone end-to-end test against the live backend. Usage: node tests/e2e.mjs [screenshot-dir]
import { chromium } from '@playwright/test'

const base = process.env.BASE ?? 'http://localhost:5173/'
const out = process.argv[2]
const stamp = Date.now().toString(36)
const pw = 'leela-test-' + stamp
const results = []
const ok = (name, pass, extra = '') => results.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const mk = async (who) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'Asia/Kolkata' })
  await ctx.addInitScript(() => localStorage.setItem('leela-theme', 'day'))
  const page = await ctx.newPage()
  page.on('pageerror', (e) => results.push(`PAGEERROR ${who}: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && results.push(`CONSOLE ${who}: ${m.text().slice(0, 200)}`))
  return { ctx, page }
}
const mom = await mk('mom')
const dad = await mk('dad')

async function signUp(p, name, email) {
  await p.goto(base)
  await p.getByLabel('Your name').fill(name)
  await p.getByLabel('Email').fill(email)
  await p.getByLabel('Password').fill(pw)
  await p.getByRole('button', { name: 'Create account', exact: true }).click()
  await p.getByText('Set up your family').waitFor({ timeout: 20000 })
}

const wetCount = (p) => p.locator('li', { hasText: 'Wet, by Mom' }).count()

try {
  // 1. Mom creates the family and adds the baby
  await signUp(mom.page, 'Mom', `mom-${stamp}@leela.test`)
  ok('Mom signs up without an email', true)
  await mom.page.getByRole('button', { name: /Start a new family/ }).click()
  await mom.page.getByLabel('Family name').fill('Test family')
  await mom.page.getByRole('button', { name: 'Create family' }).click()
  await mom.page.getByText('Add your baby').waitFor()
  await mom.page.getByLabel('Name').fill('Test baby')
  const birth = new Date(Date.now() - 100 * 86400000).toISOString().slice(0, 10)
  await mom.page.getByLabel('Birth date').fill(birth)
  await mom.page.getByRole('button', { name: 'Continue' }).click()
  await mom.page.getByText('Invite your family').waitFor()
  const code = (await mom.page.getByText(/^LEELA-[A-Z0-9]{4}-[A-Z0-9]{4}$/).first().textContent()).trim()
  ok('Family code shown', /^LEELA-/.test(code), code)
  if (out) await mom.page.screenshot({ path: `${out}/e2e-code.png` })
  await mom.page.getByRole('button', { name: 'Go to Leela' }).click()
  await mom.page.getByRole('heading', { name: 'Test baby' }).waitFor()

  // 2. Dad joins with the code
  await signUp(dad.page, 'Dad', `dad-${stamp}@leela.test`)
  await dad.page.getByRole('button', { name: /I have a family code/ }).click()
  await dad.page.getByLabel('Family code').fill('XXXX-XXXX')
  await dad.page.getByRole('button', { name: 'Check code' }).click()
  await dad.page.getByRole('alert').waitFor()
  ok('Wrong code is refused', /doesn’t match/.test(await dad.page.getByRole('alert').textContent()))
  await dad.page.getByLabel('Family code').fill(code.toLowerCase())
  await dad.page.getByRole('button', { name: 'Check code' }).click()
  await dad.page.getByText('Join Test family?').waitFor()
  const preview = await dad.page.locator('dl').textContent()
  ok('Preview shows members and baby', preview.includes('Mom') && preview.includes('Test baby'), preview)
  await dad.page.getByRole('button', { name: 'Join family' }).click()
  await dad.page.getByRole('heading', { name: 'Test baby' }).waitFor({ timeout: 15000 })
  ok('Dad joins and sees the baby', true)
  await mom.page.waitForTimeout(2500)

  // 3. Mom logs a diaper in two taps; Dad sees it live
  await mom.page.getByRole('button', { name: /^Diaper/ }).click()
  await mom.page.getByRole('button', { name: 'Wet', exact: true }).click()
  const t0 = Date.now()
  await dad.page.locator('li', { hasText: 'Wet, by Mom' }).first().waitFor({ timeout: 10000 })
  ok('Diaper appears on Dad’s phone', Date.now() - t0 < 2500, `${Date.now() - t0} ms`)

  // 4. Shared sleep timer: Mom starts, Dad stops
  await mom.page.getByRole('button', { name: /^Sleep/ }).click()
  const t1 = Date.now()
  await dad.page.getByRole('region', { name: /^Asleep/ }).waitFor({ timeout: 10000 })
  ok('Sleep timer appears on Dad’s phone', Date.now() - t1 < 2500, `${Date.now() - t1} ms`)
  await dad.page.getByRole('button', { name: 'Stop asleep' }).click()
  const t2 = Date.now()
  await mom.page.getByRole('region', { name: /^Asleep/ }).waitFor({ state: 'detached', timeout: 10000 })
  ok('Dad stops it and Mom’s timer ends', Date.now() - t2 < 2500, `${Date.now() - t2} ms`)

  // 5. Both start a sleep timer in the same moment: exactly one survives
  await Promise.all([mom.page.getByRole('button', { name: /^Sleep/ }).click(), dad.page.getByRole('button', { name: /^Sleep/ }).click()])
  await mom.page.waitForTimeout(5000)
  const momTimers = await mom.page.getByRole('region', { name: /^Asleep/ }).count()
  const dadTimers = await dad.page.getByRole('region', { name: /^Asleep/ }).count()
  ok('Simultaneous starts leave one timer', momTimers === 1 && dadTimers === 1, `mom ${momTimers}, dad ${dadTimers}`)
  await mom.page.getByRole('button', { name: 'Stop asleep' }).click()
  await dad.page.getByRole('region', { name: /^Asleep/ }).waitFor({ state: 'detached', timeout: 10000 })

  // 6. Backdating: Dad adds a bottle to two days ago from History
  await dad.page.getByRole('button', { name: 'History' }).click()
  await dad.page.getByRole('tab').nth(2).click()
  await dad.page.getByRole('button', { name: /Add to this day/ }).click()
  await dad.page.getByRole('button', { name: 'Bottle' }).click()
  await dad.page.getByRole('button', { name: 'Log bottle' }).click()
  await dad.page.getByText(/90 ml, formula, by you/).waitFor({ timeout: 5000 })
  await mom.page.getByRole('button', { name: 'History' }).click()
  await mom.page.getByRole('tab').nth(2).click()
  await mom.page.getByText(/90 ml, formula, by Dad/).waitFor({ timeout: 10000 })
  ok('Backdated bottle lands on that day for both', true)
  await dad.page.getByRole('tab').nth(0).click()
  ok('It does not show on today', (await dad.page.getByText(/90 ml, formula/).count()) === 0)
  await mom.page.getByRole('button', { name: 'Today' }).click()
  await dad.page.getByRole('button', { name: 'Today' }).click()
  await dad.page.waitForTimeout(1000)

  // 7. Offline: Mom logs three diapers, reconnects, everything syncs once
  const before = await wetCount(dad.page)
  await mom.ctx.setOffline(true)
  for (let i = 0; i < 3; i++) {
    await mom.page.getByRole('button', { name: /^Diaper/ }).click()
    await mom.page.getByRole('button', { name: 'Wet', exact: true }).click()
    await mom.page.waitForTimeout(500)
  }
  await mom.page.getByText(/Offline/).first().waitFor({ timeout: 8000 })
  const status = await mom.page.getByText(/Offline/).first().textContent()
  if (out) await mom.page.screenshot({ path: `${out}/e2e-offline.png` })
  ok('Offline indicator shows waiting changes', /waiting/.test(status ?? ''), status ?? '')
  await mom.ctx.setOffline(false)
  const t3 = Date.now()
  await dad.page.waitForFunction(
    (n) => [...document.querySelectorAll('li')].filter((li) => li.textContent.includes('Wet, by Mom')).length >= n,
    before + 3,
    { timeout: 30000 },
  )
  await dad.page.waitForTimeout(3000)
  const after = await wetCount(dad.page)
  ok('Offline diapers sync once, no duplicates', after === before + 3, `${before} -> ${after}, ${Date.now() - t3} ms after reconnect`)

  // 8. Delete with Undo, on both phones
  const rowsBefore = await dad.page.locator('ol li').count()
  await mom.page.locator('ol li').first().click()
  await mom.page.getByRole('button', { name: 'Delete entry' }).click()
  await dad.page.waitForFunction((n) => document.querySelectorAll('ol li').length === n - 1, rowsBefore, { timeout: 10000 })
  ok('Delete disappears on Dad’s phone', true)
  await mom.page.getByRole('button', { name: 'Undo' }).click()
  await dad.page.waitForFunction((n) => document.querySelectorAll('ol li').length === n, rowsBefore, { timeout: 10000 })
  ok('Undo brings it back on Dad’s phone', true)

  if (out) {
    await mom.page.screenshot({ path: `${out}/e2e-mom.png`, fullPage: true })
    await dad.page.screenshot({ path: `${out}/e2e-dad.png`, fullPage: true })
  }
} catch (e) {
  results.push(`ERROR ${e.message.split('\n')[0]}`)
  if (out) {
    await mom.page.screenshot({ path: `${out}/e2e-fail-mom.png`, fullPage: true }).catch(() => {})
    await dad.page.screenshot({ path: `${out}/e2e-fail-dad.png`, fullPage: true }).catch(() => {})
  }
} finally {
  console.log(results.join('\n'))
  console.log(`accounts: mom-${stamp}@leela.test / dad-${stamp}@leela.test, password ${pw}`)
  await browser.close()
}
