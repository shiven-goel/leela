// End-to-end test of Leela: real browsers against the live backend, run on GitHub Actions.
// Mom and Dad on their own phones, Mom on a second phone, a grandparent who joins later and a
// stranger. MODE=full runs everything; MODE=canary only checks the long-running canary family.
// Writes e2e-results/report.md, report.json, screenshots of failures and the diary book PDF.
import { chromium, devices } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { dayIso, dayLong, makeFixtures } from './fixtures.mjs'

const BASE = process.env.BASE ?? 'http://localhost:4173/'
const LIVE = process.env.LIVE_URL ?? 'https://shiven-goel.github.io/leela/'
const OUT = path.resolve(process.env.OUT ?? 'e2e-results')
const MODE = process.env.MODE ?? 'full'
const CANARY_DIR = path.resolve(process.env.CANARY_DIR ?? '.canary')
const TZ = 'Asia/Kolkata'
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(`${OUT}/shots`, { recursive: true })

const env = Object.fromEntries(
  fs
    .readFileSync('.env.production', 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const SUPA = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY
const RUN = `${dayIso(0).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6)}`
const PW = `e2e-${crypto.randomUUID()}`
const email = (who) => `e2e-${RUN}-${who}@leela.test`
/** A clock time some minutes ago, in the family's time zone, never before today's midnight. */
const clock = (minsAgo) => {
  const midnight = Date.parse(`${dayIso(0)}T00:01:00+05:30`)
  return new Date(Math.max(Date.now() - minsAgo * 60_000, midnight)).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
}

// ---------------------------------------------------------------------------- harness
const results = []
const errors = []
const timings = {}
const phones = []
let browser = null
const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`)
const passed = (id) => results.find((r) => r.id === id)?.status === 'pass'

async function snap(id) {
  const files = []
  for (const p of phones) {
    if (p.page.isClosed()) continue
    const file = `shots/${id}-${p.label}.png`
    try {
      await p.page.screenshot({ path: `${OUT}/${file}`, timeout: 5000 })
      files.push(file)
    } catch {
      /* a page that's gone can't be photographed */
    }
  }
  return files
}

/** After a failure, put every phone back on a clean screen so one failure doesn't topple the rest. */
async function recover() {
  for (const p of phones) {
    try {
      await p.ctx.setOffline(false)
      p.confirm = true
      await p.page.reload({ timeout: 20_000 })
      await p.page.waitForTimeout(1500)
    } catch {
      /* best effort */
    }
  }
}

async function check(id, name, fn, opts = {}) {
  const missing = (opts.needs ?? []).filter((n) => !passed(n))
  if (missing.length) {
    results.push({ id, name, status: 'skip', note: `needs ${missing.join(', ')}` })
    log(`SKIP ${id} ${name}`)
    return false
  }
  const t0 = Date.now()
  try {
    const note = await fn()
    results.push({ id, name, status: 'pass', ms: Date.now() - t0, note: note ?? '' })
    log(`PASS ${id} ${name}${note ? ` (${note})` : ''}`)
    if (opts.shot) await snap(id)
    return true
  } catch (e) {
    const shots = await snap(id)
    const note = String(e?.message ?? e).split('\n').filter(Boolean).slice(0, 4).join(' ').slice(0, 600)
    results.push({ id, name, status: 'fail', ms: Date.now() - t0, note, shots })
    log(`FAIL ${id} ${name}: ${note}`)
    await recover()
    return false
  }
}
const assert = (ok, msg) => {
  if (!ok) throw new Error(msg)
}

async function phone(label) {
  browser ??= await chromium.launch()
  const ctx = await browser.newContext({ ...devices['Pixel 7'], timezoneId: TZ, locale: 'en-IN', acceptDownloads: true })
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin })
  await ctx.addInitScript(() => {
    try {
      if (!localStorage.getItem('leela-theme')) localStorage.setItem('leela-theme', 'day')
    } catch {
      /* ignore */
    }
  })
  const page = await ctx.newPage()
  page.setDefaultTimeout(20_000)
  page.on('pageerror', (e) => errors.push(`${label} page error: ${e.message}`))
  page.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|ERR_NETWORK|net::|favicon|WebSocket|websocket/i.test(t)) errors.push(`${label} console: ${t.slice(0, 300)}`)
  })
  // window.confirm: accepted unless a test sets p.confirm = false first.
  const p = { label, ctx, page, confirm: true }
  page.on('dialog', (d) => void (p.confirm ? d.accept() : d.dismiss()).catch(() => {}))
  phones.push(p)
  return p
}

const api = () => createClient(SUPA, KEY, { auth: { persistSession: false, autoRefreshToken: false } })
async function apiAs(mail, password = PW) {
  const c = api()
  const { error } = await c.auth.signInWithPassword({ email: mail, password })
  if (error) throw new Error(`API sign-in ${mail}: ${error.message}`)
  return c
}

// ---------------------------------------------------------------------------- app helpers
// Timeline rows: "<time> <title> <detail>, by <name>".
const rows = (p, text) => p.page.locator('main ol li', { hasText: text })
async function seen(p, text, timeout = 12_000) {
  await rows(p, text).first().waitFor({ state: 'visible', timeout })
}
async function gone(p, text, timeout = 12_000) {
  await p.page.waitForFunction((t) => ![...document.querySelectorAll('main ol li')].some((li) => li.textContent.includes(t)), text, { timeout })
}
async function count(p, text) {
  return p.page.evaluate((t) => [...document.querySelectorAll('main ol li')].filter((li) => li.textContent.includes(t)).length, text)
}
async function tab(p, name) {
  await p.page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true }).click()
  await p.page.waitForTimeout(300)
}
const dialog = (p) => p.page.getByRole('dialog').last()
/** Waits for every sheet to finish closing (they slide away), so nothing is half on screen. */
const noDialogs = (p) => p.page.waitForFunction(() => !document.querySelector('[role=dialog]'))
/** A big button on Today: Sleep (or Wake up), Feed, Diaper or More. */
async function tile(p, name) {
  await noDialogs(p)
  await p.page.getByRole('button', { name: new RegExp(`^${name}\\b`) }).click()
}
/** Sleep needs two taps: the Sleep button opens a screen, and only its Start button starts the timer. */
async function startSleep(p) {
  await tile(p, 'Sleep')
  await p.page.getByRole('dialog', { name: 'Sleep' }).getByRole('button', { name: 'Start sleep', exact: true }).click()
}
async function more(p, label) {
  await tile(p, 'More Health')
  await p.page.getByRole('dialog', { name: 'Log something' }).getByRole('button', { name: label, exact: true }).click()
  await p.page.waitForTimeout(300)
}
async function signUp(p, name, mail) {
  await p.page.goto(BASE)
  await p.page.getByLabel('Your name').fill(name)
  await p.page.getByLabel('Email').fill(mail)
  await p.page.getByLabel('Password').fill(PW)
  await p.page.getByRole('button', { name: 'Create account', exact: true }).click()
  await p.page.getByText('Set up your family').waitFor({ timeout: 30_000 })
}
async function signIn(p, mail, password = PW) {
  await p.page.goto(BASE)
  await p.page.getByRole('tab', { name: 'Sign in' }).click()
  await p.page.getByLabel('Email').fill(mail)
  await p.page.getByLabel('Password').fill(password)
  await p.page.getByRole('button', { name: 'Sign in', exact: true }).click()
}
async function createFamily(p, family, baby, birthIso) {
  await p.page.getByRole('button', { name: /Start a new family/ }).click()
  await p.page.getByLabel('Family name').fill(family)
  await p.page.getByRole('button', { name: 'Create family' }).click()
  await p.page.getByRole('heading', { name: 'Add your baby' }).waitFor({ timeout: 20_000 })
  await p.page.getByLabel('Name', { exact: true }).fill(baby)
  await p.page.getByLabel('Birth date').fill(birthIso)
  await p.page.getByRole('radio', { name: 'Girl' }).click()
  await p.page.getByRole('button', { name: 'Continue' }).click()
  await p.page.getByRole('heading', { name: 'Invite your family' }).waitFor()
  const code = (await p.page.getByText(/^LEELA-[A-Z0-9]{4}-[A-Z0-9]{4}$/).first().textContent()).trim()
  await p.page.getByRole('button', { name: 'Go to Leela' }).click()
  await p.page.getByRole('heading', { name: baby }).waitFor()
  return code
}
async function joinFamily(p, code) {
  await p.page.getByRole('button', { name: /I have a family code/ }).click()
  await p.page.getByLabel('Family code').fill(code)
  await p.page.getByRole('button', { name: 'Check code' }).click()
}
async function historyDay(p, daysAgo) {
  await tab(p, 'History')
  if (daysAgo < 30) await p.page.getByRole('tablist', { name: 'Choose a day' }).getByRole('tab').nth(daysAgo).click()
  else await p.page.getByLabel('Pick a day').fill(dayIso(daysAgo), { force: true })
  await p.page.waitForTimeout(500)
}
async function waitFor(fn, timeout = 15_000, every = 400) {
  const end = Date.now() + timeout
  let last
  for (;;) {
    try {
      last = await fn()
      if (last) return last
    } catch (e) {
      last = e
    }
    if (Date.now() > end) throw new Error(`timed out waiting${last instanceof Error ? `: ${last.message.split('\n')[0]}` : ''}`)
    await new Promise((r) => setTimeout(r, every))
  }
}
async function timed(label, fn) {
  const t0 = Date.now()
  await fn()
  const ms = Date.now() - t0
  ;(timings[label] ??= []).push(ms)
  return `${ms} ms`
}
/** Opens a new note once any earlier note screen has finished closing. */
async function newNote(p) {
  await p.page.waitForFunction(() => !document.querySelector('textarea[aria-label="Note"]'))
  await p.page.getByRole('button', { name: 'Write a note' }).click()
  await p.page.getByRole('textbox', { name: 'Note', exact: true }).waitFor()
}
const noteClosed = (p) => p.page.waitForFunction(() => !document.querySelector('textarea[aria-label="Note"]'))
const codeShape = /^LEELA-[A-Z0-9]{4}-[A-Z0-9]{4}$/
const familyCode = async (p) => (await p.page.getByText(codeShape).first().textContent()).trim()

// ============================================================================ canary
// A family that lives across runs: every run checks that everything logged before is still there.
async function canary() {
  fs.mkdirSync(CANARY_DIR, { recursive: true })
  const file = `${CANARY_DIR}/canary.json`
  let state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
  await check('C1', 'Long-running family: every entry from earlier runs is still there, unchanged', async () => {
    let fresh = false
    if (!state) {
      fresh = true
      state = { email: `e2e-canary-${RUN}@leela.test`, password: `canary-${crypto.randomUUID()}`, entries: [], runs: [] }
      const r = await fetch(`${SUPA}/functions/v1/signup`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: state.email, password: state.password, name: 'Canary' }) })
      assert(r.ok, `canary sign-up failed: ${r.status} ${await r.text()}`)
      const c = await apiAs(state.email, state.password)
      const { data: fam, error } = await c.rpc('create_family', { p_family_name: 'Canary family', p_display_name: 'Canary', p_timezone: TZ })
      assert(!error && fam?.ok, `canary family: ${error?.message ?? JSON.stringify(fam)}`)
      state.family = fam.family_id
      state.child = crypto.randomUUID()
      const { error: kidErr } = await c.from('children').insert({ id: state.child, family_id: state.family, name: 'Canary baby', birth_date: dayIso(30) })
      assert(!kidErr, `canary baby: ${kidErr?.message}`)
    }
    const c = await apiAs(state.email, state.password)
    const ids = state.entries.map((e) => e.id)
    let found = []
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await c.from('events').select('id, started_at, data, deleted_at').in('id', ids.slice(i, i + 200))
      assert(!error, error?.message)
      found = found.concat(data)
    }
    const missing = state.entries.filter((e) => !found.some((f) => f.id === e.id && !f.deleted_at && f.data?.amount_ml === e.amount && Date.parse(f.started_at) === Date.parse(e.at)))
    assert(missing.length === 0, `${missing.length} of ${state.entries.length} earlier entries are missing or changed: ${missing.map((m) => m.at).join(', ')}`)
    const { count: changes } = await c.from('audit_log').select('id', { count: 'exact', head: true }).eq('family_id', state.family)
    assert((changes ?? 0) >= state.entries.length, `${changes} activity records for ${state.entries.length} entries`)
    const id = crypto.randomUUID()
    const amount = 50 + (state.entries.length % 200)
    const at = new Date().toISOString()
    const { error } = await c.from('events').insert({ id, family_id: state.family, child_id: state.child, type: 'bottle', started_at: at, data: { amount_ml: amount, contents: 'formula' } })
    assert(!error, error?.message)
    state.entries.push({ id, at, amount })
    state.runs.push(at)
    fs.writeFileSync(file, JSON.stringify(state))
    const days = Math.round((Date.now() - Date.parse(state.runs[0])) / 86_400_000)
    return fresh ? 'started a new canary family' : `${state.entries.length - 1} entries from ${state.runs.length - 1} earlier runs over ${days} days, all intact; ${changes} activity records`
  })
}

// ============================================================================ full run
async function full() {
  const mom = await phone('mom')
  const dad = await phone('dad')
  const fx = await makeFixtures(`${OUT}/fixtures`, browser)
  const FAMILY = `E2E family ${RUN}`
  let code = ''
  let familyId = ''
  let momApi = null

  await check('W1', 'The published app is up at its public address', async () => {
    const r = await fetch(LIVE, { signal: AbortSignal.timeout(20_000) })
    const html = await r.text()
    assert(r.ok && html.includes('<title>Leela'), `${r.status} from ${LIVE}`)
    const sw = await fetch(new URL('sw.js', LIVE), { signal: AbortSignal.timeout(20_000) })
    assert(sw.ok, `the offline worker isn't published (${sw.status})`)
    return LIVE
  })

  // ---------------------------------------------------------------- accounts and family
  await check('A1', 'Mom creates an account, no email confirmation needed', () => signUp(mom, 'Mom', email('mom')))
  await check(
    'A2',
    'Mom starts a family, adds the baby and gets a family code',
    async () => {
      code = await createFamily(mom, FAMILY, 'Asha', dayIso(400))
      assert(codeShape.test(code), 'the code has the wrong shape')
    },
    { needs: ['A1'], shot: true },
  )
  await check('A3', 'Dad creates an account', () => signUp(dad, 'Dad', email('dad')))
  await check(
    'A4',
    'A wrong family code is refused',
    async () => {
      await joinFamily(dad, 'QQQQ-QQQQ')
      const t = await dad.page.getByRole('alert').textContent()
      assert(/doesn’t match a family/.test(t), t)
      return t.trim()
    },
    { needs: ['A3'] },
  )
  await check(
    'A5',
    'Dad joins with the code typed in lower case, after seeing who is in the family',
    async () => {
      await dad.page.getByLabel('Family code').fill(code.toLowerCase())
      await dad.page.getByRole('button', { name: 'Check code' }).click()
      await dad.page.getByRole('heading', { name: `Join ${FAMILY}?` }).waitFor()
      const preview = await dad.page.locator('dl').textContent()
      assert(preview.includes('Mom') && preview.includes('Asha'), `preview: ${preview}`)
      await dad.page.getByRole('button', { name: 'Join family' }).click()
      await dad.page.getByRole('heading', { name: 'Asha' }).waitFor({ timeout: 20_000 })
    },
    { needs: ['A2', 'A4'], shot: true },
  )
  if (passed('A2')) {
    momApi = await apiAs(email('mom'))
    familyId = (await momApi.from('families').select('id').single()).data?.id ?? ''
  }
  const stranger = await phone('stranger')
  await check(
    'A6',
    'A wrong password is refused with a clear message',
    async () => {
      await signIn(stranger, email('mom'), 'not-the-password')
      const t = await stranger.page.getByRole('alert').textContent()
      assert(/don’t match/.test(t), t)
    },
    { needs: ['A1'] },
  )
  await check(
    'A7',
    'Signing up twice with the same email says to sign in instead',
    async () => {
      await stranger.page.getByRole('tab', { name: 'Create account' }).click()
      await stranger.page.getByLabel('Your name').fill('Mom again')
      await stranger.page.getByLabel('Email').fill(email('mom'))
      await stranger.page.getByLabel('Password').fill(PW)
      await stranger.page.getByRole('button', { name: 'Create account', exact: true }).click()
      const t = await stranger.page.getByRole('alert').textContent()
      assert(/already an account/.test(t), t)
    },
    { needs: ['A1'] },
  )

  // ---------------------------------------------------------------- live logging
  await check(
    'L1',
    'A diaper logged in two taps appears on the other phone',
    async () => {
      await tile(mom, 'Diaper')
      await dialog(mom).getByRole('button', { name: 'Wet', exact: true }).click()
      return timed('live', () => seen(dad, 'Wet, by Mom'))
    },
    { needs: ['A5'] },
  )
  await check(
    'L26',
    'Tapping Sleep by mistake starts nothing: the timer needs its own Start button',
    async () => {
      await tile(mom, 'Sleep')
      const sheet = mom.page.getByRole('dialog', { name: 'Sleep' })
      await sheet.getByRole('button', { name: 'Start sleep', exact: true }).waitFor()
      await sheet.getByRole('button', { name: 'Close' }).click()
      await noDialogs(mom)
      await mom.page.waitForTimeout(2500)
      const a = await mom.page.getByRole('region', { name: /^Asleep/ }).count()
      const b = await dad.page.getByRole('region', { name: /^Asleep/ }).count()
      assert(a === 0 && b === 0, `a timer started anyway (Mom sees ${a}, Dad sees ${b})`)
    },
    { needs: ['A5'] },
  )
  await check(
    'L2',
    'A sleep timer started on one phone runs on the other',
    async () => {
      await startSleep(mom)
      return timed('live', () => dad.page.getByRole('region', { name: /^Asleep/ }).waitFor({ timeout: 12_000 }))
    },
    { needs: ['A5'] },
  )
  await check(
    'L3',
    'Stopping it on the other phone ends it everywhere and saves the sleep',
    async () => {
      await dad.page.waitForTimeout(1500)
      await dad.page.getByRole('button', { name: 'Stop asleep' }).click()
      const ms = await timed('live', () => mom.page.getByRole('region', { name: /^Asleep/ }).waitFor({ state: 'detached', timeout: 12_000 }))
      await seen(mom, /Nap|Night sleep/)
      return ms
    },
    { needs: ['L2'] },
  )
  await check(
    'L4',
    'Both parents pressing Sleep at the same moment leaves exactly one timer',
    async () => {
      await Promise.all([tile(mom, 'Sleep'), tile(dad, 'Sleep')])
      // Whoever is second may already see the other's timer on their screen: either way, one timer.
      const start = (p) => p.page.getByRole('dialog', { name: 'Sleep' }).getByRole('button', { name: 'Start sleep', exact: true }).click({ timeout: 3000 }).catch(() => {})
      await Promise.all([start(mom), start(dad)])
      await mom.page.keyboard.press('Escape')
      await dad.page.keyboard.press('Escape')
      await mom.page.waitForTimeout(6000)
      const a = await mom.page.getByRole('region', { name: /^Asleep/ }).count()
      const b = await dad.page.getByRole('region', { name: /^Asleep/ }).count()
      assert(a === 1 && b === 1, `Mom sees ${a} timers, Dad sees ${b}`)
      await mom.page.getByRole('button', { name: 'Stop asleep' }).click()
      await dad.page.getByRole('region', { name: /^Asleep/ }).waitFor({ state: 'detached', timeout: 12_000 })
    },
    { needs: ['L3'] },
  )
  await check(
    'L27',
    'Ending a sleep by mistake can be undone, and the other phone follows',
    async () => {
      await startSleep(mom)
      await dad.page.getByRole('region', { name: /^Asleep/ }).waitFor({ timeout: 12_000 })
      await tile(mom, 'Wake up')
      await mom.page.getByRole('dialog', { name: 'Sleep' }).getByRole('button', { name: 'End sleep', exact: true }).click()
      await dad.page.getByRole('region', { name: /^Asleep/ }).waitFor({ state: 'detached', timeout: 4000 })
      await mom.page.getByRole('button', { name: 'Undo' }).click()
      await dad.page.getByRole('region', { name: /^Asleep/ }).waitFor({ timeout: 12_000 })
      await mom.page.getByRole('region', { name: /^Asleep/ }).waitFor({ timeout: 5000 })
      await mom.page.getByRole('button', { name: 'Stop asleep' }).click()
      await dad.page.getByRole('region', { name: /^Asleep/ }).waitFor({ state: 'detached', timeout: 12_000 })
    },
    { needs: ['L4'] },
  )
  await check(
    'L5',
    'Breastfeeding timer: switch sides, pause and resume, all seen live by Dad',
    async () => {
      await tile(mom, 'Feed')
      await dialog(mom).getByRole('tab', { name: 'Breast' }).click()
      await dialog(mom).getByRole('button', { name: /^Start left/ }).click()
      await dad.page.getByRole('region', { name: /^Breastfeeding/ }).waitFor({ timeout: 12_000 })
      await mom.page.waitForTimeout(2500)
      await mom.page.getByRole('button', { name: /^right/i }).click()
      await dad.page.getByRole('button', { name: /^right/i, pressed: true }).waitFor({ timeout: 12_000 })
      await mom.page.waitForTimeout(2500)
      await mom.page.getByRole('button', { name: 'Pause feed' }).click()
      await dad.page.getByRole('region', { name: /^Feed paused/ }).waitFor({ timeout: 12_000 })
      await mom.page.getByRole('button', { name: 'Resume feed' }).click()
      await dad.page.getByRole('region', { name: /^Breastfeeding/ }).waitFor({ timeout: 12_000 })
      await mom.page.getByRole('button', { name: 'Stop breastfeeding' }).click()
      await dad.page.getByRole('region', { name: /^Breastfeeding/ }).waitFor({ state: 'detached', timeout: 12_000 })
      await seen(dad, 'Breastfeed')
    },
    { needs: ['A5'] },
  )
  await check(
    'L6',
    'A bottle with its amount and formula shows on the other phone',
    async () => {
      await tile(mom, 'Feed')
      await dialog(mom).getByRole('tab', { name: 'Bottle' }).click()
      await dialog(mom).getByLabel('amount', { exact: true }).fill('120')
      await dialog(mom).getByRole('radio', { name: 'Formula' }).click()
      await dialog(mom).getByRole('button', { name: 'Log bottle' }).click()
      return timed('live', () => seen(dad, '120 ml, formula'))
    },
    { needs: ['A5'] },
  )
  await check(
    'L7',
    'Editing an entry updates the other phone',
    async () => {
      await rows(mom, '120 ml').first().click()
      await dialog(mom).getByLabel('amount', { exact: true }).fill('150')
      await dialog(mom).getByRole('button', { name: 'Save changes' }).click()
      return timed('live', () => seen(dad, '150 ml'))
    },
    { needs: ['L6'] },
  )
  await check(
    'L8',
    'Delete, then Undo: the other phone follows both',
    async () => {
      await rows(mom, '150 ml').first().click()
      await dialog(mom).getByRole('button', { name: 'Delete entry' }).click()
      await gone(dad, '150 ml')
      await mom.page.getByRole('status').filter({ hasText: 'deleted' }).getByRole('button', { name: 'Undo' }).click()
      await seen(dad, '150 ml')
    },
    { needs: ['L7'] },
  )
  await check(
    'L9',
    'Two people editing the same entry: the second save is caught, not silently lost',
    async () => {
      await rows(mom, '150 ml').first().click()
      await rows(dad, '150 ml').first().click()
      await dialog(dad).getByLabel('amount', { exact: true }).fill('200')
      await dialog(dad).getByRole('button', { name: 'Save changes' }).click()
      await seen(mom, '200 ml')
      await dialog(mom).getByLabel('amount', { exact: true }).fill('180')
      await dialog(mom).getByRole('button', { name: 'Save changes' }).click()
      await mom.page.getByRole('dialog', { name: 'Updated by Dad' }).waitFor({ timeout: 12_000 })
      await mom.page.getByRole('button', { name: 'Keep my changes' }).click()
      await seen(dad, '180 ml')
      await seen(mom, '180 ml')
    },
    { needs: ['L7'], shot: true },
  )

  const kinds = [
    ['L10', 'Solids with a food', 'Solids', async (d) => {
      await d.getByLabel('Food name').fill('Banana')
      await d.getByLabel('Food name').press('Enter')
      await d.getByRole('button', { name: 'Log solids' }).click()
    }, 'Banana'],
    ['L11', 'Growth: weight, length and head', 'Growth', async (d) => {
      await d.getByLabel('weight', { exact: true }).fill('9.2')
      await d.getByLabel('length', { exact: true }).fill('74')
      await d.getByLabel('head circumference', { exact: true }).fill('45')
      await d.getByRole('button', { name: 'Log growth' }).click()
    }, '9.2 kg'],
    ['L12', 'A temperature high enough to warn about', 'Temperature', async (d) => {
      await d.getByLabel('temperature', { exact: true }).fill('38.6')
      await d.getByText('Fever logged.').waitFor()
      await d.getByRole('button', { name: 'Log temperature' }).click()
    }, '38.6 °C'],
    ['L13', 'A medicine with its dose', 'Medicine', async (d) => {
      await d.getByRole('textbox', { name: 'Medicine', exact: true }).fill('Calpol')
      await d.getByRole('textbox', { name: 'Dose given' }).fill('5')
      await d.getByRole('button', { name: 'Log medicine' }).click()
    }, 'Calpol 5 ml'],
    ['L14', 'Symptoms', 'Health', async (d) => {
      await d.getByRole('button', { name: 'Cough', exact: true }).click()
      await d.getByRole('button', { name: 'Log symptoms' }).click()
    }, 'Cough'],
    ['L15', 'A doctor visit', 'Health', async (d) => {
      await d.getByRole('radio', { name: 'Doctor visit' }).click()
      await d.getByRole('button', { name: 'Log symptoms' }).click()
    }, 'Doctor visit'],
    ['L16', 'A vaccine', 'Health', async (d) => {
      await d.getByRole('radio', { name: 'Vaccine' }).click()
      await d.getByLabel('Vaccine name').fill('MMR')
      await d.getByRole('button', { name: 'Log symptoms' }).click()
    }, 'MMR'],
    ['L17', 'An activity with how long it lasted', 'Activity', async (d) => {
      await d.getByRole('radio', { name: 'Bath' }).click()
      await d.getByLabel('duration', { exact: true }).fill('10')
      await d.getByRole('button', { name: 'Log activity' }).click()
    }, 'Bath'],
    ['L18', 'Potty, for toddlers', 'Potty', async (d) => {
      await d.getByRole('radio', { name: 'Pee' }).click()
      await d.getByRole('button', { name: 'Log potty' }).click()
    }, 'Pee, on the potty'],
  ]
  for (const [id, name, label, fill, expect] of kinds) {
    await check(
      id,
      `${name}, seen on the other phone`,
      async () => {
        await more(mom, label)
        await fill(dialog(mom))
        await seen(mom, expect)
        await seen(dad, expect)
      },
      { needs: ['A5'] },
    )
  }
  await check(
    'L19',
    'Pumping is logged for the person who pumped',
    async () => {
      await more(mom, 'Pumping')
      const d = dialog(mom)
      await d.getByLabel('left amount', { exact: true }).fill('60')
      await d.getByLabel('right amount', { exact: true }).fill('50')
      await d.getByRole('button', { name: 'Log pumping' }).click()
      await seen(mom, 'left 60 ml, right 50 ml')
    },
    { needs: ['A5'] },
  )
  await check(
    'L20',
    'A first with a photo: the photo uploads and shows on the other phone',
    async () => {
      await more(mom, 'Milestone')
      const d = dialog(mom)
      await d.getByRole('radio', { name: 'First steps' }).click()
      await d.locator('input[type=file]').setInputFiles(fx.photo1)
      await d.locator('img').first().waitFor({ timeout: 30_000 })
      await d.getByRole('button', { name: 'Save milestone' }).click()
      await seen(dad, 'First steps')
      await tab(dad, 'Diary')
      await dad.page.getByText('First steps').first().waitFor()
      await waitFor(() => dad.page.evaluate(() => [...document.querySelectorAll('main img')].some((i) => i.complete && i.naturalWidth > 0)), 25_000)
      await tab(dad, 'Today')
    },
    { needs: ['A5'], shot: true },
  )
  await check('L21', 'The fever warning shows on Today', () => mom.page.getByText(/^Fever logged: 38\.6 °C/).waitFor(), { needs: ['L12'] })
  await check(
    'L22',
    'Contraction timer',
    async () => {
      await more(mom, 'Contraction')
      await dialog(mom).getByRole('button', { name: 'Contraction started' }).click()
      await mom.page.getByRole('region', { name: /^Contraction/ }).waitFor()
      await mom.page.waitForTimeout(1500)
      await mom.page.getByRole('button', { name: 'Stop contraction' }).click()
      await seen(mom, 'Contraction')
    },
    { needs: ['A5'] },
  )
  await check(
    'L23',
    'An activity timer runs on both phones',
    async () => {
      await more(mom, 'Activity')
      await dialog(mom).getByRole('radio', { name: 'Tummy time' }).click()
      await dialog(mom).getByRole('button', { name: 'Start timer' }).click()
      await dad.page.getByRole('region', { name: /^Tummy time/ }).waitFor({ timeout: 12_000 })
      await mom.page.getByRole('button', { name: 'Stop tummy time' }).click()
      await dad.page.getByRole('region', { name: /^Tummy time/ }).waitFor({ state: 'detached', timeout: 12_000 })
      await seen(dad, 'Tummy time')
    },
    { needs: ['A5'] },
  )
  await check(
    'L24',
    'A diaper with colour and rash',
    async () => {
      await tile(mom, 'Diaper')
      const d = dialog(mom)
      await d.getByRole('button', { name: 'Add color, texture or rash' }).click()
      await d.getByRole('button', { name: 'Dirty', exact: true }).click()
      await d.getByRole('radio', { name: 'Green' }).click()
      await d.getByRole('switch', { name: 'Diaper rash' }).click()
      await d.getByRole('button', { name: 'Log diaper' }).click()
      await seen(dad, 'Dirty, green, rash')
    },
    { needs: ['A5'] },
  )
  await check(
    'L25',
    'A past nap with the times typed in lands on yesterday',
    async () => {
      await more(mom, 'Sleep')
      const d = dialog(mom)
      await d.getByRole('button', { name: 'Earlier day' }).nth(0).click()
      await d.getByLabel('Fell asleep date and time').fill(`${dayIso(1)}T13:00`)
      await d.getByRole('button', { name: 'Earlier day' }).nth(1).click()
      await d.getByLabel('Woke up date and time').fill(`${dayIso(1)}T14:30`)
      await d.getByText('Slept 1h 30m').waitFor()
      await d.getByRole('button', { name: 'Log sleep' }).click()
      await historyDay(dad, 1)
      await seen(dad, '1h 30m')
      await tab(dad, 'Today')
    },
    { needs: ['A5'] },
  )

  // ---------------------------------------------------------------- offline
  await check(
    'O1',
    'Offline: three diapers wait on the phone, then sync once, with no duplicates',
    async () => {
      const before = await count(dad, 'Wet, by Mom')
      await mom.ctx.setOffline(true)
      for (let i = 0; i < 3; i++) {
        await tile(mom, 'Diaper')
        await dialog(mom).getByRole('button', { name: 'Wet', exact: true }).click()
        await mom.page.waitForTimeout(500)
      }
      const pill = mom.page.locator('header [role=status]')
      await pill.filter({ hasText: 'Offline, 3 waiting' }).waitFor({ timeout: 10_000 })
      await mom.ctx.setOffline(false)
      await waitFor(async () => (await count(dad, 'Wet, by Mom')) >= before + 3, 40_000)
      await dad.page.waitForTimeout(4000)
      const after = await count(dad, 'Wet, by Mom')
      assert(after === before + 3, `${before} became ${after}`)
      await pill.waitFor({ state: 'detached', timeout: 20_000 })
      return `${before} → ${after}`
    },
    { needs: ['L1'], shot: true },
  )
  await check(
    'O2',
    'The app opens with no connection, from the copy on the phone',
    async () => {
      await mom.page.reload()
      await mom.page.getByRole('heading', { name: 'Asha' }).waitFor({ timeout: 20_000 })
      await waitFor(() => mom.page.evaluate(() => Boolean(navigator.serviceWorker?.controller)), 20_000)
      await mom.ctx.setOffline(true)
      await mom.page.reload()
      await mom.page.getByRole('heading', { name: 'Asha' }).waitFor({ timeout: 20_000 })
      await seen(mom, 'Wet')
      await mom.ctx.setOffline(false)
      await mom.page.reload()
      await mom.page.getByRole('heading', { name: 'Asha' }).waitFor({ timeout: 20_000 })
    },
    { needs: ['A5'] },
  )

  // ---------------------------------------------------------------- backdating and long history
  await check(
    'H1',
    'A forgotten bottle added to two days ago lands on that day, for both parents',
    async () => {
      await historyDay(dad, 2)
      await dad.page.getByRole('button', { name: 'Add to this day' }).click()
      await dialog(dad).getByRole('button', { name: 'Bottle', exact: true }).click()
      await dialog(dad).getByLabel('amount', { exact: true }).fill('70')
      await dialog(dad).getByRole('button', { name: 'Log bottle' }).click()
      await seen(dad, '70 ml')
      await historyDay(mom, 2)
      await seen(mom, '70 ml, formula, by Dad')
      await historyDay(dad, 0)
      assert((await count(dad, '70 ml')) === 0, 'it also shows on today')
      await tab(mom, 'Today')
      await tab(dad, 'Today')
    },
    { needs: ['A5'] },
  )
  await check(
    'H2',
    'Ten days of logging: an entry on each of the last ten days',
    async () => {
      for (let d = 1; d <= 10; d++) {
        await historyDay(mom, d)
        await mom.page.getByRole('button', { name: 'Add to this day' }).click()
        await dialog(mom).getByRole('button', { name: 'Diaper', exact: true }).click()
        await dialog(mom).getByRole('button', { name: 'Dirty', exact: true }).click()
        await seen(mom, 'Dirty, by you')
      }
      await tab(mom, 'Today')
    },
    { needs: ['A5'] },
  )
  const momPhone2 = await phone('mom-new-phone')
  await check(
    'H3',
    'Day 11 on a brand-new phone: all ten days are still there',
    async () => {
      await signIn(momPhone2, email('mom'))
      await momPhone2.page.getByRole('heading', { name: 'Asha' }).waitFor({ timeout: 30_000 })
      for (let d = 1; d <= 10; d++) {
        await historyDay(momPhone2, d)
        await seen(momPhone2, 'Dirty, by you')
      }
      await tab(momPhone2, 'Today')
      return '10 of 10 days'
    },
    { needs: ['H2'], shot: true },
  )
  const oldDay = 380
  await check(
    'H4',
    `A log from ${oldDay} days ago, over a year back, is saved and shown on its day`,
    async () => {
      await tab(mom, 'History')
      await mom.page.getByRole('button', { name: 'Import', exact: true }).click()
      await mom.page.getByLabel('Paste your log').fill(`${dayLong(oldDay)}\n7:00 am fed 60 ml formula\n9:30 wet diaper\n11:00-12:30 nap\nfirst smile`)
      await mom.page.getByRole('button', { name: 'Read it' }).click()
      await mom.page.getByRole('heading', { name: /^(Check before saving|A few quick questions)$/ }).waitFor({ timeout: 30_000 })
      if (await mom.page.getByRole('heading', { name: 'A few quick questions' }).count()) await mom.page.getByRole('button', { name: 'Continue' }).click()
      await mom.page.getByRole('button', { name: /^Save \d+ entr/ }).click()
      await mom.page.getByText(/^\d+ entr(y|ies) added$/).waitFor({ timeout: 40_000 })
      await mom.page.getByRole('button', { name: 'See History' }).click()
      await historyDay(mom, oldDay)
      await seen(mom, '60 ml', 30_000)
      await historyDay(momPhone2, oldDay)
      await seen(momPhone2, '60 ml', 30_000)
      await tab(mom, 'Today')
      await tab(momPhone2, 'Today')
    },
    { needs: ['A5'], shot: true },
  )

  // ---------------------------------------------------------------- notes
  const prose = 'It still feels unreal that she is ours. Her grandparents came over and could not stop holding her. She grabbed my finger and held on tight. Everyone says she has her mother’s eyes. We took so many photos today. '
  const longBody = `${prose.repeat(60)}\n\nGave calpol 2.5 ml at ${clock(90)}. She rolled over!`
  await check(
    'N1',
    'A very long note with two photos saves, and Leela offers to log what it mentions',
    async () => {
      await tab(mom, 'Notes')
      await newNote(mom)
      await mom.page.getByLabel('Title').fill('Big day')
      await mom.page.getByRole('textbox', { name: 'Note', exact: true }).fill(longBody)
      await mom.page.locator('input[type=file]').setInputFiles([fx.photo1, fx.photo2])
      await waitFor(async () => (await mom.page.getByRole('button', { name: 'Remove photo' }).count()) >= 2, 40_000)
      await mom.page.getByRole('button', { name: 'Save note' }).click()
      const sheet = mom.page.getByRole('dialog', { name: 'Add these to the log?' })
      await sheet.waitFor({ timeout: 15_000 })
      await sheet.getByText(/^Medicine/).first().waitFor()
      await sheet.getByText(/^Rolled over/).first().waitFor()
      await sheet.getByRole('button', { name: /^Add \d/ }).click()
      await mom.page.getByText(/^Added \d+ entr/).last().waitFor()
      await noteClosed(mom)
      return `${longBody.length.toLocaleString('en')} characters`
    },
    { needs: ['A5'], shot: true },
  )
  await check(
    'N2',
    'Dad sees the note with its full text and photos, and what it logged',
    async () => {
      await tab(dad, 'Notes')
      await dad.page.getByText('Big day').first().waitFor({ timeout: 15_000 })
      await waitFor(() => dad.page.evaluate(() => [...document.querySelectorAll('main img')].filter((i) => i.complete && i.naturalWidth > 0).length >= 2), 25_000)
      await dad.page.getByText('Big day').first().click()
      const box = dad.page.getByRole('textbox', { name: 'Note', exact: true })
      await waitFor(async () => (await box.inputValue()).length > 0, 10_000)
      const body = await box.inputValue()
      assert(body.length === longBody.length, `the note has ${body.length} characters, expected ${longBody.length}`)
      await dad.page.getByRole('button', { name: 'Back', exact: true }).click()
      await noteClosed(dad)
      await tab(dad, 'Today')
      await seen(dad, 'Calpol 2.5 ml')
      await seen(dad, 'Rolled over')
    },
    { needs: ['N1'], shot: true },
  )
  await check(
    'N3',
    'An unsaved note survives the app closing',
    async () => {
      await tab(mom, 'Notes')
      await newNote(mom)
      await mom.page.getByRole('textbox', { name: 'Note', exact: true }).fill('Half-written thought about bath time')
      await mom.page.waitForTimeout(1500)
      await mom.page.reload()
      await mom.page.getByRole('heading', { name: 'Asha' }).waitFor({ timeout: 20_000 })
      await tab(mom, 'Notes')
      await newNote(mom)
      await mom.page.getByText('Picked up where you left off.').waitFor()
      const v = await mom.page.getByRole('textbox', { name: 'Note', exact: true }).inputValue()
      assert(v.includes('Half-written'), v)
      // Back, then Cancel on "keep it as a draft?" throws it away.
      mom.confirm = false
      await mom.page.getByRole('button', { name: 'Back', exact: true }).click()
      await noteClosed(mom)
      mom.confirm = true
      await newNote(mom)
      assert((await mom.page.getByText('Picked up where you left off.').count()) === 0, 'the discarded draft came back')
      await mom.page.getByRole('button', { name: 'Back', exact: true }).click()
      await noteClosed(mom)
    },
    { needs: ['A5'] },
  )
  await check(
    'N4',
    'Shorthand Leela doesn’t know: it asks once, learns it, and the other parent benefits',
    async () => {
      await tab(mom, 'Notes')
      await newNote(mom)
      await mom.page.getByRole('textbox', { name: 'Note', exact: true }).fill(`${clock(80)} qz\n${clock(70)} qz`)
      await mom.page.getByRole('button', { name: 'Save note' }).click()
      const sheet = mom.page.getByRole('dialog', { name: /A quick question|Add these to the log\?/ })
      await sheet.getByText('What does “qz” mean?').waitFor({ timeout: 15_000 })
      await sheet.getByRole('button', { name: 'Wet diaper', exact: true }).click()
      await sheet.getByRole('button', { name: /^Add \d/ }).click()
      await mom.page.getByText(/^Added \d+ entr/).last().waitFor()
      await noteClosed(mom)
      await tab(mom, 'Family')
      await mom.page.getByText('“qz”').waitFor({ timeout: 10_000 })
      // Dad's import reads Mom's word without asking.
      await tab(dad, 'History')
      await dad.page.getByRole('button', { name: 'Import', exact: true }).click()
      await dad.page.getByLabel('Paste your log').fill(`${dayLong(3)}\n6:00 qz`)
      await dad.page.getByRole('button', { name: 'Read it' }).click()
      await dad.page.getByRole('heading', { name: 'Check before saving' }).waitFor({ timeout: 30_000 })
      await dad.page.getByText(/^Diaper, Wet/).first().waitFor()
      await dad.page.getByRole('button', { name: 'Back', exact: true }).click()
      await dad.page.getByRole('button', { name: 'Back', exact: true }).click()
      await tab(dad, 'Today')
      await tab(mom, 'Today')
    },
    { needs: ['A5'], shot: true },
  )
  await check(
    'N5',
    'Searching notes; plain notes don’t ask anything',
    async () => {
      for (const text of ['Grandma visited and brought a tiny jumper.', 'Her cousins came to see her.']) {
        await tab(mom, 'Notes')
        await newNote(mom)
        await mom.page.getByRole('textbox', { name: 'Note', exact: true }).fill(text)
        await mom.page.getByRole('button', { name: 'Save note' }).click()
        await noteClosed(mom)
        await mom.page.waitForTimeout(800)
        assert((await mom.page.getByRole('dialog').count()) === 0, `a plain note asked something: ${text}`)
      }
      const search = mom.page.getByLabel('Search notes')
      await search.fill('jumper')
      await mom.page.getByText(/tiny jumper/).first().waitFor()
      assert((await mom.page.getByText('Big day').count()) === 0, 'search shows notes that don’t match')
      await search.fill('zzzz nothing')
      await mom.page.getByText(/No notes mention/).waitFor()
      await search.fill('')
      await tab(mom, 'Today')
    },
    { needs: ['N1', 'N4'] },
  )

  // ---------------------------------------------------------------- imports
  const importFile = async (p, file, expectText) => {
    await tab(p, 'History')
    await p.page.getByRole('button', { name: 'Import', exact: true }).click()
    await p.page.getByLabel('Choose a file to import').setInputFiles(file)
    await p.page.getByText('Ready to read').waitFor({ timeout: 30_000 })
    await p.page.getByRole('button', { name: 'Read it' }).click()
    await p.page.getByRole('heading', { name: /^(Check before saving|A few quick questions)$/ }).waitFor({ timeout: 30_000 })
    if (await p.page.getByRole('heading', { name: 'A few quick questions' }).count()) {
      const fed = p.page.locator('section', { hasText: 'When it just says' }).getByRole('radio', { name: 'Breastfeed', exact: true })
      if (await fed.count()) await fed.click()
      await p.page.getByRole('button', { name: 'Continue' }).click()
      await p.page.getByRole('heading', { name: 'Check before saving' }).waitFor({ timeout: 30_000 })
    }
    if (expectText) await p.page.getByText(expectText).first().waitFor()
    const save = p.page.getByRole('button', { name: /^Save \d+ entr/ })
    const n = Number((await save.textContent()).match(/\d+/)[0])
    if (n > 0) {
      await save.click()
      await p.page.getByText(/^\d+ entr(y|ies) added$/).waitFor({ timeout: 40_000 })
      await p.page.getByRole('button', { name: 'See History' }).click()
    } else {
      await p.page.getByRole('button', { name: 'Back', exact: true }).click()
      await p.page.getByRole('button', { name: 'Back', exact: true }).click()
    }
    await tab(p, 'Today')
    return n
  }
  await check('I1', 'Import a Word document (a Google Doc saved as .docx)', async () => {
    const n = await importFile(dad, fx.docx, '60 ml, formula')
    assert(n === 4, `${n} entries, expected 4`)
    await historyDay(mom, 20)
    await seen(mom, '60 ml, formula, by Dad')
    await seen(mom, 'Tummy time')
    await tab(mom, 'Today')
    return `${n} entries`
  }, { needs: ['A5'], shot: true })
  await check('I2', 'Import a PDF', async () => {
    const n = await importFile(dad, fx.pdf, '120 ml')
    assert(n >= 3, `only ${n} entries`)
    await historyDay(dad, 16)
    await seen(dad, '120 ml')
    await tab(dad, 'Today')
    return `${n} entries`
  }, { needs: ['A5'] })
  await check('I3', 'Import an Excel sheet', async () => {
    const n = await importFile(dad, fx.xlsx, '110 ml')
    assert(n === 3, `${n} entries, expected 3`)
    return `${n} entries`
  }, { needs: ['A5'] })
  await check('I4', 'Import a tracking-app CSV export', async () => {
    const n = await importFile(dad, fx.csv)
    assert(n === 3, `${n} entries, expected 3`)
    return `${n} entries`
  }, { needs: ['A5'] })
  await check('I5', 'Import a WhatsApp chat export', async () => {
    const n = await importFile(dad, fx.whatsapp, '90 ml')
    assert(n === 3, `${n} entries, expected 3`)
    await historyDay(dad, 17)
    await seen(dad, '1h 15m')
    await tab(dad, 'Today')
    return `${n} entries`
  }, { needs: ['A5'] })
  await check('I6', 'Importing the same file again skips everything already there', async () => {
    const n = await importFile(dad, fx.docx)
    assert(n === 0, `${n} would be saved twice`)
  }, { needs: ['I1'] })
  await check('I7', 'An import can be undone, and both phones drop it', async () => {
    await tab(dad, 'History')
    await dad.page.getByRole('button', { name: 'Import', exact: true }).click()
    const pastList = dad.page.locator('section', { has: dad.page.getByRole('heading', { name: 'Past imports' }) })
    await pastList.waitFor({ timeout: 15_000 })
    await pastList.locator('li', { hasText: 'WhatsApp' }).getByRole('button', { name: 'Undo' }).click()
    await dad.page.getByText(/^Import undone/).waitFor({ timeout: 15_000 })
    await dad.page.getByRole('button', { name: 'Back', exact: true }).click()
    await historyDay(mom, 17)
    await gone(mom, '90 ml')
    await tab(mom, 'Today')
    await tab(dad, 'Today')
  }, { needs: ['I5'] })

  // ---------------------------------------------------------------- diary and book
  await check('B1', 'The diary groups notes, firsts and photos by month of life', async () => {
    await tab(mom, 'Diary')
    await mom.page.getByRole('heading', { name: /^Month \d+$/ }).first().waitFor({ timeout: 20_000 })
    await mom.page.getByText('Big day').first().waitFor()
    await mom.page.getByText('First steps').first().waitFor()
  }, { needs: ['N1'], shot: true })
  await check('B2', 'The diary book prints to a PDF with the months, notes and photos', async () => {
    await tab(mom, 'Diary')
    await mom.page.getByRole('button', { name: 'Make the diary book' }).click()
    await mom.page.getByText(/Here’s how it will look/).waitFor({ timeout: 30_000 })
    await waitFor(
      () =>
        mom.page.evaluate(() => {
          const imgs = [...document.querySelectorAll('.print-root img')]
          return !document.querySelector('.print-root [data-photo-pending]') && imgs.length >= 2 && imgs.every((i) => i.complete && i.naturalWidth > 0)
        }),
      30_000,
    )
    const pdf = `${OUT}/diary-book.pdf`
    await mom.page.pdf({ path: pdf, format: 'A4', printBackground: true })
    await mom.page.getByRole('button', { name: 'Back', exact: true }).click()
    const text = execFileSync('pdftotext', [pdf, '-']).toString()
    const pages = Number(execFileSync('pdfinfo', [pdf]).toString().match(/Pages:\s+(\d+)/)[1])
    const images = execFileSync('pdfimages', ['-list', pdf]).toString().trim().split('\n').length - 2
    assert(text.includes('Asha') && text.includes('Big day') && /Month \d+/.test(text), 'the book is missing the name, the note or the months')
    assert(pages >= 4, `only ${pages} pages`)
    assert(images >= 2, `only ${images} photos in the book`)
    await tab(mom, 'Today')
    return `${pages} pages, ${images} images, ${Math.round(fs.statSync(pdf).size / 1024)} KB`
  }, { needs: ['N1'] })

  // ---------------------------------------------------------------- family and settings
  await check('F1', 'A second baby keeps separate logs', async () => {
    await tab(mom, 'Family')
    await mom.page.getByRole('button', { name: 'Add a baby' }).click()
    const d = mom.page.getByRole('dialog', { name: 'Add your baby' })
    await d.getByLabel('Name', { exact: true }).fill('Ravi')
    await d.getByLabel('Birth date').fill(dayIso(30))
    await d.getByRole('button', { name: 'Add baby' }).click()
    await tab(mom, 'Today')
    await mom.page.getByRole('button', { name: 'Ravi', exact: true }).click()
    await tile(mom, 'Diaper')
    await dialog(mom).getByRole('button', { name: 'Dry', exact: true }).click()
    await seen(mom, 'Dry, by you')
    await mom.page.getByRole('button', { name: 'Asha', exact: true }).click()
    await mom.page.waitForTimeout(600)
    assert((await count(mom, 'Dry, by you')) === 0, 'Ravi’s diaper shows under Asha')
    await tab(dad, 'Today')
    await dad.page.getByRole('button', { name: 'Ravi', exact: true }).waitFor({ timeout: 15_000 })
  }, { needs: ['A5'] })
  await check('F2', 'A new name shows on the partner’s phone, on old entries too', async () => {
    await tab(dad, 'Family')
    await dad.page.getByRole('button', { name: 'Edit your name' }).click()
    await dialog(dad).getByLabel('What your family sees').fill('Papa')
    await dialog(dad).getByRole('button', { name: 'Save' }).click()
    await historyDay(mom, 2)
    await seen(mom, '70 ml, formula, by Papa', 20_000)
    await tab(mom, 'Today')
    await tab(dad, 'Today')
  }, { needs: ['H1'] })
  await check('F3', 'Units are per person: °F and inches for Mom, °C and cm for Dad', async () => {
    await tab(mom, 'Family')
    await mom.page.getByRole('radio', { name: '°F' }).click()
    await mom.page.getByRole('radio', { name: 'Inches' }).click()
    await tab(mom, 'Today')
    await seen(mom, '101.5 °F')
    await seen(mom, 'length 29.1 in')
    await seen(dad, '38.6 °C')
    await seen(dad, 'length 74 cm')
    await tab(mom, 'Family')
    await mom.page.getByRole('radio', { name: '°C' }).click()
    await mom.page.getByRole('radio', { name: 'Centimetres' }).click()
    await tab(mom, 'Today')
  }, { needs: ['L11', 'L12'] })
  await check('F4', 'Night hours changed by one parent reach the other', async () => {
    await tab(mom, 'Family')
    await mom.page.getByLabel('Night starts').fill('20:00')
    await tab(dad, 'Family')
    await waitFor(async () => (await dad.page.getByLabel('Night starts').inputValue()) === '20:00', 15_000)
    await tab(dad, 'Today')
  }, { needs: ['A5'] })
  await check('F5', 'Night theme', async () => {
    await mom.page.getByRole('radio', { name: 'Night' }).click()
    assert((await mom.page.evaluate(() => document.documentElement.dataset.theme)) === 'night', 'the theme didn’t change')
    await mom.page.getByRole('radio', { name: 'Day' }).click()
    assert((await mom.page.evaluate(() => document.documentElement.dataset.theme)) === 'day', 'the theme didn’t change back')
  }, { needs: ['A5'] })

  const grandma = await phone('grandma')
  await check('F6', 'The owner resets the code: the old one stops working, the new one works', async () => {
    await tab(mom, 'Family')
    const oldCode = await familyCode(mom)
    await mom.page.getByRole('button', { name: 'Reset code' }).click()
    await waitFor(async () => (await familyCode(mom)) !== oldCode)
    code = await familyCode(mom)
    await signUp(grandma, 'Nani', email('grandma'))
    await joinFamily(grandma, oldCode)
    await grandma.page.getByRole('alert').waitFor()
    await grandma.page.getByLabel('Family code').fill(code)
    await grandma.page.getByRole('button', { name: 'Check code' }).click()
    await grandma.page.getByRole('button', { name: 'Join family' }).click()
    await grandma.page.getByRole('button', { name: 'Asha', exact: true }).waitFor({ timeout: 20_000 })
  }, { needs: ['A5', 'F1'] })
  await check('F7', 'Removing a member cuts their access straight away', async () => {
    await tab(mom, 'Family')
    await mom.page.locator('li', { hasText: 'Nani' }).getByRole('button', { name: 'Remove' }).click()
    await mom.page.locator('li', { hasText: 'Nani' }).waitFor({ state: 'detached', timeout: 15_000 })
    const g = await apiAs(email('grandma'))
    const { data } = await g.from('events').select('id').eq('family_id', familyId)
    assert((data ?? []).length === 0, `the removed member can still read ${data?.length} entries`)
    await grandma.page.reload()
    await grandma.page.getByRole('heading', { name: 'Set up your family' }).waitFor({ timeout: 30_000 })
  }, { needs: ['F6'] })
  await check('F8', 'Ownership can be handed to the other parent', async () => {
    await tab(mom, 'Family')
    await mom.page.locator('li', { hasText: /Papa|Dad/ }).getByRole('button', { name: 'Make owner' }).click()
    await mom.page.getByRole('button', { name: 'Reset code' }).waitFor({ state: 'detached', timeout: 15_000 })
    await tab(dad, 'Family')
    await dad.page.getByRole('button', { name: 'Reset code' }).waitFor({ timeout: 15_000 })
    await tab(dad, 'Today')
    await tab(mom, 'Today')
  }, { needs: ['A5'] })
  await check('F9', 'Editing a baby’s details reaches the other phone', async () => {
    await tab(mom, 'Family')
    await mom.page.getByRole('button', { name: /^Ravi/ }).click()
    const d = mom.page.getByRole('dialog', { name: 'Edit Ravi' })
    await d.getByLabel('Name', { exact: true }).fill('Ravi Kumar')
    await d.getByRole('button', { name: 'Save changes' }).click()
    await dad.page.getByRole('button', { name: 'Ravi Kumar', exact: true }).waitFor({ timeout: 15_000 })
    await tab(mom, 'Today')
  }, { needs: ['F1'] })

  // ---------------------------------------------------------------- sweet spot
  // A third baby with a steady week of sleep, logged through the API, and Mom on a phone whose clock
  // is set to 11 am on the latest day, so the predictions can be checked against known times.
  const T = (() => {
    const today11 = Date.parse(`${dayIso(0)}T11:00:00+05:30`)
    return today11 <= Date.now() ? today11 : today11 - 86_400_000
  })()
  const isoAt = (daysBefore, hhmm) => new Date(`${new Date(T - daysBefore * 86_400_000).toLocaleDateString('en-CA', { timeZone: TZ })}T${hhmm}:00+05:30`).toISOString()
  /** Minutes after midnight of "12:25" + "PM". */
  const minuteOf = (h, m, ap) => ((Number(h) % 12) + (ap === 'PM' ? 12 : 0)) * 60 + Number(m)
  const clockPhone = await phone('mom-clock')
  await check('P1', 'Sweet spot predicts the next nap, the rest of the day and bedtime from the baby’s own week', async () => {
    const mira = crypto.randomUUID()
    const birth = new Date(T - 184 * 86_400_000).toLocaleDateString('en-CA', { timeZone: TZ })
    const { error: kidErr } = await momApi.from('children').insert({ id: mira, family_id: familyId, name: 'Mira', birth_date: birth })
    assert(!kidErr, `adding Mira: ${kidErr?.message}`)
    // Up at 7, naps at 9:10, 12:40 and 4:10, in bed at 7:15, every day for eight days; today so far: up at 7, one nap.
    const week = []
    const add = (start, end) => week.push({ id: crypto.randomUUID(), family_id: familyId, child_id: mira, type: 'sleep', started_at: start, ended_at: end, data: {} })
    for (let d = 8; d >= 1; d--) {
      add(isoAt(d + 1, '19:15'), isoAt(d, '07:00'))
      add(isoAt(d, '09:10'), isoAt(d, '10:10'))
      add(isoAt(d, '12:40'), isoAt(d, '13:40'))
      add(isoAt(d, '16:10'), isoAt(d, '16:50'))
    }
    add(isoAt(1, '19:15'), isoAt(0, '07:00'))
    add(isoAt(0, '09:10'), isoAt(0, '10:10'))
    const { error } = await momApi.from('events').insert(week)
    assert(!error, `logging Mira’s week: ${error?.message}`)

    await clockPhone.page.clock.setFixedTime(new Date(T))
    await signIn(clockPhone, email('mom'))
    await clockPhone.page.getByRole('button', { name: 'Mira', exact: true }).click({ timeout: 30_000 })
    const card = clockPhone.page.getByRole('region', { name: 'Sweet spot' })
    await waitFor(async () => /Next nap/.test(await card.textContent()), 20_000)
    const text = (await card.textContent()).replace(/\s+/g, ' ')
    const w = /(\d{1,2}):(\d{2})(?: (AM|PM))? – (\d{1,2}):(\d{2}) (AM|PM)/.exec(text)
    assert(w, `no nap window on the card: ${text}`)
    const from = minuteOf(w[1], w[2], w[3] ?? w[6])
    const to = minuteOf(w[4], w[5], w[6])
    const mid = (from + to) / 2
    assert(mid >= 12 * 60 + 25 && mid <= 12 * 60 + 55 && to - from >= 15 && to - from <= 45, `next nap window ${w[0]}, expected around 12:40 PM: ${text}`)
    const nap3 = /nap 3 ~(\d{1,2}):(\d{2}) (AM|PM)/.exec(text)
    assert(nap3 && Math.abs(minuteOf(nap3[1], nap3[2], nap3[3]) - (16 * 60 + 10)) <= 20, `third nap: ${nap3?.[0]}, expected around 4:10 PM`)
    const bed = /bed ~(\d{1,2}):(\d{2}) (AM|PM)/.exec(text)
    assert(bed && Math.abs(minuteOf(bed[1], bed[2], bed[3]) - (19 * 60 + 15)) <= 20, `bedtime: ${bed?.[0]}, expected around 7:15 PM`)
    assert(text.includes('Based on Mira’s last 7 days'), `not learned from Mira’s week: ${text}`)
    return `next nap ${w[0]}, ${nap3[0]}, ${bed[0]}`
  }, { needs: ['A5'], shot: true })
  await check('P2', 'Sweet spot settings are shared: 2 naps a day set on one phone shows on the other', async () => {
    const sheet = clockPhone.page.getByRole('dialog', { name: 'Sweet spot' })
    await clockPhone.page.getByRole('button', { name: /Open Sweet spot$/ }).click()
    await sheet.getByRole('radio', { name: '2', exact: true }).click()
    await sheet.getByRole('button', { name: 'Close' }).click()
    // With two naps a day, the rest of the day is one more nap and then bed.
    await waitFor(async () => !/nap 3/.test(await clockPhone.page.getByRole('region', { name: 'Sweet spot' }).textContent()), 10_000)
    await tab(dad, 'Today')
    await dad.page.getByRole('button', { name: 'Mira', exact: true }).click({ timeout: 20_000 })
    await waitFor(async () => {
      await noDialogs(dad)
      await dad.page.getByRole('button', { name: /Open Sweet spot$/ }).click()
      const d = dad.page.getByRole('dialog', { name: 'Sweet spot' })
      const on = await d.getByRole('radio', { name: '2', exact: true }).getAttribute('aria-checked')
      await d.getByRole('button', { name: 'Close' }).click()
      return on === 'true'
    }, 20_000, 1000)
    await noDialogs(dad)
    await dad.page.getByRole('button', { name: 'Asha', exact: true }).click()
  }, { needs: ['P1'] })

  // ---------------------------------------------------------------- security
  await check('S1', 'A stranger with a family of their own sees none of ours', async () => {
    await signUp(stranger, 'Stranger', email('stranger'))
    await createFamily(stranger, 'Stranger family', 'Zed', dayIso(60))
    await tab(stranger, 'History')
    assert((await stranger.page.getByText('Asha').count()) === 0, 'Asha is visible to the stranger')
    await tab(stranger, 'Family')
    assert((await stranger.page.getByText(/Mom|Papa/).count()) === 0, 'our members are visible to the stranger')
  })
  await check('S2', 'A stranger can’t read, add, change, join or listen in through the API', async () => {
    assert(familyId, 'no family id')
    const s = await apiAs(email('stranger'))
    const me = (await s.auth.getUser()).data.user.id
    for (const table of ['events', 'children', 'audit_log', 'imports', 'timer_segments']) {
      const { data } = await s.from(table).select('id').eq('family_id', familyId)
      assert((data ?? []).length === 0, `read ${data?.length} rows of ${table}`)
    }
    const fam = await s.from('families').select('id, code').eq('id', familyId)
    assert(!(fam.data ?? []).length, 'read our family and its code')
    const { data: kid } = await momApi.from('children').select('id').eq('family_id', familyId).limit(1).single()
    const add = await s.from('events').insert({ id: crypto.randomUUID(), family_id: familyId, child_id: kid.id, type: 'note', started_at: new Date().toISOString(), data: {} })
    assert(add.error, 'the stranger added an entry')
    const anyId = (await momApi.from('events').select('id').eq('family_id', familyId).limit(1).single()).data.id
    const change = await s.from('events').update({ notes: 'hacked' }).eq('id', anyId).select('id')
    assert(!change.data?.length, 'the stranger changed an entry')
    const rename = await s.from('families').update({ name: 'hacked' }).eq('id', familyId).select('id')
    assert(!rename.data?.length, 'the stranger renamed the family')
    const sneak = await s.from('family_members').insert({ family_id: familyId, user_id: me })
    assert(sneak.error, 'the stranger added themselves to the family')
    let heard = 0
    const ch = s.channel(`spy-${RUN}`).on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `family_id=eq.${familyId}` }, () => heard++)
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('the spy channel never connected')), 15_000)
      ch.subscribe((st) => st === 'SUBSCRIBED' && (clearTimeout(t), res()))
    })
    await momApi.from('events').insert({ id: crypto.randomUUID(), family_id: familyId, child_id: kid.id, type: 'diaper', started_at: new Date().toISOString(), data: { kind: 'wet' } })
    await new Promise((r) => setTimeout(r, 6000))
    await s.removeChannel(ch)
    assert(heard === 0, `the stranger heard ${heard} live updates`)
    const photo = (await momApi.from('events').select('photo_paths').eq('family_id', familyId).neq('photo_paths', '{}').limit(1).single()).data?.photo_paths?.[0]
    assert(photo, 'no photo to test with')
    const url = await s.storage.from('family').createSignedUrl(photo, 60)
    assert(url.error || !url.data?.signedUrl, 'the stranger could open a family photo')
    const own = await momApi.storage.from('family').createSignedUrl(photo, 60)
    assert(own.data?.signedUrl, 'the family itself can’t open its photo')
  }, { needs: ['S1', 'A5'] })
  await check('S3', 'Guessing codes is stopped after 5 wrong tries an hour', async () => {
    const t = await apiAs(email('grandma'))
    let last
    for (let i = 0; i < 6; i++) last = await t.rpc('join_family', { p_code: `LEELA-ZZZ${i}-ZZZZ`, p_display_name: 'Nani', p_confirm: false })
    assert(last.data?.error === 'too_many_attempts', `after 6 tries: ${JSON.stringify(last.data)}`)
  }, { needs: ['F7'] })
  await check('S4', 'The last person to leave a family closes it', async () => {
    await tab(stranger, 'Family')
    await stranger.page.getByRole('button', { name: 'Leave family' }).click()
    const d = stranger.page.getByRole('dialog', { name: 'Leave family?' })
    await d.getByLabel('Type DELETE to confirm').fill('DELETE')
    await d.getByRole('button', { name: 'Delete family and leave' }).click()
    await stranger.page.getByRole('heading', { name: 'Set up your family' }).waitFor({ timeout: 20_000 })
  }, { needs: ['S1'] })

  // ---------------------------------------------------------------- data, activity and backups
  await check('D1', 'The activity log records who did what', async () => {
    const want = ['created the family', 'joined the family', 'logged', 'edited', 'deleted', 'restored']
    if (passed('I1')) want.push('imported')
    if (passed('I7')) want.push('undid an import')
    if (passed('N4')) want.push('taught Leela “qz” = wet diaper')
    if (passed('F2')) want.push('changed their name to “Papa”')
    if (passed('F6')) want.push('reset the family code')
    if (passed('F7')) want.push(/removed (Nani|A family member)/)
    if (passed('F8')) want.push('made Papa the owner')
    if (passed('F9')) want.push('updated Ravi Kumar’s details')
    await tab(mom, 'Family')
    await mom.page.getByRole('button', { name: 'See all activity' }).click()
    const sheet = mom.page.getByRole('dialog', { name: 'Activity' })
    await sheet.locator('li').first().waitFor({ timeout: 15_000 })
    const older = sheet.getByRole('button', { name: 'Show older' })
    const busy = sheet.getByRole('button', { name: 'Loading…' })
    for (let i = 0; i < 40; i++) {
      await busy.waitFor({ state: 'detached', timeout: 20_000 })
      const text = await sheet.textContent()
      if (want.every((w) => (typeof w === 'string' ? text.includes(w) : w.test(text)))) break
      if (!(await older.count())) break
      await older.click()
      await mom.page.waitForTimeout(300)
    }
    const text = await sheet.textContent()
    const missing = want.filter((w) => !(typeof w === 'string' ? text.includes(w) : w.test(text))).map(String)
    const items = await sheet.locator('li').count()
    assert(!missing.length, `not in the activity log: ${missing.join('; ')}`)
    await sheet.getByRole('button', { name: 'Close' }).click()
    return `${items} items read`
  }, { needs: ['A5'], shot: true })
  await check('D2', 'Download everything: a full backup with every entry and every change', async () => {
    await tab(mom, 'Family')
    const [dl] = await Promise.all([mom.page.waitForEvent('download', { timeout: 60_000 }), mom.page.getByRole('button', { name: /Download everything/ }).click()])
    const file = `${OUT}/backup.json`
    await dl.saveAs(file)
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    fs.rmSync(file)
    const active = data.events.filter((e) => !e.deleted_at).length
    assert(data.family?.id === familyId, 'the backup is of the wrong family')
    assert(data.events.length > 40, `only ${data.events.length} entries`)
    assert(data.activity_log.length >= data.events.length, `${data.activity_log.length} changes for ${data.events.length} entries`)
    assert(data.events.some((e) => e.deleted_at), 'deleted entries are missing from the backup')
    const [dl2] = await Promise.all([mom.page.waitForEvent('download', { timeout: 60_000 }), mom.page.getByRole('button', { name: /Download entries/ }).click()])
    await dl2.saveAs(`${OUT}/entries.csv`)
    const csv = fs.readFileSync(`${OUT}/entries.csv`, 'utf8')
    fs.rmSync(`${OUT}/entries.csv`)
    const header = csv.replace(/^﻿/, '').split('\r\n')[0]
    const rowsInCsv = csv.split('\r\n').length - 1
    assert(header.startsWith('Date,Time,Ended,Kind') && rowsInCsv >= data.events.length, `the CSV has ${rowsInCsv} rows for ${data.events.length} entries`)
    await tab(mom, 'Today')
    return `${data.events.length} entries (${active} active), ${data.activity_log.length} changes, ${data.children.length} babies, ${data.imports.length} imports`
  }, { needs: ['A5'] })
  await check('D3', 'The database agrees with the phones', async () => {
    const all = []
    for (let from = 0; ; from += 1000) {
      const { data } = await momApi.from('events').select('id, type, deleted_at, source, import_id, created_by, child_id').eq('family_id', familyId).range(from, from + 999)
      all.push(...data)
      if (data.length < 1000) break
    }
    assert(new Set(all.map((e) => e.id)).size === all.length, 'duplicate ids')
    assert(all.filter((e) => e.source === 'import').every((e) => e.import_id), 'imported entries without their import')
    assert(all.every((e) => e.created_by), 'entries without who logged them')
    const { count: changes } = await momApi.from('audit_log').select('id', { count: 'exact', head: true }).eq('family_id', familyId)
    assert(changes >= all.length, `${changes} activity records for ${all.length} entries`)
    const { count: inserts } = await momApi.from('audit_log').select('id', { count: 'exact', head: true }).eq('family_id', familyId).eq('table_name', 'events').eq('action', 'insert')
    assert(inserts === all.length, `${inserts} insert records for ${all.length} entries`)
    const byType = {}
    for (const e of all.filter((x) => !x.deleted_at)) byType[e.type] = (byType[e.type] ?? 0) + 1
    return `${all.length} entries (${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(', ')}), ${changes} activity records`
  }, { needs: ['A5'] })
  await check('D4', 'Nothing can be permanently erased, not even by the family through the API', async () => {
    const victim = (await momApi.from('events').select('id').eq('family_id', familyId).limit(1).single()).data.id
    const del = await momApi.from('events').delete().eq('id', victim).select('id')
    assert(!del.data?.length, 'an entry was hard-deleted')
    const still = await momApi.from('events').select('id').eq('id', victim).maybeSingle()
    assert(still.data?.id === victim, 'the entry is gone')
    const audit = await momApi.from('audit_log').delete().eq('family_id', familyId).select('id')
    assert(!audit.data?.length, 'activity records were deleted')
    const forge = await momApi.from('audit_log').insert({ family_id: familyId, table_name: 'events', row_id: victim, action: 'delete', changes: {} })
    assert(forge.error, 'a fake activity record was written')
  }, { needs: ['A5'] })
  await check('D5', 'Signing out and back in brings everything back', async () => {
    await tab(dad, 'Family')
    await dad.page.getByRole('button', { name: 'Sign out' }).click()
    await dad.page.getByRole('tab', { name: 'Sign in' }).waitFor({ timeout: 15_000 })
    await signIn(dad, email('dad'))
    await dad.page.getByRole('button', { name: 'Asha', exact: true }).waitFor({ timeout: 30_000 })
    await dad.page.getByRole('button', { name: 'Asha', exact: true }).click()
    await seen(dad, 'Calpol')
  }, { needs: ['A5'] })
  await check('D6', 'The app can be installed: manifest and offline worker', async () => {
    const ok = await mom.page.evaluate(async () => {
      const m = document.querySelector('link[rel=manifest]')
      const reg = await navigator.serviceWorker.getRegistration()
      return Boolean(m && reg?.active)
    })
    assert(ok, 'no manifest or service worker')
  })

  // ---------------------------------------------------------------- leaving
  await check('X1', 'A parent can leave; the family carries on for the other', async () => {
    await tab(dad, 'Family')
    await dad.page.getByRole('button', { name: 'Leave family' }).click()
    await dad.page.getByRole('dialog', { name: 'Leave family?' }).getByRole('button', { name: 'Leave family' }).click()
    await dad.page.getByRole('heading', { name: 'Set up your family' }).waitFor({ timeout: 20_000 })
    const { data } = await momApi.from('events').select('id').eq('family_id', familyId).limit(1)
    assert(data?.length, 'Mom lost the family’s entries')
  }, { needs: ['A5'] })
  await check('X2', 'The test family is closed at the end, so its code stops working', async () => {
    await mom.page.reload()
    await mom.page.getByRole('button', { name: 'Asha', exact: true }).or(mom.page.getByRole('heading', { name: 'Asha' })).first().waitFor({ timeout: 20_000 })
    await tab(mom, 'Family')
    await mom.page.getByRole('button', { name: 'Leave family' }).click()
    const d = mom.page.getByRole('dialog', { name: 'Leave family?' })
    await d.getByLabel('Type DELETE to confirm').fill('DELETE')
    await d.getByRole('button', { name: 'Delete family and leave' }).click()
    await mom.page.getByRole('heading', { name: 'Set up your family' }).waitFor({ timeout: 20_000 })
  }, { needs: ['X1'] })
}

// ============================================================================ run and report
const started = Date.now()
try {
  if (MODE === 'full') await full()
  await canary()
} catch (e) {
  results.push({ id: 'X', name: 'The test run crashed', status: 'fail', note: String(e?.stack ?? e).slice(0, 800) })
} finally {
  await browser?.close().catch(() => {})
}
const pass = results.filter((r) => r.status === 'pass').length
const fail = results.filter((r) => r.status === 'fail').length
const skip = results.filter((r) => r.status === 'skip').length
const live = [...(timings.live ?? [])].sort((a, b) => a - b)
const summary = {
  run: RUN,
  mode: MODE,
  at: new Date().toISOString(),
  minutes: Math.round((Date.now() - started) / 6000) / 10,
  pass,
  fail,
  skip,
  live_sync_ms: live.length ? { min: live[0], median: live[Math.floor(live.length / 2)], max: live[live.length - 1] } : null,
}
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify({ summary, results, errors: [...new Set(errors)] }, null, 1))
const md = [
  `# Leela end-to-end test`,
  ``,
  `Run ${RUN} (${MODE}), ${summary.at}, ${summary.minutes} min. **${pass} passed, ${fail} failed, ${skip} skipped.**`,
  summary.live_sync_ms ? `\nLive sync between phones: median ${summary.live_sync_ms.median} ms (fastest ${summary.live_sync_ms.min}, slowest ${summary.live_sync_ms.max}).` : '',
  ``,
  `| | Check | Result | Time | Notes |`,
  `|---|---|---|---|---|`,
  ...results.map((r) => `| ${r.id} | ${r.name} | ${r.status === 'pass' ? 'pass' : r.status === 'fail' ? '**FAIL**' : 'skipped'} | ${r.ms ? `${(r.ms / 1000).toFixed(1)}s` : ''} | ${(r.note ?? '').replace(/\|/g, '/').replace(/\n/g, ' ')}${r.shots?.length ? ` (${r.shots.join(', ')})` : ''} |`),
  ``,
  errors.length ? `## Browser errors\n\n${[...new Set(errors)].map((e) => `- ${e}`).join('\n')}` : 'No browser errors.',
].join('\n')
fs.writeFileSync(`${OUT}/report.md`, md)
console.log(md)
process.exit(fail ? 1 : 0)
