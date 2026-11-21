// Keshav's admin panel (only people with profiles.prefs.admin = true; nobody else sees it exists).
// Signed-in caller only; deploy with verify_jwt = false (the sign-in is checked here).
// Requests (POST, JSON):
//   { action: "overview" } -> { backups, phones, ghar, people }
//   { action: "backup_now" } -> the backup function's reply
//   { action: "download", name } -> { url } (a link that works for 5 minutes)
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)
  const url = Deno.env.get('SUPABASE_URL')!
  let key: string | undefined
  try {
    key = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default
  } catch {
    key = undefined
  }
  key ??= Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const admin = createClient(url, key!, { auth: { persistSession: false, autoRefreshToken: false } })

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: who } = await admin.auth.getUser(token)
  if (!who?.user) return reply({ error: 'not_signed_in' }, 401)
  const { data: me } = await admin.from('profiles').select('prefs').eq('id', who.user.id).maybeSingle()
  if (me?.prefs?.admin !== true) return reply({ error: 'not_found' }, 404)

  const body = await req.json().catch(() => ({}))
  try {
    if (body.action === 'overview') {
      const { data: member } = await admin.from('family_members').select('family_id').eq('user_id', who.user.id).maybeSingle()
      const fid = member?.family_id
      const [files, subs, link, members] = await Promise.all([
        admin.storage.from('backups').list('daily', { limit: 100, sortBy: { column: 'name', order: 'desc' } }),
        admin.from('push_subscriptions').select('user_id, lead_min, user_agent, created_at, last_sent_at, disabled_at, disabled_reason').eq('family_id', fid),
        admin.from('ghar_links').select('ghar_household, created_at').eq('family_id', fid).maybeSingle(),
        admin.from('family_members').select('user_id, joined_at, last_seen_at').eq('family_id', fid),
      ])
      const ids = [...new Set([...(members.data ?? []).map((m) => m.user_id), ...(subs.data ?? []).map((s) => s.user_id)])]
      const { data: profs } = await admin.from('profiles').select('id, display_name, prefs').in('id', ids)
      const name = (id: string) => profs?.find((p) => p.id === id)?.display_name || 'Someone'
      return reply({
        backups: (files.data ?? []).filter((f) => f.name.endsWith('.json.gz')).map((f) => ({ name: f.name, bytes: f.metadata?.size ?? null, at: f.created_at })),
        phones: (subs.data ?? []).map((s) => ({ who: name(s.user_id), lead: s.lead_min, phone: s.user_agent, since: s.created_at, lastSent: s.last_sent_at, off: s.disabled_at, why: s.disabled_reason })),
        ghar: link.data ? { linked: true, since: link.data.created_at } : { linked: false },
        people: (members.data ?? []).map((m) => ({ who: name(m.user_id), joined: m.joined_at, lastSeen: m.last_seen_at, alerts: profs?.find((p) => p.id === m.user_id)?.prefs?.alerts ?? null })),
      })
    }
    if (body.action === 'backup_now') {
      const { data: cfg } = await admin.rpc('push_config')
      const r = await fetch(`${url}/functions/v1/backup`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-leela-cron': cfg?.cron_secret ?? '' }, body: '{}' })
      return reply(await r.json().catch(() => ({ error: `backup replied ${r.status}` })), r.ok ? 200 : 500)
    }
    if (body.action === 'download') {
      const name = String(body.name ?? '')
      if (!/^leela-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(name)) return reply({ error: 'bad_name' }, 400)
      const { data, error } = await admin.storage.from('backups').createSignedUrl(`daily/${name}`, 300, { download: name })
      if (error) throw error
      return reply({ url: data.signedUrl })
    }
    return reply({ error: 'unknown_action' }, 400)
  } catch (e) {
    console.error('admin', String(e))
    return reply({ error: 'failed' }, 500)
  }
})
