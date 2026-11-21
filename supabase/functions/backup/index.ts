// Daily private copy of Leela's data. Called once a day by pg_cron (job "leela-backup", with the
// same shared secret as the reminders): reads every table and the sign-in list, and saves them as
// one gzipped JSON file in the private storage bucket "backups" (daily/leela-YYYY-MM-DD.json.gz).
// Copies older than 30 days are removed. Photos already live in storage and aren't copied.
// Nobody can read the bucket except the service role (no storage policies). To restore, Claude
// downloads a copy and writes the rows back (see CLAUDE.md, "Backups").
// Deploy with verify_jwt = false: this function checks the secret itself.
import { createClient } from 'npm:@supabase/supabase-js@2'

const KEEP_DAYS = 30
const BUCKET = 'backups'
// Every table with family data. A table that doesn't exist is noted and skipped.
const TABLES = ['families', 'family_members', 'profiles', 'children', 'events', 'timer_segments', 'imports', 'audit_log', 'ghar_links', 'push_subscriptions']

const reply = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// deno-lint-ignore no-explicit-any
type Db = any

async function readAll(admin: Db, table: string): Promise<{ rows: unknown[]; error?: string }> {
  const rows: unknown[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select('*').range(from, from + 999)
    if (error) return { rows, error: error.message }
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return { rows }
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)
  const url = Deno.env.get('SUPABASE_URL')
  let key: string | undefined
  try {
    key = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default
  } catch {
    key = undefined
  }
  key ??= Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return reply({ error: 'server_not_configured' }, 500)
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: cfg, error: cfgError } = await admin.rpc('push_config')
  if (cfgError || !cfg?.cron_secret) return reply({ error: 'server_not_configured' }, 500)
  if (req.headers.get('x-leela-cron') !== cfg.cron_secret) return reply({ error: 'forbidden' }, 403)

  try {
    const takenAt = new Date().toISOString()
    const tables: Record<string, unknown[]> = {}
    const problems: Record<string, string> = {}
    for (const t of TABLES) {
      const r = await readAll(admin, t)
      if (r.error) problems[t] = r.error
      else tables[t] = r.rows
    }
    // The sign-in list (emails and names, never passwords), so accounts can be matched up again.
    const users: unknown[] = []
    for (let page = 1; page < 50; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) {
        problems.users = error.message
        break
      }
      for (const u of data.users) users.push({ id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, user_metadata: u.user_metadata })
      if (data.users.length < 1000) break
    }

    const file = await gzip(JSON.stringify({ app: 'leela', version: 1, taken_at: takenAt, tables, users, problems }))
    const name = `daily/leela-${takenAt.slice(0, 10)}.json.gz`
    const { error: upError } = await admin.storage.from(BUCKET).upload(name, file, { contentType: 'application/gzip', upsert: true })
    if (upError) throw new Error(`upload: ${upError.message}`)

    // Keep the last month.
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10)
    const { data: list } = await admin.storage.from(BUCKET).list('daily', { limit: 1000 })
    const old = (list ?? []).map((f: { name: string }) => f.name).filter((n: string) => /^leela-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(n) && n.slice(6, 16) < cutoff)
    if (old.length) await admin.storage.from(BUCKET).remove(old.map((n: string) => `daily/${n}`))

    const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]))
    console.log('backup saved', name, file.length, JSON.stringify(counts), JSON.stringify(problems))
    return reply({ ok: true, file: name, bytes: file.length, counts: { ...counts, users: users.length }, problems, removed: old.length })
  } catch (e) {
    console.error('backup failed', String(e))
    return reply({ error: 'failed', detail: String(e) }, 500)
  }
})
