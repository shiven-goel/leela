import { useCallback, useEffect, useState } from 'react'
import { describeActivity, fetchActivity, type AuditEntry } from '../lib/activity'
import { useLeela } from '../lib/store'
import { ensureProfiles } from '../lib/sync'
import { dayLabel, fmtTime } from '../lib/time'
import { Sheet } from './Sheet'
import { Button } from './ui'

/** Every change saved to the server, newest first. */
export function ActivitySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const family = useLeela((s) => s.family)!
  const [items, setItems] = useState<AuditEntry[]>([])
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tz = family.timezone

  const more = useCallback(async (reset = false) => {
    setBusy(true)
    setError(null)
    try {
      const before = reset ? undefined : items[items.length - 1]?.id
      const page = await fetchActivity(before)
      await ensureProfiles(page.flatMap((a) => [a.actor, a.table_name === 'family_members' ? a.row_id : null]))
      setItems((cur) => (reset ? page : [...cur, ...page]))
      setDone(page.length < 60)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load the activity log.')
    } finally {
      setBusy(false)
    }
  }, [items])

  useEffect(() => {
    if (open) void more(true)
    // Reload each time it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const rows = items.map((a) => ({ a, d: describeActivity(a) })).filter((x) => x.d)
  let lastDay = ''
  return (
    <Sheet open={open} onClose={onClose} title="Activity">
      <p className="mb-4 text-[15px] text-ink-2">Every change saved to Leela’s server, by whom and when. Nothing here is ever erased.</p>
      {error && <p className="mb-3 rounded-2xl bg-[var(--health-soft)] px-4 py-3 text-[15px] text-[var(--health)]">{error}</p>}
      <ol>
        {rows.map(({ a, d }) => {
          const label = dayLabel(a.at, tz)
          const head = label !== lastDay
          lastDay = label
          return (
            <li key={a.id}>
              {head && <h3 className="mt-3 mb-1 text-[14px] font-semibold text-ink-2">{label}</h3>}
              <div className="flex gap-3 border-b border-line py-2.5 text-[15px] leading-snug">
                <span className="num w-[64px] shrink-0 whitespace-nowrap text-ink-2">{fmtTime(a.at, tz)}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{d!.who}</span> {d!.text}
                </span>
              </div>
            </li>
          )
        })}
      </ol>
      {!rows.length && !busy && !error && <p className="py-6 text-center text-ink-2">No activity yet.</p>}
      {!done && (
        <Button variant="secondary" size="md" className="mt-4 w-full" disabled={busy} onClick={() => void more()}>
          {busy ? 'Loading…' : 'Show older'}
        </Button>
      )}
    </Sheet>
  )
}
