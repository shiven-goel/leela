import { Printer } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Overlay } from '../components/Overlay'
import { Button, Choices } from '../components/ui'
import { dailyStats } from '../lib/charts'
import { activityLabel, dayAggs } from '../lib/insights'
import { bucketsOf, customPeriod, rangeText } from '../lib/period'
import { eventDetail, eventTitle } from '../lib/describe'
import { activeChild, myPrefs, useLeela } from '../lib/store'
import { loadAllHistory } from '../lib/sync'
import { addDaysTz, ageText, dayStart, durationText, fmtLongDate, fmtShortDate, fmtTime } from '../lib/time'
import type { LeelaEvent } from '../lib/types'
import { fmtLength, fmtWeight } from '../lib/units'

const INK = '#1b1f3b'
const INK2 = '#565b7d'
const LINE = '#dfe3f0'

/** A short summary for the doctor: the last days of sleep, feeds, nappies and anything health. */
export function ReportScreen({ open, onClose }: { open: boolean; onClose: () => void }) {
  const family = useLeela((s) => s.family)!
  const eventsMap = useLeela((s) => s.events)
  const segments = useLeela((s) => s.segments)
  const child = activeChild()
  const userId = useLeela((s) => s.userId)
  const asked = useLeela((s) => (s.overlay?.kind === 'report' && s.overlay.from !== undefined ? { from: s.overlay.from, to: s.overlay.to ?? Date.now() } : null))
  const [days, setDays] = useState<'7' | '14' | '30' | 'asked'>('14')
  useEffect(() => {
    if (open) void loadAllHistory()
    if (open) setDays(asked ? 'asked' : '14')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const tz = family.timezone
  const now = Date.now()
  const report = useMemo(() => {
    if (!child || !open) return null
    const today = dayStart(now, tz).getTime()
    const range =
      days === 'asked' && asked
        ? customPeriod(asked.from, Math.min(now, asked.to - 1), tz)
        : customPeriod(addDaysTz(today, -(Number(days === 'asked' ? 14 : days) - 1), tz).getTime(), now, tz)
    const buckets = bucketsOf(range, tz, now)
    const list = buckets.flatMap((b) => {
      const out: number[] = []
      for (let d = b.from; d < b.to; d = addDaysTz(d, 1, tz).getTime()) out.push(d)
      return out
    })
    const events = Object.values(eventsMap).filter((e) => !e.deleted_at)
    const daily = dailyStats(events, Object.values(segments), child.id, family, list, now)
    // Longer stretches are summarised a week (or a month) to a row, as a day's average.
    const stats = buckets.length === list.length ? daily.map((s, i) => ({ ...s, label: fmtShortDate(buckets[i].from, tz) })) : buckets.map((b) => averageRow(daily.filter((s) => s.day >= b.from && s.day < b.to), b.label))
    const aggs = dayAggs(events, Object.values(segments), child.id, userId, family, list, now)
    const care: string[] = []
    const vit = new Map<string, number>()
    for (const a of aggs) for (const k of Object.keys(a.vit)) vit.set(k, (vit.get(k) ?? 0) + 1)
    for (const [k, v] of vit) care.push(`${k} given on ${v} of ${list.length} days`)
    const acts = new Map<string, number>()
    for (const a of aggs) for (const [k, v] of Object.entries(a.act)) acts.set(k, (acts.get(k) ?? 0) + v.n)
    for (const [k, v] of [...acts.entries()].sort((x, y) => y[1] - x[1])) care.push(`${activityLabel(k)} ${v} ${v === 1 ? 'time' : 'times'}`)
    const from = list[0]
    const health = events
      .filter((e) => e.child_id === child.id && ['medicine', 'temperature', 'symptom'].includes(e.type) && !e.data.supplement && Date.parse(e.started_at) >= from && Date.parse(e.started_at) < addDaysTz(list[list.length - 1], 1, tz).getTime())
      .sort((a, b) => a.started_at.localeCompare(b.started_at))
    const growth = events
      .filter((e) => e.child_id === child.id && e.type === 'growth')
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, 3)
    return { stats, health, growth, from, to: list[list.length - 1], weekly: buckets.length !== list.length, care, days: list.length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [child, open, days, eventsMap, segments, family, asked?.from, asked?.to])

  if (!child) return null
  const doc = report && <ReportDoc report={report} childName={child.name} birth={child.birth_date} tz={tz} />
  return (
    <Overlay
      open={open}
      onClose={onClose}
      title="Doctor report"
      footer={
        <div className="space-y-3">
          <Choices
            options={[
              ...(asked ? [{ id: 'asked' as const, label: rangeText(asked.from, Math.min(now, asked.to - 1), tz) }] : []),
              { id: '7' as const, label: '7 days' },
              { id: '14' as const, label: '14 days' },
              { id: '30' as const, label: '30 days' },
            ]}
            compact
            value={days}
            onChange={(v) => v && setDays(v)}
          />
          <Button className="w-full" tone="health" onClick={() => window.print()} disabled={!report}>
            <Printer size={20} weight="bold" aria-hidden="true" /> Save as PDF or print
          </Button>
          <p className="text-center text-[13px] text-ink-3">The print screen opens. Choose Save as PDF, then share it with the doctor.</p>
        </div>
      }
    >
      <div className="overflow-hidden rounded-[18px] bg-white p-4 ring-1 ring-line">{doc}</div>
      {open && doc && createPortal(<div className="print-root"><style>{'@page { size: A4 portrait; margin: 14mm 13mm; }'}</style>{doc}</div>, document.body)}
    </Overlay>
  )
}

type Row = ReturnType<typeof dailyStats>[number] & { label: string }

interface Report {
  stats: Row[]
  health: LeelaEvent[]
  growth: LeelaEvent[]
  from: number
  to: number
  /** Rows are weeks or months, each a day's average. */
  weekly: boolean
  care: string[]
  days: number
}

/** A day's average over these days (those with anything logged), as one row. */
function averageRow(rows: ReturnType<typeof dailyStats>, label: string): Row {
  const logged = rows.filter((s) => s.totals.sleepMs || s.totals.feeds || s.totals.diapers)
  const n = Math.max(1, logged.length)
  const a = (f: (s: ReturnType<typeof dailyStats>[number]) => number) => logged.reduce((t, s) => t + f(s), 0) / n
  const base = rows[0]
  return {
    ...base,
    label,
    leftMin: Math.round(a((s) => s.leftMin)),
    rightMin: Math.round(a((s) => s.rightMin)),
    otherMin: Math.round(a((s) => s.otherMin)),
    totals: {
      ...base.totals,
      sleepMs: a((s) => s.totals.sleepMs),
      naps: Math.round(a((s) => s.totals.naps) * 10) / 10,
      feeds: Math.round(a((s) => s.totals.feeds) * 10) / 10,
      bottleMl: Math.round(a((s) => s.totals.bottleMl)),
      solids: Math.round(a((s) => s.totals.solids) * 10) / 10,
      wet: Math.round(a((s) => s.totals.wet) * 10) / 10,
      dirty: Math.round(a((s) => s.totals.dirty) * 10) / 10,
    },
  }
}

function ReportDoc({ report, childName, birth, tz }: { report: Report; childName: string; birth: string | null; tz: string }) {
  const prefs = myPrefs()
  // Averages over the days that have something logged, so a day with no entries doesn't drag them down.
  const logged = report.stats.filter((s) => s.totals.sleepMs || s.totals.feeds || s.totals.diapers)
  const avg = (f: (s: Report['stats'][number]) => number) => logged.reduce((a, s) => a + f(s), 0) / Math.max(1, logged.length)
  const th = { textAlign: 'left' as const, padding: '4px 6px', borderBottom: `1px solid ${LINE}`, color: INK2, fontWeight: 600 }
  const td = { padding: '4px 6px', borderBottom: `1px solid ${LINE}` }
  return (
    <div style={{ color: INK, fontFamily: 'var(--font-sans)', fontSize: 11.5, lineHeight: 1.45, background: '#fff' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800 }}>
        {childName}: {rangeText(report.from, report.to, tz)}
      </div>
      <div style={{ color: INK2, marginBottom: 10 }}>
        {birth ? `Born ${fmtLongDate(`${birth}T12:00:00`, tz)} (${ageText(birth)}). ` : ''}
        {report.days} days, {fmtLongDate(report.from, tz)} to {fmtLongDate(report.to, tz)}. Made with LAPdiary.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 12 }}>
        <Box label="Sleep a day" value={durationText(avg((s) => s.totals.sleepMs))} />
        <Box label="Feeds a day" value={avg((s) => s.totals.feeds).toFixed(1)} />
        <Box label="Wet nappies a day" value={avg((s) => s.totals.wet).toFixed(1)} />
        <Box label="Dirty nappies a day" value={avg((s) => s.totals.dirty).toFixed(1)} />
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5, marginBottom: 14 }}>
        <thead>
          <tr>
            <th style={th}>{report.weekly ? 'Each day, on average' : 'Day'}</th>
            <th style={th}>Sleep</th>
            <th style={th}>Naps</th>
            <th style={th}>Feeds</th>
            <th style={th}>Breast</th>
            <th style={th}>Bottle</th>
            <th style={th}>Solids</th>
            <th style={th}>Wet</th>
            <th style={th}>Dirty</th>
          </tr>
        </thead>
        <tbody>
          {report.stats.map((s) => (
            <tr key={s.day}>
              <td style={td}>{s.label}</td>
              <td style={td}>{durationText(s.totals.sleepMs)}</td>
              <td style={td}>{s.totals.naps}</td>
              <td style={td}>{s.totals.feeds}</td>
              <td style={td}>{s.leftMin + s.rightMin + s.otherMin ? `${s.leftMin + s.rightMin + s.otherMin} min` : '–'}</td>
              <td style={td}>{s.totals.bottleMl ? `${s.totals.bottleMl} ml` : '–'}</td>
              <td style={td}>{s.totals.solids || '–'}</td>
              <td style={td}>{s.totals.wet}</td>
              <td style={td}>{s.totals.dirty}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {report.care.length > 0 && (
        <>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Vitamins and care</div>
          <p style={{ color: INK2, marginBottom: 12 }}>{report.care.join(' · ')}</p>
        </>
      )}

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Medicines, temperatures and health notes</div>
      {report.health.length === 0 ? (
        <p style={{ color: INK2, marginBottom: 12 }}>Nothing logged in these days.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5, marginBottom: 12 }}>
          <tbody>
            {report.health.map((e) => (
              <tr key={e.id}>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  {fmtShortDate(e.started_at, tz)} {fmtTime(e.started_at, tz)}
                </td>
                <td style={td}>{eventTitle(e, null)}</td>
                <td style={td}>
                  {eventDetail(e, [], prefs, Date.now())}
                  {e.notes ? ` · ${e.notes}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {report.growth.length > 0 && (
        <>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Latest growth</div>
          {report.growth.map((g) => (
            <div key={g.id} style={{ color: INK2 }}>
              {fmtShortDate(g.started_at, tz)}:{' '}
              {[g.data.weight_kg && fmtWeight(g.data.weight_kg), g.data.length_cm && `length ${fmtLength(g.data.length_cm, prefs)}`, g.data.head_cm && `head ${fmtLength(g.data.head_cm, prefs)}`]
                .filter(Boolean)
                .join(', ')}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: '6px 8px' }}>
      <div style={{ color: INK2, fontSize: 9.5 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 15 }}>{value}</div>
    </div>
  )
}
