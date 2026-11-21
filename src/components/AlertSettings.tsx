import { useEffect, useState } from 'react'
import { savePrefs } from '../lib/actions'
import { type AlertPrefs, readAlerts } from '../lib/alerts'
import { disableReminders, enableReminders, localReminder, pushSupport, savedReminder, sendTestReminder, setReminderLead } from '../lib/push'
import { myPrefs, useLeela } from '../lib/store'
import { Button, Choices, Toggle } from './ui'

export const SUPPORT_TEXT = {
  'ios-install': 'On iPhone and iPad, notifications work once LAPdiary is on your Home Screen: tap Share, then Add to Home Screen, and open LAPdiary from there.',
  unsupported: 'This browser can’t show notifications. Chrome, Edge, Firefox or LAPdiary on an iPhone Home Screen can.',
  denied: 'Notifications are blocked for LAPdiary. Allow them in the browser’s site settings (or the phone’s Settings › Notifications), then turn them on again.',
} as const

/** This person's notification choices (the same on all their phones). */
export function myAlerts(): AlertPrefs {
  return readAlerts(myPrefs())
}

export async function saveAlerts(patch: Partial<AlertPrefs>) {
  await savePrefs({ alerts: { ...myAlerts(), ...patch } })
}

const SUMMARY_TIMES = ['19:30', '20:00', '20:30', '21:00', '21:30', '22:00']
const timeLabel = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`
}

/**
 * Turning notifications on for this phone, and which ones come: sweet spot, medicine doses,
 * vaccines and the evening summary. The phone part is per phone; the choices are per person.
 */
export function AlertSettings() {
  useLeela((s) => s.profiles)
  const [support, setSupport] = useState(pushSupport)
  const [lead, setLead] = useState<number | null>(localReminder)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const a = myAlerts()
  const on = lead !== null

  useEffect(() => {
    let alive = true
    void savedReminder().then((l) => alive && setLead(l))
    return () => {
      alive = false
    }
  }, [])

  const turn = async (want: boolean) => {
    if (busy) return
    setBusy(true)
    setNote(null)
    if (!want) {
      await disableReminders()
      setLead(null)
    } else {
      const r = await enableReminders(15)
      setSupport(pushSupport())
      if (r.ok) {
        setLead(15)
        setNote('Notifications are on for this phone.')
      } else if (r.reason === 'failed') setNote(`Couldn’t turn notifications on${r.detail ? `: ${r.detail}` : ''}.`)
    }
    setBusy(false)
  }
  const test = async () => {
    setBusy(true)
    setNote((await sendTestReminder()) ? 'Sent. It should arrive in a few seconds.' : 'Couldn’t send a test. Try turning notifications off and on again.')
    setBusy(false)
  }
  const changeLead = async (v: string | undefined) => {
    const n = Number(v)
    if (!n || n === lead) return
    if (await setReminderLead(n)) setLead(n)
    else setNote('Couldn’t change it. Check the connection and try again.')
  }

  return (
    <div>
      <Toggle label="Notifications on this phone" checked={on} onChange={(v) => void turn(v)} />
      {support !== 'ok' && <p className="mt-2 rounded-2xl bg-[var(--feed-soft)] px-4 py-3 text-[14px] leading-snug">{SUPPORT_TEXT[support]}</p>}
      {!on && support === 'ok' && <p className="mt-2 text-[14px] text-ink-2">Everyone turns them on on their own phone. LAPdiary can notify you even when it’s closed.</p>}
      {on && (
        <div className="mt-3 space-y-3">
          <Toggle label="Sweet spot (naps and bedtime)" checked={a.sweetspot} onChange={(v) => void saveAlerts({ sweetspot: v })} tone="sleep" />
          {a.sweetspot && (
            <div>
              <div className="mb-1.5 text-[14px] font-semibold text-ink-2">How long before</div>
              <Choices
                options={['5', '10', '15', '30'].map((x) => ({ id: x, label: `${x} min` }))}
                value={lead !== null ? String(lead) : undefined}
                onChange={(v) => void changeLead(v)}
                tone="sleep"
                columns={4}
                compact
              />
            </div>
          )}
          <Toggle label="Medicine doses due" checked={a.medicine} onChange={(v) => void saveAlerts({ medicine: v })} tone="health" />
          <Toggle label="Vaccines due" checked={a.vaccines} onChange={(v) => void saveAlerts({ vaccines: v })} tone="health" />
          <Toggle label="Evening summary of the day" checked={a.summary} onChange={(v) => void saveAlerts({ summary: v })} />
          {a.summary && (
            <div>
              <div className="mb-1.5 text-[14px] font-semibold text-ink-2">Summary at (pm)</div>
              <Choices options={SUMMARY_TIMES.map((t) => ({ id: t, label: timeLabel(t) }))} value={a.summaryAt} onChange={(v) => v && void saveAlerts({ summaryAt: v })} columns={6} compact />
            </div>
          )}
          <p className="text-[14px] text-ink-2">Medicine notifications come only for medicines logged with “Remind about the next dose”. Vaccine ones come 2 days before and on the day.</p>
          <Button variant="secondary" size="md" onClick={() => void test()} disabled={busy}>
            Send a test notification
          </Button>
        </div>
      )}
      {note && (
        <p className="mt-2 text-[14px] font-semibold" role="status">
          {note}
        </p>
      )}
    </div>
  )
}
