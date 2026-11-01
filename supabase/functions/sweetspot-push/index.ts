// Sweet spot reminders. Called every minute by pg_cron (action "cron", with the shared secret):
// works out each baby's next nap or bedtime with the same code as the app (sweetspot.js is built
// from src/lib/sweetspot.ts) and sends one Web Push per phone that asked for a reminder, once per
// sleep. A signed-in person can also ask for a test notification on their own phones (action
// "test"). Deploy with verify_jwt = false: this function checks the secret or the user itself.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { sweetSpot } from './sweetspot.js'
import { sendPush, type Vapid } from './webpush.ts'

const DAY = 86_400_000
const SUBJECT = 'https://shiven-goel.github.io/leela/'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// deno-lint-ignore no-explicit-any
type Db = any

interface Sub {
  id: string
  user_id: string
  family_id: string
  endpoint: string
  p256dh: string
  auth: string
  lead_min: number
  app_url: string | null
}

function clock(t: number, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(t)
}
function range(a: number, b: number, timeZone: string) {
  const x = clock(a, timeZone)
  const y = clock(b, timeZone)
  return x.slice(-2) === y.slice(-2) ? `${x.slice(0, -3)} – ${y}` : `${x} – ${y}`
}
function localDate(t: number, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(t)
}

async function config(admin: Db): Promise<{ vapid: Vapid; cronSecret: string }> {
  const { data, error } = await admin.rpc('push_config')
  if (error || !data?.vapid_private) throw new Error(`push_config: ${error?.message ?? 'missing keys'}`)
  return { vapid: { publicKey: data.vapid_public, privateJwk: JSON.parse(data.vapid_private), subject: SUBJECT }, cronSecret: data.cron_secret }
}

async function deliver(admin: Db, sub: Sub, message: Record<string, unknown>, vapid: Vapid) {
  try {
    // No Topic header: Mozilla's service holds topic messages back from a connected phone. The
    // notification's tag already replaces an older reminder on the phone.
    const r = await sendPush(sub, message, vapid, { ttl: 1800, urgency: 'high' })
    if (r.gone) {
      await admin.from('push_subscriptions').update({ disabled_at: new Date().toISOString(), disabled_reason: `expired (${r.status})` }).eq('id', sub.id)
    } else if (r.status < 300) {
      await admin.from('push_subscriptions').update({ last_sent_at: new Date().toISOString() }).eq('id', sub.id)
    } else {
      console.error('push refused', r.status, r.detail)
    }
    return r.status
  } catch (e) {
    console.error('push failed', String(e))
    return 0
  }
}

async function remind(admin: Db, vapid: Vapid) {
  const now = Date.now()
  const { data: subs } = await admin.from('push_subscriptions').select('id, user_id, family_id, endpoint, p256dh, auth, lead_min, app_url').is('disabled_at', null)
  if (!subs?.length) return { phones: 0, sent: 0 }
  const familyIds = [...new Set((subs as Sub[]).map((s) => s.family_id))]
  const [{ data: families }, { data: members }, { data: kids }] = await Promise.all([
    admin.from('families').select('id, timezone, night_start, night_end').in('id', familyIds).is('deleted_at', null),
    admin.from('family_members').select('family_id, user_id').in('family_id', familyIds).is('removed_at', null),
    admin.from('children').select('id, family_id, name, birth_date, due_date, sex, avatar_path, settings, created_at, deleted_at').in('family_id', familyIds).is('deleted_at', null),
  ])
  if (!kids?.length) return { phones: subs.length, sent: 0 }
  const member = new Set((members ?? []).map((m: { family_id: string; user_id: string }) => `${m.family_id}/${m.user_id}`))
  const since = new Date(now - 16 * DAY).toISOString()
  const sleeps: Record<string, unknown>[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await admin
      .from('events')
      .select('id, family_id, child_id, type, started_at, ended_at, timer_state, data, deleted_at')
      .in('child_id', kids.map((k: { id: string }) => k.id))
      .eq('type', 'sleep')
      .is('deleted_at', null)
      .gte('started_at', since)
      .order('started_at')
      .range(from, from + 999)
    sleeps.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }

  let sent = 0
  let due = 0
  for (const kid of kids) {
    const fam = (families ?? []).find((f: { id: string }) => f.id === kid.family_id)
    if (!fam) continue
    const spot = sweetSpot(sleeps.filter((e) => e.child_id === kid.id) as never, kid, fam, now)
    const w = spot.next
    if (spot.status !== 'ok' || !w) continue
    const slot = `${localDate(w.center, fam.timezone)}/${w.kind === 'bedtime' ? 'bed' : `nap${w.napNumber ?? ''}`}`
    const endpoints = new Set<string>()
    for (const sub of (subs as Sub[]).filter((s) => s.family_id === kid.family_id && member.has(`${s.family_id}/${s.user_id}`))) {
      if (now < w.start - sub.lead_min * 60_000 || now > w.end) continue
      due++
      // One reminder per phone per sleep, even if the prediction moves a little afterwards.
      const { error } = await admin.from('push_sent').insert({ subscription_id: sub.id, child_id: kid.id, slot })
      if (error) continue // already sent
      if (endpoints.has(sub.endpoint)) continue // two people signed in on one phone: one notification
      endpoints.add(sub.endpoint)
      const mins = Math.round((w.start - now) / 60_000)
      const what = w.kind === 'bedtime' ? 'bedtime' : 'nap'
      const message = {
        title: mins >= 2 ? `${kid.name}’s ${what} sweet spot in ${mins} min` : `${kid.name}’s ${what} sweet spot is now`,
        body: mins >= 10 ? `Sweet spot ${range(w.start, w.end, fam.timezone)}. A good time to start winding down.` : `Sweet spot ${range(w.start, w.end, fam.timezone)}.`,
        tag: `sweetspot-${kid.id}`,
        url: sub.app_url ?? SUBJECT,
      }
      const status = await deliver(admin, sub, message, vapid)
      await admin.from('push_sent').update({ status }).match({ subscription_id: sub.id, child_id: kid.id, slot })
      if (status >= 200 && status < 300) sent++
    }
  }
  return { phones: subs.length, babies: kids.length, due, sent }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)
  const url = Deno.env.get('SUPABASE_URL')
  let serviceKey: string | undefined
  try {
    serviceKey = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default
  } catch {
    serviceKey = undefined
  }
  serviceKey ??= Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return reply({ error: 'server_not_configured' }, 500)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  let body: { action?: string; endpoint?: string } = {}
  try {
    body = await req.json()
  } catch {
    /* empty body */
  }
  let cfg: Awaited<ReturnType<typeof config>>
  try {
    cfg = await config(admin)
  } catch (e) {
    console.error(String(e))
    return reply({ error: 'server_not_configured' }, 500)
  }

  if (body.action === 'test') {
    // A test notification to the caller's own phones (or just this one).
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: who } = await admin.auth.getUser(token)
    if (!who?.user) return reply({ error: 'not_signed_in' }, 401)
    let q = admin.from('push_subscriptions').select('id, user_id, family_id, endpoint, p256dh, auth, lead_min, app_url').eq('user_id', who.user.id).is('disabled_at', null)
    if (body.endpoint) q = q.eq('endpoint', body.endpoint)
    const { data: subs } = await q
    if (!subs?.length) return reply({ error: 'no_phone' }, 404)
    const statuses = []
    for (const sub of subs as Sub[]) {
      statuses.push(await deliver(admin, sub, { title: 'Leela reminders are on', body: `You’ll get a notification ${sub.lead_min} minutes before each sweet spot.`, tag: 'leela-test', url: sub.app_url ?? SUBJECT }, cfg.vapid))
    }
    return reply({ ok: statuses.some((s) => s >= 200 && s < 300), statuses })
  }

  if (req.headers.get('x-leela-cron') !== cfg.cronSecret) return reply({ error: 'forbidden' }, 403)
  try {
    return reply({ ok: true, ...(await remind(admin, cfg.vapid)) })
  } catch (e) {
    console.error('remind failed', String(e))
    return reply({ error: 'failed' }, 500)
  }
})
