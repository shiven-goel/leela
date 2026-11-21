import { useEffect, useMemo, useState } from 'react'
import { Overlay } from '../components/Overlay'
import { Button } from '../components/ui'
import { activeChild, useLeela } from '../lib/store'
import { supabase } from '../lib/supabase'
import { loadAllHistory } from '../lib/sync'
import { fmtShortDate, fmtTime } from '../lib/time'
import { GrowthCard } from './HistoryTrends'

declare const __APP_VERSION__: string

interface Overview {
  backups: { name: string; bytes: number | null; at: string }[]
  phones: { who: string; lead: number; phone: string | null; since: string; lastSent: string | null; off: string | null; why: string | null }[]
  ghar: { linked: boolean; since?: string }
  people: { who: string; joined: string; lastSeen: string; alerts: Record<string, unknown> | null }[]
}

const phoneName = (ua: string | null) => {
  if (!ua) return 'A phone'
  const android = /Android [\d.]+; ([^;)]+)/.exec(ua)
  if (android) return android[1].trim() === 'K' ? 'Android phone' : android[1].trim()
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/Windows/.test(ua)) return 'Windows computer'
  if (/Mac OS X/.test(ua)) return 'Mac'
  return 'A phone'
}

/** Only for Keshav (profiles.prefs.admin): WHO growth, backups, phones and the Ghar link. */
export function AdminScreen({ open, onClose }: { open: boolean; onClose: () => void }) {
  const family = useLeela((s) => s.family)!
  const eventsMap = useLeela((s) => s.events)
  const lastSyncAt = useLeela((s) => s.lastSyncAt)
  const child = activeChild()
  const tz = family.timezone
  const [data, setData] = useState<Overview | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const events = useMemo(() => Object.values(eventsMap).filter((e) => !e.deleted_at), [eventsMap])

  const call = async (body: Record<string, unknown>) => {
    const { data: d, error } = await supabase.functions.invoke('admin', { body })
    if (error) throw error
    return d
  }
  const load = async () => {
    try {
      setData((await call({ action: 'overview' })) as Overview)
    } catch {
      setNote('Couldn’t load the overview. Check the connection.')
    }
  }
  useEffect(() => {
    if (!open) return
    void loadAllHistory()
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const backupNow = async () => {
    setBusy(true)
    setNote(null)
    try {
      const r = (await call({ action: 'backup_now' })) as { ok?: boolean; counts?: Record<string, number> }
      setNote(r.ok ? `Backed up: ${r.counts?.events ?? 0} entries.` : 'The backup didn’t finish.')
      await load()
    } catch {
      setNote('The backup didn’t finish.')
    }
    setBusy(false)
  }
  const download = async (name: string) => {
    try {
      const r = (await call({ action: 'download', name })) as { url?: string }
      if (r.url) window.location.href = r.url
    } catch {
      setNote('Couldn’t get that backup.')
    }
  }

  return (
    <Overlay open={open} onClose={onClose} title="Admin">
      <p className="mb-4 text-[14px] text-ink-3">Only you can see this page.</p>

      {child && <GrowthCard child={child} events={events} now={Date.now()} who />}

      <Block title="Backups">
        <p className="mb-3 text-[14px] text-ink-2">A private copy of everything is saved every night at 3:17 am and kept for 30 days.</p>
        <ul className="mb-3 space-y-1.5">
          {(data?.backups ?? []).slice(0, 7).map((b) => (
            <li key={b.name} className="flex items-center justify-between gap-2 text-[15px]">
              <span>
                {fmtShortDate(b.at, tz)}, {fmtTime(b.at, tz)}
                {b.bytes ? <span className="text-ink-3"> · {Math.round(b.bytes / 1024)} KB</span> : null}
              </span>
              <button type="button" className="min-h-10 px-2 text-[14px] font-semibold text-brand" onClick={() => void download(b.name)}>
                Download
              </button>
            </li>
          ))}
          {data && data.backups.length === 0 && <li className="text-[15px] text-ink-2">No backups yet.</li>}
        </ul>
        <Button variant="secondary" size="md" onClick={() => void backupNow()} disabled={busy}>
          {busy ? 'Backing up…' : 'Back up now'}
        </Button>
      </Block>

      <Block title="Family">
        <ul className="space-y-2">
          {(data?.people ?? []).map((p) => (
            <li key={p.who} className="text-[15px]">
              <strong className="font-semibold">{p.who}</strong>
              <span className="block text-[14px] text-ink-2">
                Last opened {fmtShortDate(p.lastSeen, tz)}, {fmtTime(p.lastSeen, tz)} · joined {fmtShortDate(p.joined, tz)}
              </span>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Notifications">
        <ul className="space-y-2">
          {(data?.phones ?? []).map((ph, i) => (
            <li key={i} className="text-[15px]">
              <strong className="font-semibold">{ph.who}</strong> · {phoneName(ph.phone)}
              <span className="block text-[14px] text-ink-2">
                {ph.off ? `Off since ${fmtShortDate(ph.off, tz)} (${ph.why ?? 'turned off'})` : `On, sweet spot ${ph.lead} min ahead`}
                {ph.lastSent ? ` · last sent ${fmtShortDate(ph.lastSent, tz)}, ${fmtTime(ph.lastSent, tz)}` : ''}
              </span>
            </li>
          ))}
          {data && data.phones.length === 0 && <li className="text-[15px] text-ink-2">No phone has notifications turned on.</li>}
        </ul>
      </Block>

      <Block title="Ghar">
        <p className="text-[15px]">{data ? (data.ghar.linked ? `Linked to Ghar since ${fmtShortDate(data.ghar.since!, tz)}.` : 'Not linked to Ghar.') : '…'}</p>
      </Block>

      <Block title="App">
        <p className="text-[15px] text-ink-2">
          Version {typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'} · last synced {lastSyncAt ? `${fmtTime(lastSyncAt, tz)}` : 'not yet'} · {events.length} entries on this phone
        </p>
      </Block>

      {note && (
        <p className="mt-2 text-[14px] font-semibold" role="status">
          {note}
        </p>
      )}
    </Overlay>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 rounded-[24px] bg-card p-4">
      <h2 className="mb-2 font-display text-[19px] font-bold">{title}</h2>
      {children}
    </section>
  )
}
