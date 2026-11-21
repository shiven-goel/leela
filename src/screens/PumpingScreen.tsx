import clsx from 'clsx'
import { Lightbulb, Sparkle, Warning } from '@phosphor-icons/react'
import { useEffect, useMemo } from 'react'
import { Overlay } from '../components/Overlay'
import { BarChart } from '../components/charts/BarChart'
import { Panel, StatGrid } from '../components/history/bits'
import { pumpDue, type PumpDue } from '../lib/alerts'
import { expectedMl, pumpingCoach, type Tip } from '../lib/pumping'
import { useLeela } from '../lib/store'
import { loadAllHistory } from '../lib/sync'
import { dayStart, durationText, fmtTime } from '../lib/time'

/** The pumping coach: what's next, how supply is going and what would help. */
export function PumpingScreen({ open, onClose }: { open: boolean; onClose: () => void }) {
  const family = useLeela((s) => s.family)!
  const eventsMap = useLeela((s) => s.events)
  const tz = family.timezone
  useEffect(() => {
    if (open) void loadAllHistory()
  }, [open])
  const now = Date.now()
  const events = useMemo(() => (open ? Object.values(eventsMap).filter((e) => !e.deleted_at && (e.type === 'pump' || e.type === 'nursing')) : []), [open, eventsMap])
  const coach = useMemo(() => (open ? pumpingCoach(events as never, now, tz, (t) => dayStart(t, tz).getTime()) : null), [open, events, tz]) // eslint-disable-line react-hooks/exhaustive-deps
  const next = open ? pumpDue(events as never, now, tz) : null

  return (
    <Overlay open={open} onClose={onClose} title="Pumping coach">
      {next && <NextCard next={next} events={events} tz={tz} now={now} />}
      {!coach ? (
        <p className="rounded-3xl bg-card-2 px-5 py-6 text-center text-[15px] text-ink-2">Log a few pumpings with how many ml each side gave, and the coach starts learning your rhythm and yield.</p>
      ) : (
        <>
          <div className="mb-4 px-1">
            <p className="text-[14px] font-semibold text-ink-2">Last 7 days</p>
            <p className="flex items-baseline gap-2">
              <span className="num font-display text-[34px] font-extrabold leading-none">{coach.mlDay} ml</span>
              <span className="text-[16px] text-ink-2">a day</span>
              {coach.trend !== null && (
                <span className={clsx('num rounded-full px-2 py-0.5 text-[13px] font-semibold', coach.trend >= 0 ? 'bg-[var(--growth-soft)] text-[var(--growth)]' : 'bg-[var(--feed-soft)] text-[var(--feed)]')}>
                  {coach.trend >= 0 ? '+' : '−'}
                  {Math.round(Math.abs(coach.trend) * 100)}%
                </span>
              )}
            </p>
            {coach.mlDayBefore !== null && <p className="mt-1 text-[14px] text-ink-2">The week before: {coach.mlDayBefore} ml a day</p>}
          </div>

          {coach.tips.length > 0 && (
            <section className="mb-4 space-y-2" aria-label="Suggestions">
              {coach.tips.map((t) => (
                <TipCard key={t.title} t={t} />
              ))}
            </section>
          )}

          <div className="mb-4">
            <StatGrid
              stats={[
                { label: 'Pumpings a day', value: (Math.round(coach.sessionsDay * 10) / 10).toString() },
                { label: 'One side, usually', value: `${coach.perSide} ml` },
                ...(coach.minutesPerSide ? [{ label: 'Minutes a side', value: String(coach.minutesPerSide) }] : []),
                ...(coach.emptyingsDay ? [{ label: 'Emptyings a day', value: String(Math.round(coach.emptyingsDay * 10) / 10) }] : []),
                ...(coach.longestGapH ? [{ label: 'Longest stretch', value: durationText(coach.longestGapH * 3_600_000) }] : []),
                ...(coach.sides.leftN && coach.sides.rightN ? [{ label: 'Left / right', value: `${coach.sides.left} / ${coach.sides.right} ml` }] : []),
              ]}
            />
            <p className="mt-2 px-1 text-[13px] text-ink-3">Emptyings count breastfeeds and pumpings, a feed and a pump close together as one.</p>
          </div>

          <Panel title="Each day, last two weeks">
            <BarChart
              label="Millilitres pumped each day"
              days={coach.daily.map((d) => d.day)}
              tz={tz}
              average
              format={(v) => `${Math.round(v)}`}
              series={[{ key: 'ml', label: 'Pumped', color: 'var(--pump)', values: coach.daily.map((d) => d.ml) }]}
            />
          </Panel>

          {coach.blocks.length > 1 && (
            <Panel title="One side, by time of day">
              <ul className="space-y-1.5">
                {coach.blocks.map((b) => {
                  const max = Math.max(...coach.blocks.map((x) => x.ml), 1)
                  const best = coach.best?.hour === b.hour
                  return (
                    <li key={b.hour} className="flex items-center gap-3 text-[14px]">
                      <span className="w-[86px] shrink-0 text-ink-2">{b.label}</span>
                      <span className="h-3 flex-1 overflow-hidden rounded-full bg-card-2">
                        <span className="block h-full rounded-full" style={{ width: `${(b.ml / max) * 100}%`, background: 'var(--pump)', opacity: best ? 1 : 0.55 }} />
                      </span>
                      <span className={clsx('num w-[58px] shrink-0 text-right', best && 'font-bold')}>{b.ml} ml</span>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-2 text-[13px] text-ink-3">Typical from one side, last two weeks.</p>
            </Panel>
          )}

          {coach.accuracy && (
            <p className="mb-4 rounded-2xl bg-card-2 px-4 py-3 text-[14px] leading-snug text-ink-2">
              How well “time to pump” has done: over the last two weeks, {coach.accuracy.within30} of {coach.accuracy.checked} feeds and pumpings started within half an hour of it, and it was typically {durationText(coach.accuracy.missMin * 60_000)} out. It learns from every entry.
            </p>
          )}
        </>
      )}
      <p className="px-1 text-[13px] leading-snug text-ink-3">General breastfeeding guidance, not medical advice. A lactation consultant or your doctor can tailor it to you.</p>
    </Overlay>
  )
}

function NextCard({ next, events, tz, now }: { next: PumpDue; events: unknown[]; tz: string; now: number }) {
  const row = (x: Omit<PumpDue, 'other'>, named: boolean) => {
    const ml = expectedMl(events as never, x.side, x.dueAt, tz, now)
    const when = x.dueAt <= now ? (x.dueAt < now - 10 * 60_000 ? `due since ${fmtTime(x.dueAt, tz)}` : 'due now') : `about ${fmtTime(x.dueAt, tz)}`
    return (
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-[17px] font-bold">
            {named ? `${x.side === 'left' ? 'Left' : 'Right'} side` : 'Next'}, {when}
          </span>
          <span className="block text-[13px] text-ink-2">
            Last emptied {fmtTime(x.lastAt, tz)} by {x.lastKind === 'pump' ? 'pumping' : 'a feed'}
            {x.basis === 'logs' ? `, usually ${durationText(x.everyMin * 60_000)} between around then` : ''}
          </span>
        </span>
        {ml !== null && <span className="num shrink-0 text-[15px] font-semibold">~{ml} ml</span>}
      </div>
    )
  }
  return (
    <section className="mb-4 space-y-3 rounded-[26px] bg-[var(--pump-soft)] p-4" aria-label="Next pumping">
      <p className="text-[13px] font-bold tracking-wide text-[var(--pump)] uppercase">Time to pump</p>
      {row(next, Boolean(next.other))}
      {next.other && row(next.other, true)}
    </section>
  )
}

function TipCard({ t }: { t: Tip }) {
  const Icon = t.kind === 'good' ? Sparkle : t.kind === 'watch' ? Warning : Lightbulb
  const tone = t.kind === 'good' ? 'growth' : t.kind === 'watch' ? 'feed' : 'pump'
  return (
    <div className="flex gap-3 rounded-2xl bg-card px-4 py-3">
      <Icon size={22} weight="duotone" className="mt-0.5 shrink-0" style={{ color: `var(--${tone})` }} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[16px] font-semibold leading-snug">{t.title}</p>
        <p className="mt-0.5 text-[14px] leading-snug text-ink-2">{t.text}</p>
      </div>
    </div>
  )
}
