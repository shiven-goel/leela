import clsx from 'clsx'
import { CalendarBlank, Plus } from '@phosphor-icons/react'
import { useMemo, useRef, useState } from 'react'
import { LogSheet } from '../components/LogSheet'
import { MoreSheet } from '../components/MoreSheet'
import { Timeline } from '../components/Timeline'
import { useNow } from '../hooks/useNow'
import { TYPES } from '../lib/config'
import { totalsFor } from '../lib/counting'
import { activeChild, useLeela } from '../lib/store'
import { addDaysTz, atLocalTime, dayKey, dayLabel, dayStart, durationText, fmtLongDate } from '../lib/time'
import type { EventType, LeelaEvent } from '../lib/types'
import { TZDate } from '@date-fns/tz'

export function HistoryScreen() {
  const now = useNow(60_000)
  const family = useLeela((s) => s.family)!
  const eventsMap = useLeela((s) => s.events)
  const segments = useLeela((s) => s.segments)
  const userId = useLeela((s) => s.userId)
  const child = activeChild()
  const tz = family.timezone
  const [day, setDay] = useState(() => dayStart(Date.now(), tz).getTime())
  const [more, setMore] = useState(false)
  const [sheet, setSheet] = useState<{ type: EventType; edit?: LeelaEvent; group?: EventType[] } | null>(null)
  const picker = useRef<HTMLInputElement>(null)

  const events = useMemo(() => Object.values(eventsMap).filter((e) => !e.deleted_at), [eventsMap])
  const days = useMemo(() => {
    const out: number[] = []
    const today = dayStart(now, tz).getTime()
    for (let i = 0; i < 30; i++) out.push(addDaysTz(today, -i, tz).getTime())
    return out
  }, [now, tz])

  if (!child) return <p className="px-5 pt-10 text-center text-ink-2">Add your baby first, from the Today tab.</p>

  const dayEnd = addDaysTz(day, 1, tz).getTime()
  const totals = totalsFor(events, Object.values(segments), child.id, day, dayEnd, family, now)
  const list = events
    .filter(
      (e) =>
        (e.child_id === child.id || (TYPES[e.type].familyLevel && e.created_by === userId)) &&
        ((Date.parse(e.started_at) >= day && Date.parse(e.started_at) < dayEnd) ||
          // A night sleep that started the evening before still shows on the morning it ended.
          (e.type === 'sleep' && Date.parse(e.started_at) < day && (e.ended_at ? Date.parse(e.ended_at) : now) > day)),
    )
    .sort((a, b) => b.started_at.localeCompare(a.started_at))

  const isToday = dayKey(day, tz) === dayKey(now, tz)
  const defaultAt = isToday ? Date.now() : atLocalTime(day, '12:00', tz).getTime()
  const label = dayLabel(day, tz, now)
  const nursingMin = Math.round((totals.nursingLeftS + totals.nursingRightS) / 60)

  return (
    <div className="mx-auto max-w-[560px] px-5 pb-32">
      <header className="safe-top pb-3">
        <h1 className="font-display text-[30px] font-extrabold leading-tight">History</h1>
        <p className="text-[15px] text-ink-2">{child.name}, day by day. Tap any day to add something you forgot.</p>
      </header>

      <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-2" role="tablist" aria-label="Choose a day">
        {days.map((d) => {
          const on = d === day
          const date = new TZDate(d, tz)
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setDay(d)}
              className={clsx('flex h-[68px] w-[54px] shrink-0 flex-col items-center justify-center rounded-2xl', on ? 'bg-brand text-brand-ink' : 'bg-card')}
            >
              <span className="text-[12px] font-semibold opacity-80">{date.toLocaleDateString('en', { weekday: 'short', timeZone: tz })}</span>
              <span className="num text-[22px] font-bold leading-none">{date.getDate()}</span>
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => picker.current?.showPicker?.() ?? picker.current?.click()}
          className="flex h-[68px] w-[54px] shrink-0 flex-col items-center justify-center gap-1 rounded-2xl bg-card text-ink-2"
          aria-label="Pick an earlier day"
        >
          <CalendarBlank size={22} weight="bold" />
          <span className="text-[11px] font-semibold">Earlier</span>
        </button>
        <input
          ref={picker}
          type="date"
          className="sr-only"
          min={child.birth_date ?? undefined}
          max={dayKey(now, tz)}
          onChange={(e) => {
            if (!e.target.value) return
            const [y, m, d] = e.target.value.split('-').map(Number)
            setDay(new TZDate(y, m - 1, d, tz).getTime())
          }}
          aria-label="Pick a day"
        />
      </div>

      <section className="mt-3" aria-labelledby="day-h">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 id="day-h" className="font-display text-[22px] font-bold leading-tight">
            {label}
            {label !== fmtLongDate(day, tz) && <span className="block font-sans text-[14px] font-normal text-ink-2">{fmtLongDate(day, tz)}</span>}
          </h2>
          <button type="button" onClick={() => setMore(true)} className="flex h-11 shrink-0 items-center gap-1.5 rounded-2xl bg-brand px-4 text-[15px] font-semibold text-brand-ink">
            <Plus size={18} weight="bold" aria-hidden="true" /> Add to this day
          </button>
        </div>

        <dl className="mb-5 grid grid-cols-2 gap-2">
          <Summary tone="sleep" label="Sleep" value={durationText(totals.sleepMs)} sub={`${totals.naps} ${totals.naps === 1 ? 'nap' : 'naps'}, longest ${durationText(totals.longestSleepMs)}`} />
          <Summary
            tone="feed"
            label="Feeds"
            value={String(totals.feeds)}
            sub={[totals.bottleMl ? `${totals.bottleMl} ml bottles` : '', nursingMin ? `${nursingMin} min breastfeeding` : ''].filter(Boolean).join(', ') || 'None logged'}
          />
          <Summary tone="diaper" label="Diapers" value={String(totals.diapers)} sub={`${totals.wet} wet, ${totals.dirty} dirty`} />
          <Summary tone="feed" label="Solids" value={String(totals.solids)} sub={totals.pumpMl ? `${totals.pumpMl} ml pumped` : 'meals'} />
        </dl>

        <Timeline events={list} now={now} onSelect={(e) => setSheet({ type: e.type, edit: e })} empty={`Nothing logged for ${label.toLowerCase()}. Forgot something? Add it here.`} />
      </section>

      <MoreSheet
        open={more}
        onClose={() => setMore(false)}
        dayLabel={label.toLowerCase() === 'today' ? 'today' : label}
        onPick={(t) => {
          setMore(false)
          setSheet({ type: t, group: ['nursing', 'bottle', 'solids'].includes(t) ? ['nursing', 'bottle', 'solids'] : undefined })
        }}
      />
      {sheet && (
        <LogSheet key={sheet.edit?.id ?? `${sheet.type}-${day}`} open onClose={() => setSheet(null)} type={sheet.type} edit={sheet.edit} group={sheet.group} defaultAt={sheet.edit ? undefined : defaultAt} />
      )}
    </div>
  )
}

function Summary({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="rounded-3xl bg-card px-4 py-3">
      <dt className="text-[14px] font-semibold" style={{ color: `var(--${tone})` }}>
        {label}
      </dt>
      <dd>
        <span className="num block text-[28px] font-bold leading-tight">{value}</span>
        <span className="block truncate text-[13px] text-ink-2">{sub}</span>
      </dd>
    </div>
  )
}
