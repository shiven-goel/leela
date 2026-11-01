import clsx from 'clsx'
import { CloudSlash, DotsThreeOutline, Plus, X } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import { DayRing } from '../components/DayRing'
import { BottleIcon, DiaperIcon, TypeIcon } from '../components/Icon'
import { LogSheet } from '../components/LogSheet'
import { MoreSheet } from '../components/MoreSheet'
import { SleepSheet } from '../components/SleepSheet'
import { SweetSpotCard, SweetSpotSheet } from '../components/SweetSpot'
import { TimerCard } from '../components/TimerCard'
import { Timeline } from '../components/Timeline'
import { ChildSheet } from '../components/ChildSheet'
import { useNow } from '../hooks/useNow'
import { TYPES } from '../lib/config'
import { lastOf, sleepState, totalsFor } from '../lib/counting'
import { eventDetail, eventTitle } from '../lib/describe'
import { phase, sweetSpot } from '../lib/sweetspot'
import { activeChild, displayName, myPrefs, useLeela } from '../lib/store'
import { ageText, agoText, dayStart, durationText, fmtTime } from '../lib/time'
import type { EventType, LeelaEvent } from '../lib/types'
import { FEVER_C, fmtTemp } from '../lib/units'

export function TodayScreen() {
  const now = useNow(30_000)
  const family = useLeela((s) => s.family)!
  const eventsMap = useLeela((s) => s.events)
  const segments = useLeela((s) => s.segments)
  const children = useLeela((s) => s.children)
  const activeChildId = useLeela((s) => s.activeChildId)
  const userId = useLeela((s) => s.userId)
  const set = useLeela((s) => s.set)
  const child = activeChild()
  const tz = family.timezone

  const [sheet, setSheet] = useState<{ type: EventType; group?: EventType[]; edit?: LeelaEvent } | null>(null)
  const [more, setMore] = useState(false)
  const [addChild, setAddChild] = useState(false)
  const [sleepOpen, setSleepOpen] = useState(false)
  const [spotOpen, setSpotOpen] = useState(false)

  const events = useMemo(() => Object.values(eventsMap).filter((e) => !e.deleted_at), [eventsMap])
  const segs = useMemo(() => Object.values(segments), [segments])
  const spot = useMemo(() => (child ? sweetSpot(events, child, family, now) : null), [events, child, family, now])

  const running = events
    .filter((e) => e.timer_state && (e.child_id === child?.id || (TYPES[e.type].familyLevel && e.created_by === userId)))
    .sort((a, b) => a.started_at.localeCompare(b.started_at))

  if (!child || !spot) {
    return (
      <div className="px-5 pt-6">
        <div className="rounded-[28px] bg-card p-6 text-center shadow-lift">
          <h2 className="font-display text-[26px] font-bold">Add your baby</h2>
          <p className="mt-1 text-[16px] text-ink-2">Their name and birth date are all Leela needs to start.</p>
          <button type="button" onClick={() => setAddChild(true)} className="mt-5 h-14 w-full rounded-2xl bg-brand text-[17px] font-semibold text-brand-ink">
            Add baby
          </button>
        </div>
        <ChildSheet open={addChild} onClose={() => setAddChild(false)} />
      </div>
    )
  }

  const today0 = dayStart(now, tz).getTime()
  const todays = events
    .filter((e) => (e.child_id === child.id || (TYPES[e.type].familyLevel && e.created_by === userId)) && Date.parse(e.started_at) >= today0)
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
  const totals = totalsFor(events, segs, child.id, today0, now + 1, family, now)
  const state = sleepState(events, child.id, now)
  const lastFeed = lastOf(events, child.id, ['nursing', 'bottle', 'solids'])
  const lastDiaper = lastOf(events, child.id, ['diaper'])
  const lastTemp = lastOf(events, child.id, ['temperature'])
  const fever = lastTemp && (lastTemp.data.temp_c ?? 0) >= FEVER_C && now - Date.parse(lastTemp.started_at) < 12 * 3_600_000

  const runningSleep = running.find((e) => e.type === 'sleep')
  const next = spot.next
  const ringLine =
    state.asleep && state.since
      ? `since ${fmtTime(state.since, tz)}`
      : spot.status === 'ok' && next
        ? phase(next, now) === 'soon'
          ? `${next.kind === 'bedtime' ? 'Bedtime' : 'Next nap'} ~${fmtTime(next.center, tz)}`
          : phase(next, now) === 'now'
            ? 'In the sweet spot now'
            : 'A little past the sweet spot'
        : spot.status === 'newborn' && next
          ? `Sleepy again by ${fmtTime(next.end, tz)}`
          : state.since
            ? `since ${fmtTime(state.since, tz)}`
            : 'Log a sleep to begin'
  const ahead = spot.status === 'ok' || spot.status === 'napping' || spot.status === 'newborn' ? [...(next ? [next] : []), ...spot.later] : []

  const center = (
    <>
      <span className="text-[15px] font-semibold" style={{ color: state.asleep ? 'var(--sleep)' : 'var(--ink-2)' }}>
        {state.asleep ? 'Asleep' : state.since ? 'Awake' : child.name}
      </span>
      <span className="num text-[44px] font-extrabold leading-[0.9]">
        {state.since ? durationText(now - state.since) : '–'}
      </span>
      <span className="mt-1.5 max-w-[150px] text-[13px] leading-snug text-ink-2">{ringLine}</span>
    </>
  )

  const ringLabel = `Last 24 hours for ${child.name}: ${durationText(totals.sleepMs)} of sleep today, ${totals.feeds} feeds, ${totals.diapers} diapers.`

  const tiles: { id: string; label: string; sub: string; tone: string; icon: React.ReactNode; onClick: () => void; active?: boolean }[] = [
    {
      id: 'sleep',
      label: runningSleep ? 'Wake up' : 'Sleep',
      sub: runningSleep
        ? `Asleep ${durationText(now - Date.parse(runningSleep.started_at))}, tap to end`
        : state.since && !state.asleep
          ? `Woke ${agoText(state.since, now)}`
          : 'Start or add a sleep',
      tone: 'sleep',
      icon: <TypeIcon type="sleep" size={30} />,
      active: Boolean(runningSleep),
      // Opens the sleep screen; nothing starts or stops until its button is pressed.
      onClick: () => setSleepOpen(true),
    },
    {
      id: 'feed',
      label: 'Feed',
      sub: lastFeed ? agoText(lastFeed.started_at, now) : 'Breast, bottle or solids',
      tone: 'feed',
      icon: <BottleIcon size={30} />,
      onClick: () => setSheet({ type: lastFeed?.type === 'bottle' || lastFeed?.type === 'solids' ? lastFeed.type : 'nursing', group: ['nursing', 'bottle', 'solids'] }),
    },
    {
      id: 'diaper',
      label: 'Diaper',
      sub: lastDiaper ? agoText(lastDiaper.started_at, now) : 'Wet, dirty or both',
      tone: 'diaper',
      icon: <DiaperIcon size={30} />,
      onClick: () => setSheet({ type: 'diaper' }),
    },
    {
      id: 'more',
      label: 'More',
      sub: 'Health, play, firsts',
      tone: 'brand',
      icon: <DotsThreeOutline size={30} weight="fill" />,
      onClick: () => setMore(true),
    },
  ]

  return (
    <div className="mx-auto max-w-[560px] px-5 pb-32">
      <Header
        childName={child.name}
        sub={child.birth_date ? ageText(child.birth_date, now) : ''}
        kids={children.map((c) => ({ id: c.id, name: c.name }))}
        activeId={activeChildId ?? child.id}
        onPick={(id) => set({ activeChildId: id })}
        onAdd={() => setAddChild(true)}
      />

      <CatchUp events={events} now={now} />

      {fever && lastTemp && (
        <div className="mb-4 rounded-3xl bg-[var(--health-soft)] px-4 py-3 text-[15px]">
          <strong className="font-semibold">Fever logged: {fmtTemp(lastTemp.data.temp_c!, myPrefs())} at {fmtTime(lastTemp.started_at, tz)}.</strong>{' '}
          Check with your pediatrician, and call right away if your baby is under 3 months.
        </div>
      )}

      <DayRing events={events} childId={child.id} family={family} now={now} windows={ahead} center={center} label={ringLabel} />

      {running.length > 0 && (
        <div className="mt-2 flex flex-col gap-3">
          {running.map((e) => (
            <TimerCard key={e.id} event={e} onOpen={(ev) => (ev.type === 'sleep' ? setSleepOpen(true) : setSheet({ type: ev.type, edit: ev }))} />
          ))}
        </div>
      )}

      <SweetSpotCard spot={spot} child={child} now={now} tz={tz} onOpen={() => setSpotOpen(true)} onLogSleep={() => setSheet({ type: 'sleep' })} />

      <div className="mt-4 grid grid-cols-2 gap-3">
        {tiles.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={t.onClick}
            className={clsx('flex min-h-[96px] items-start gap-3 rounded-[26px] p-4 text-left active:scale-[0.98]', t.active && 'ring-2')}
            style={{
              background: t.tone === 'brand' ? 'var(--card)' : `var(--${t.tone}-soft)`,
              ...(t.active ? { ['--tw-ring-color' as string]: `var(--${t.tone})` } : {}),
            }}
          >
            <span className="mt-0.5 shrink-0" style={{ color: t.tone === 'brand' ? 'var(--ink-2)' : `var(--${t.tone})` }}>
              {t.icon}
            </span>
            <span className="min-w-0">
              <span className="block font-display text-[21px] font-bold leading-tight">{t.label}</span>
              <span className="block text-[13px] leading-snug text-ink-2">{t.sub}</span>
            </span>
          </button>
        ))}
      </div>

      <section className="mt-7" aria-labelledby="today-h">
        <div className="mb-3 flex items-end justify-between">
          <h2 id="today-h" className="font-display text-[24px] font-bold">
            Today
          </h2>
          <button type="button" onClick={() => setMore(true)} className="flex items-center gap-1 text-[15px] font-semibold text-brand">
            <Plus size={18} weight="bold" aria-hidden="true" /> Add
          </button>
        </div>
        <dl className="mb-4 grid grid-cols-3 gap-2">
          <Stat label="Sleep" value={durationText(totals.sleepMs)} tone="sleep" detail={`${totals.naps} ${totals.naps === 1 ? 'nap' : 'naps'}`} />
          <Stat
            label="Feeds"
            value={String(totals.feeds)}
            tone="feed"
            detail={totals.bottleMl ? `${totals.bottleMl} ml bottle` : `${Math.round((totals.nursingLeftS + totals.nursingRightS + totals.nursingOtherS) / 60)} min breast`}
          />
          <Stat label="Diapers" value={String(totals.diapers)} tone="diaper" detail={`${totals.wet} wet, ${totals.dirty} dirty`} />
        </dl>
        <Timeline
          events={todays}
          now={now}
          onSelect={(e) => (e.type === 'note' ? useLeela.getState().set({ overlay: { kind: 'note', id: e.id } }) : setSheet({ type: e.type, edit: e }))}
          empty={`Nothing logged for ${child.name} today yet. Use the buttons above.`}
        />
      </section>

      <MoreSheet
        open={more}
        onClose={() => setMore(false)}
        onPick={(t) => {
          setMore(false)
          if (t === 'note') useLeela.getState().set({ overlay: { kind: 'note' } })
          else if (t === 'sleep' || t === 'nursing' || t === 'bottle' || t === 'solids') setSheet({ type: t, group: t === 'sleep' ? undefined : ['nursing', 'bottle', 'solids'] })
          else setSheet({ type: t })
        }}
      />
      <SleepSheet
        open={sleepOpen}
        onClose={() => setSleepOpen(false)}
        child={child}
        running={runningSleep}
        spot={spot}
        onPastSleep={() => {
          setSleepOpen(false)
          setSheet({ type: 'sleep' })
        }}
        onEdit={(e) => {
          setSleepOpen(false)
          setSheet({ type: 'sleep', edit: e })
        }}
      />
      <SweetSpotSheet open={spotOpen} onClose={() => setSpotOpen(false)} spot={spot} child={child} now={now} tz={tz} />
      {sheet && (
        <LogSheet
          key={sheet.edit?.id ?? sheet.type}
          open
          onClose={() => setSheet(null)}
          type={sheet.type}
          group={sheet.group}
          edit={sheet.edit}
        />
      )}
      <ChildSheet open={addChild} onClose={() => setAddChild(false)} />
    </div>
  )
}

function Stat({ label, value, tone, detail }: { label: string; value: string; tone: string; detail: string }) {
  return (
    <div className="rounded-2xl bg-card px-3 py-2.5">
      <dt className="truncate text-[13px] font-semibold" style={{ color: `var(--${tone})` }}>
        {label}
      </dt>
      <dd>
        <span className="num block text-[24px] font-bold leading-tight">{value}</span>
        <span className="block truncate text-[12px] text-ink-2">{detail}</span>
      </dd>
    </div>
  )
}

function Header({
  childName,
  sub,
  kids,
  activeId,
  onPick,
  onAdd,
}: {
  childName: string
  sub: string
  kids: { id: string; name: string }[]
  activeId: string
  onPick: (id: string) => void
  onAdd: () => void
}) {
  const online = useLeela((s) => s.online)
  const pendingCount = useLeela((s) => s.pendingCount)
  return (
    <header className="safe-top flex items-start justify-between gap-3 pb-2">
      <div className="min-w-0">
        {kids.length > 1 ? (
          <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {kids.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => onPick(k.id)}
                aria-pressed={k.id === activeId}
                className={clsx('h-10 shrink-0 rounded-full px-4 font-display text-[18px] font-bold', k.id === activeId ? 'bg-brand text-brand-ink' : 'bg-card text-ink-2')}
              >
                {k.name}
              </button>
            ))}
            <button type="button" onClick={onAdd} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-card text-ink-2" aria-label="Add a baby">
              <Plus size={18} weight="bold" />
            </button>
          </div>
        ) : (
          <h1 className="truncate font-display text-[30px] font-extrabold leading-tight">{childName}</h1>
        )}
        {sub && <p className="text-[15px] text-ink-2">{sub}</p>}
      </div>
      {(!online || pendingCount > 0) && (
        <span className="mt-2 flex shrink-0 items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-[13px] font-semibold text-ink-2" role="status">
          <CloudSlash size={16} weight="bold" aria-hidden="true" />
          {!online ? (pendingCount ? `Offline, ${pendingCount} waiting` : 'Offline') : `Sending ${pendingCount}`}
        </span>
      )}
    </header>
  )
}

function CatchUp({ events, now }: { events: LeelaEvent[]; now: number }) {
  const since = useLeela((s) => s.catchUpSince)
  const dismissed = useLeela((s) => s.catchUpDismissed)
  const userId = useLeela((s) => s.userId)
  const family = useLeela((s) => s.family)
  const segments = useLeela((s) => s.segments)
  const set = useLeela((s) => s.set)
  useLeela((s) => s.profiles)
  if (!since || dismissed || !family) return null
  const sinceMs = Date.parse(since)
  if (now - sinceMs < 2 * 3_600_000) return null
  const items = events
    .filter((e) => e.created_by !== userId && Date.parse(e.created_at) > sinceMs)
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
  if (!items.length) return null
  const segs = Object.values(segments)
  const names = [...new Set(items.map((e) => displayName(e.created_by)))]
  return (
    <section className="mb-4 rounded-[26px] bg-card p-4 shadow-lift" aria-labelledby="catchup-h">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h2 id="catchup-h" className="font-display text-[19px] font-bold leading-tight">
          While you were away
          <span className="block font-sans text-[14px] font-normal text-ink-2">
            {names.join(' and ')} logged {items.length} {items.length === 1 ? 'thing' : 'things'} since {fmtTime(sinceMs, family.timezone)}
          </span>
        </h2>
        <button type="button" onClick={() => set({ catchUpDismissed: true })} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-card-2" aria-label="Dismiss">
          <X size={16} weight="bold" />
        </button>
      </div>
      <ul className="space-y-1.5">
        {items.slice(0, 4).map((e) => (
          <li key={e.id} className="flex gap-2 text-[15px]">
            <span className="num w-[62px] shrink-0 font-semibold text-ink-2">{fmtTime(e.started_at, family.timezone)}</span>
            <span className="min-w-0 truncate">
              {eventTitle(e, family)}
              {(() => {
                const d = eventDetail(e, segs, myPrefs(), now)
                return d ? `, ${d}` : ''
              })()}
            </span>
          </li>
        ))}
        {items.length > 4 && <li className="text-[14px] text-ink-2">and {items.length - 4} more below</li>}
      </ul>
    </section>
  )
}
