import clsx from 'clsx'
import { Trash, Warning } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { deleteEvent, editEvent, logEvent, runningTimer, startTimer } from '../lib/actions'
import {
  ACTIVITY_KINDS,
  COMMON_ALLERGENS,
  MILESTONE_KINDS,
  SLEEP_PLACES,
  SYMPTOM_TAGS,
  TEMP_METHODS,
  TYPES,
} from '../lib/config'
import { eventTitle } from '../lib/describe'
import { activeChild, myPrefs, useLeela } from '../lib/store'
import { durationText, fmtTime } from '../lib/time'
import type { EventData, EventType, LeelaEvent } from '../lib/types'
import { CM_PER_IN, FEVER_C, cToF, fToC, lengthUnit, tempUnit } from '../lib/units'
import { PhotoPicker } from './PhotoPicker'
import { Sheet } from './Sheet'
import { Button, Choices, Field, MultiChips, Stepper, TextArea, TextInput, Toggle } from './ui'
import { WhenPicker } from './WhenPicker'

const MIN = 60_000

interface Draft {
  start: Date
  end: Date | null
  ongoing: boolean
  data: EventData
  notes: string
  photos: string[]
  durationMin?: number
  leftMin?: number
  rightMin?: number
}

function draftFrom(edit: LeelaEvent | undefined, type: EventType, defaultAt: number | undefined, last: LeelaEvent | undefined): Draft {
  if (edit) {
    const dur = edit.ended_at ? Math.round((Date.parse(edit.ended_at) - Date.parse(edit.started_at)) / MIN) : undefined
    return {
      start: new Date(edit.started_at),
      end: edit.ended_at ? new Date(edit.ended_at) : null,
      ongoing: Boolean(edit.timer_state),
      data: { ...edit.data },
      notes: edit.notes ?? '',
      photos: [...edit.photo_paths],
      durationMin: dur,
      leftMin: edit.data.left_s !== undefined ? Math.round(edit.data.left_s / 60) : undefined,
      rightMin: edit.data.right_s !== undefined ? Math.round(edit.data.right_s / 60) : undefined,
    }
  }
  const at = defaultAt ?? Date.now()
  const data: EventData = {}
  if (type === 'bottle') {
    data.amount_ml = last?.data.amount_ml ?? 90
    data.contents = last?.data.contents ?? 'formula'
  }
  if (type === 'diaper') data.kind = undefined
  if (type === 'temperature') data.temp_c = last?.data.temp_c ?? 36.8
  if (type === 'growth' && last) {
    data.weight_kg = last.data.weight_kg
    data.length_cm = last.data.length_cm
    data.head_cm = last.data.head_cm
  }
  if (type === 'potty') data.outcome = 'potty'
  if (type === 'symptom') data.kind = 'symptom'
  return {
    start: new Date(type === 'sleep' ? at - 60 * MIN : at),
    end: type === 'sleep' ? new Date(at) : null,
    ongoing: false,
    data,
    notes: '',
    photos: [],
  }
}

export function LogSheet({
  open,
  onClose,
  type: initialType,
  group,
  edit,
  defaultAt,
}: {
  open: boolean
  onClose: () => void
  type: EventType
  group?: EventType[]
  edit?: LeelaEvent
  defaultAt?: number
}) {
  const [type, setType] = useState<EventType>(edit?.type ?? initialType)
  const family = useLeela((s) => s.family)
  const events = useLeela((s) => s.events)
  const child = activeChild()
  const prefs = myPrefs()
  const tz = family?.timezone ?? 'UTC'

  const last = useMemo(() => {
    let best: LeelaEvent | undefined
    for (const e of Object.values(events)) {
      if (e.deleted_at || e.type !== type || (child && e.child_id && e.child_id !== child.id)) continue
      if (!best || e.started_at > best.started_at) best = e
    }
    return best
  }, [events, type, child])

  const [draft, setDraft] = useState<Draft>(() => draftFrom(edit, type, defaultAt, last))
  const [details, setDetails] = useState(Boolean(edit))
  const [foodInput, setFoodInput] = useState('')

  useEffect(() => {
    if (open) {
      setType(edit?.type ?? initialType)
      setDetails(Boolean(edit))
    }
  }, [open, edit, initialType])

  useEffect(() => {
    if (open) setDraft(draftFrom(edit, type, defaultAt, last))
    // Only reset when the sheet opens or the type changes, not on every data update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, type, edit?.id])

  if (!family) return null
  const meta = TYPES[type]
  const tone = meta.tone
  const childId = child?.id ?? null
  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))
  const setData = (p: EventData) => setDraft((d) => ({ ...d, data: { ...d.data, ...p } }))
  const minDate = child?.birth_date ?? null

  // ---------------------------------------------------------------- warnings
  const warnings: string[] = []
  const startMs = draft.start.getTime()
  const endMs = draft.end?.getTime()
  if (startMs > Date.now() + 5 * MIN) warnings.push('This is set in the future.')
  if (type === 'bottle' && (draft.data.amount_ml ?? 0) > 350) warnings.push('That’s a big bottle. Double-check the amount.')
  if (type === 'sleep' && endMs && endMs - startMs > 14 * 60 * MIN) warnings.push('That’s a sleep of over 14 hours.')
  if (type === 'sleep' && childId) {
    const s0 = startMs
    const s1 = draft.ongoing ? Date.now() : endMs ?? startMs
    const clash = Object.values(events).find(
      (e) =>
        e.type === 'sleep' &&
        !e.deleted_at &&
        e.child_id === childId &&
        e.id !== edit?.id &&
        Date.parse(e.started_at) < s1 &&
        (e.ended_at ? Date.parse(e.ended_at) : Date.now()) > s0,
    )
    if (clash) {
      warnings.push(
        `Overlaps a ${eventTitle(clash, family).toLowerCase()} from ${fmtTime(clash.started_at, tz)}${clash.ended_at ? ` to ${fmtTime(clash.ended_at, tz)}` : ''}.`,
      )
    }
  }
  const blocking = Boolean(endMs !== undefined && endMs < startMs)

  // ---------------------------------------------------------------- save
  const close = () => onClose()

  const save = async () => {
    if (blocking) return
    let data: EventData = { ...draft.data }
    let ended: string | null = draft.end ? draft.end.toISOString() : null
    if (type === 'nursing') {
      data = { ...data, left_s: Math.round((draft.leftMin ?? 0) * 60), right_s: Math.round((draft.rightMin ?? 0) * 60) }
      const total = ((draft.leftMin ?? 0) + (draft.rightMin ?? 0)) * MIN
      ended = new Date(startMs + total).toISOString()
    }
    if ((type === 'activity' || type === 'pump') && draft.durationMin) {
      ended = new Date(startMs + draft.durationMin * MIN).toISOString()
    }
    if (type === 'solids' && foodInput.trim()) {
      data.foods = [...(data.foods ?? []), { name: foodInput.trim() }]
    }
    const notes = draft.notes.trim() ? draft.notes.trim() : null

    if (edit) {
      await editEvent(edit.id, {
        started_at: draft.start.toISOString(),
        ended_at: edit.timer_state ? null : ended,
        data,
        notes,
        photo_paths: draft.photos,
      })
      useLeela.getState().toast({ text: 'Changes saved.' })
    } else if (type === 'sleep' && draft.ongoing) {
      await startTimer('sleep', childId, { startedAt: draft.start.toISOString(), data })
    } else {
      await logEvent({ type, childId, startedAt: draft.start.toISOString(), endedAt: ended, data, notes, photoPaths: draft.photos })
    }
    close()
  }

  const startNow = async (extra?: { side?: 'left' | 'right' }) => {
    await startTimer(type, childId, { side: extra?.side, data: draft.data, startedAt: draft.start.getTime() < Date.now() - MIN ? draft.start.toISOString() : undefined })
    close()
  }

  const remove = async () => {
    if (!edit) return
    await deleteEvent(edit.id)
    close()
  }

  // ---------------------------------------------------------------- quick diaper path
  const quickDiaper = async (kind: string) => {
    if (details || edit) {
      setData({ kind })
      return
    }
    await logEvent({ type: 'diaper', childId, startedAt: draft.start.toISOString(), data: { kind } })
    close()
  }

  const running = !edit && meta.timer ? runningTimer(type, childId) : undefined
  const title = edit ? `Edit ${eventTitle(edit, family).toLowerCase()}` : group ? 'Log a feed' : meta.label

  const lenUnit = lengthUnit(prefs)
  const tUnit = tempUnit(prefs)
  const toLen = (cm?: number) => (cm === undefined ? undefined : lenUnit === 'in' ? Number((cm / CM_PER_IN).toFixed(1)) : cm)
  const fromLen = (v?: number) => (v === undefined ? undefined : lenUnit === 'in' ? Number((v * CM_PER_IN).toFixed(1)) : v)
  const tempShown = draft.data.temp_c === undefined ? undefined : tUnit === 'f' ? Number(cToF(draft.data.temp_c).toFixed(1)) : draft.data.temp_c
  const fever = type === 'temperature' && (draft.data.temp_c ?? 0) >= FEVER_C

  const showSave = !(type === 'diaper' && !details && !edit) && type !== 'contraction'
  const footer = (
    <div className="flex flex-col gap-2">
      {warnings.length > 0 && (
        <div className="flex items-start gap-2 rounded-2xl bg-[var(--feed-soft)] px-3 py-2 text-[14px]">
          <Warning size={18} weight="fill" className="mt-0.5 shrink-0 text-[var(--feed)]" aria-hidden="true" />
          <span>{warnings.join(' ')}</span>
        </div>
      )}
      {blocking && <p className="text-[14px] font-semibold text-[var(--health)]">The end can’t be before the start.</p>}
      <div className="flex gap-2">
        {edit && (
          <Button variant="danger" onClick={() => void remove()} aria-label="Delete entry" className="w-14 px-0">
            <Trash size={22} weight="bold" />
          </Button>
        )}
        {showSave && (
          <Button tone={tone} className="flex-1" onClick={() => void save()} disabled={blocking}>
            {edit ? 'Save changes' : type === 'sleep' && draft.ongoing ? 'Start sleep' : warnings.length ? 'Save anyway' : meta.action}
          </Button>
        )}
      </div>
    </div>
  )

  return (
    <Sheet open={open} onClose={close} title={title} tone={tone} footer={showSave || edit ? footer : undefined}>
      {group && !edit && (
        <div className="mb-5 grid grid-cols-3 gap-1 rounded-2xl bg-card-2 p-1 ring-1 ring-line" role="tablist">
          {group.map((g) => (
            <button
              key={g}
              type="button"
              role="tab"
              aria-selected={type === g}
              onClick={() => setType(g)}
              className={clsx('h-11 rounded-xl text-[15px] font-semibold', type === g ? 'bg-card shadow-lift' : 'text-ink-2')}
            >
              {g === 'nursing' ? 'Breast' : TYPES[g].label}
            </button>
          ))}
        </div>
      )}

      {running && (
        <p className="mb-4 rounded-2xl bg-card-2 px-4 py-3 text-[15px]">
          A {meta.label.toLowerCase()} timer is already running. Stop it from the home screen, or log a past one below.
        </p>
      )}

      {/* ------------------------------------------------------------ SLEEP */}
      {type === 'sleep' && (
        <>
          <WhenPicker label="Fell asleep" value={draft.start} onChange={(d) => set({ start: d })} timeZone={tz} minDate={minDate} />
          {!edit?.timer_state && (
            <>
              {!edit && (
                <Toggle
                  label="Still asleep"
                  checked={draft.ongoing}
                  onChange={(v) => set({ ongoing: v, end: v ? null : new Date(Math.min(Date.now(), startMs + 60 * MIN)) })}
                  tone="sleep"
                />
              )}
              {!draft.ongoing && (
                <div className="mt-5">
                  <WhenPicker
                    label="Woke up"
                    value={draft.end ?? new Date(Math.min(Date.now(), startMs + 60 * MIN))}
                    onChange={(d) => set({ end: d })}
                    timeZone={tz}
                    minDate={minDate}
                  />
                  {draft.end && draft.end.getTime() >= startMs && (
                    <p className="-mt-3 mb-5 text-[15px] text-ink-2">Slept {durationText(draft.end.getTime() - startMs)}</p>
                  )}
                </div>
              )}
            </>
          )}
          <Field label="Where">
            <Choices options={SLEEP_PLACES} value={draft.data.place} onChange={(v) => setData({ place: v })} tone="sleep" columns={2} allowNone />
          </Field>
          <Field label="Count it as">
            <Choices
              options={[
                { id: 'auto', label: 'Automatic' },
                { id: 'nap', label: 'Nap' },
                { id: 'night', label: 'Night' },
              ]}
              value={(draft.data.kind as string) ?? 'auto'}
              onChange={(v) => setData({ kind: v === 'auto' ? undefined : v })}
              tone="sleep"
            />
          </Field>
        </>
      )}

      {/* ------------------------------------------------------------ NURSING */}
      {type === 'nursing' && (
        <>
          {!edit && !running && (
            <div className="mb-5">
              <div className="mb-2 text-[15px] font-semibold text-ink-2">
                Start a timer{last?.data.last_side ? `, last feed ended on the ${last.data.last_side}` : ''}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(['left', 'right'] as const).map((side) => {
                  const suggested = last?.data.last_side ? last.data.last_side !== side : side === 'left'
                  return (
                    <button
                      key={side}
                      type="button"
                      onClick={() => void startNow({ side })}
                      className={clsx(
                        'flex h-20 flex-col items-center justify-center rounded-3xl text-[17px] font-bold capitalize',
                        suggested ? 'text-white' : 'bg-card-2 ring-1 ring-line',
                      )}
                      style={suggested ? { background: 'var(--feed)' } : undefined}
                    >
                      Start {side}
                      {suggested && <span className="text-[13px] font-medium opacity-90">Suggested</span>}
                    </button>
                  )
                })}
              </div>
              <button type="button" onClick={() => setDetails((d) => !d)} className="mt-4 text-[15px] font-semibold text-ink-2 underline underline-offset-4">
                {details ? 'Hide manual entry' : 'Log a past feed instead'}
              </button>
            </div>
          )}
          {(details || edit) && !edit?.timer_state && (
            <>
              <WhenPicker label="Started" value={draft.start} onChange={(d) => set({ start: d })} timeZone={tz} minDate={minDate} />
              <Field label="Left side">
                <Stepper value={draft.leftMin} onChange={(v) => set({ leftMin: v })} step={1} unit="min" label="left side minutes" />
              </Field>
              <Field label="Right side">
                <Stepper value={draft.rightMin} onChange={(v) => set({ rightMin: v })} step={1} unit="min" label="right side minutes" />
              </Field>
            </>
          )}
        </>
      )}

      {/* ------------------------------------------------------------ BOTTLE */}
      {type === 'bottle' && (
        <>
          <WhenPicker label="When" value={draft.start} onChange={(d) => set({ start: d })} timeZone={tz} minDate={minDate} />
          <Field label="Amount">
            <Stepper value={draft.data.amount_ml} onChange={(v) => setData({ amount_ml: v })} step={10} max={1000} unit="ml" label="amount" />
          </Field>
          <Field label="What was in it">
            <Choices
              options={[
                { id: 'breast', label: 'Breast milk' },
                { id: 'formula', label: 'Formula' },
                { id: 'mixed', label: 'Mixed' },
              ]}
              value={draft.data.contents}
              onChange={(v) => setData({ contents: v })}
              tone="feed"
            />
          </Field>
        </>
      )}

      {/* ------------------------------------------------------------ SOLIDS */}
      {type === 'solids' && (
        <SolidsFields draft={draft} setData={setData} foodInput={foodInput} setFoodInput={setFoodInput} events={Object.values(events)} childId={childId} tz={tz} minDate={minDate} set={set} />
      )}

      {/* ------------------------------------------------------------ PUMP */}
      {type === 'pump' && (
        <>
          {!edit && !running && (
            <Button tone="pump" className="mb-4 w-full" onClick={() => void startNow()}>
              Start pumping timer
            </Button>
          )}
          <WhenPicker label="Started" value={draft.start} onChange={(d) => set({ start: d })} timeZone={tz} />
          <Field label="Left">
            <Stepper value={draft.data.left_ml} onChange={(v) => setData({ left_ml: v })} step={10} unit="ml" label="left amount" />
          </Field>
          <Field label="Right">
            <Stepper value={draft.data.right_ml} onChange={(v) => setData({ right_ml: v })} step={10} unit="ml" label="right amount" />
          </Field>
          {!edit?.timer_state && (
            <Field label="How long">
              <Stepper value={draft.durationMin} onChange={(v) => set({ durationMin: v })} step={5} unit="min" label="duration" />
            </Field>
          )}
        </>
      )}

      {/* ------------------------------------------------------------ DIAPER */}
      {type === 'diaper' && (
        <>
          <WhenPicker label="When" value={draft.start} onChange={(d) => set({ start: d })} timeZone={tz} minDate={minDate} />
          <div className="mb-5 grid grid-cols-2 gap-2">
            {[
              { id: 'wet', label: 'Wet' },
              { id: 'dirty', label: 'Dirty' },
              { id: 'mixed', label: 'Wet and dirty' },
              { id: 'dry', label: 'Dry' },
            ].map((k) => {
              const on = draft.data.kind === k.id
              return (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => void quickDiaper(k.id)}
                  aria-pressed={on}
                  className={clsx('h-16 rounded-3xl text-[17px] font-bold', !on && 'bg-card-2 ring-1 ring-line')}
                  style={on ? { background: 'var(--diaper)', color: '#fff' } : undefined}
                >
                  {k.label}
                </button>
              )
            })}
          </div>
          {!edit && (
            <button type="button" onClick={() => setDetails((d) => !d)} className="mb-4 text-[15px] font-semibold text-ink-2 underline underline-offset-4">
              {details ? 'Hide details' : 'Add color, texture or rash'}
            </button>
          )}
          {(details || edit) && (
            <>
              <Field label="Color">
                <Choices
                  options={[
                    { id: 'yellow', label: 'Yellow' },
                    { id: 'green', label: 'Green' },
                    { id: 'brown', label: 'Brown' },
                    { id: 'black', label: 'Black' },
                    { id: 'red', label: 'Red' },
                    { id: 'white', label: 'Pale' },
                  ]}
                  value={draft.data.color as 'yellow' | undefined}
                  onChange={(v) => setData({ color: v })}
                  tone="diaper"
                  allowNone
                />
              </Field>
              <Field label="Texture">
                <Choices
                  options={[
                    { id: 'runny', label: 'Runny' },
                    { id: 'soft', label: 'Soft' },
                    { id: 'firm', label: 'Firm' },
                  ]}
                  value={draft.data.texture as 'soft' | undefined}
                  onChange={(v) => setData({ texture: v })}
                  tone="diaper"
                  allowNone
                />
              </Field>
              <div className="mb-5">
                <Toggle label="Diaper rash" checked={Boolean(draft.data.rash)} onChange={(v) => setData({ rash: v })} tone="diaper" />
              </div>
            </>
          )}
        </>
      )}

      {/* ------------------------------------------------------------ POTTY */}
      {type === 'potty' && (
        <>
          <WhenPicker label="When" value={draft.start} onChange={(d) => set({ start: d })} timeZone={tz} minDate={minDate} />
          <Field label="What happened">
            <Choices
              options={[
                { id: 'pee', label: 'Pee' },
                { id: 'poo', label: 'Poo' },
                { id: 'both', label: 'Both' },
              ]}
              value={draft.data.kind as 'pee' | undefined}
              onChange={(v) => setData({ kind: v })}
              tone="diaper"
            />
          </Field>
          <Field label="Where">
            <Choices
              options={[
                { id: 'potty', label: 'On the potty' },
                { id: 'accident', label: 'Accident' },
              ]}
              value={draft.data.outcome}
              onChange={(v) => setData({ outcome: v })}
              tone="diaper"
            />
          </Field>
        </>
      )}

      {/* ------------------------------------------------------------ GROWTH */}
      {type === 'growth' && (
        <>
          <WhenPicker label="Measured" value={draft.start} onChange={(d) => set({ start: d })} timeZone={tz} minDate={minDate} />
          <Field label="Weight">
            <Stepper value={draft.data.weight_kg} onChange={(v) => setData({ weight_kg: v })} step={0.05} decimals={2} max={40} unit="kg" label="weight" />
          </Field>
          <Field label="Length">
            <Stepper value={toLen(draft.data.length_cm)} onChange={(v) => setData({ length_cm: fromLen(v) })} step={0.5} decimals={1} max={150} unit={lenUnit} label="length" />
          </Field>
          <Field label="Head">
            <Stepper value={toLen(draft.data.head_cm)} onChange={(v) => setData({ head_cm: fromLen(v) })} step={0.5} decimals={1} max={70} unit={lenUnit} label="head circumference" />
          </Field>
        </>
      )}

      {/* ------------------------------------------------------------ TEMPERATURE */}
      {type === 'temperature' && (
        <>
          <WhenPicker label="When" value={draft.start} onChange={(d) => set({ start: d })} timeZone={tz} minDate={minDate} />
          <Field label="Temperature">
            <Stepper
              value={tempShown}
              onChange={(v) => setData({ temp_c: v === undefined ? undefined : tUnit === 'f' ? Number(fToC(v).toFixed(2)) : v })}
              step={0.1}
              decimals={1}
              min={tUnit === 'f' ? 86 : 30}
              max={tUnit === 'f' ? 110 : 43}
              unit={tUnit === 'f' ? '°F' : '°C'}
              label="temperature"
            />
          </Field>
          {fever && (
            <div className="mb-5 rounded-2xl bg-[var(--health-soft)] px-4 py-3 text-[15px]">
              <strong className="font-semibold">Fever logged.</strong> Check with your pediatrician, and call right away if your baby is under 3 months.
            </div>
          )}
          <Field label="Taken by">
            <Choices options={TEMP_METHODS} value={draft.data.method} onChange={(v) => setData({ method: v })} tone="health" columns={3} allowNone />
          </Field>
        </>
      )}

      {/* ------------------------------------------------------------ MEDICINE */}
      {type === 'medicine' && <MedicineFields draft={draft} setData={setData} set={set} events={Object.values(events)} childId={childId} tz={tz} minDate={minDate} />}

      {/* ------------------------------------------------------------ SYMPTOMS */}
      {type === 'symptom' && (
        <>
          <WhenPicker label="When" value={draft.start} onChange={(d) => set({ start: d })} timeZone={tz} minDate={minDate} />
          <Field label="What is it">
            <Choices
              options={[
                { id: 'symptom', label: 'Symptoms' },
                { id: 'visit', label: 'Doctor visit' },
                { id: 'vaccine', label: 'Vaccine' },
              ]}
              value={draft.data.kind as 'symptom' | undefined}
              onChange={(v) => setData({ kind: v })}
              tone="health"
            />
          </Field>
          {draft.data.kind === 'vaccine' && (
            <TextInput label="Vaccine name" value={draft.data.vaccine ?? ''} onChange={(e) => setData({ vaccine: e.target.value })} placeholder="e.g. DTaP, first dose" />
          )}
          {draft.data.kind !== 'vaccine' && (
            <Field label="Symptoms">
              <MultiChips options={SYMPTOM_TAGS} values={draft.data.tags ?? []} onChange={(v) => setData({ tags: v })} tone="health" />
            </Field>
          )}
        </>
      )}

      {/* ------------------------------------------------------------ ACTIVITY */}
      {type === 'activity' && (
        <>
          <Field label="Activity">
            <Choices options={ACTIVITY_KINDS} value={draft.data.kind as 'tummy' | undefined} onChange={(v) => setData({ kind: v })} tone="activity" columns={2} />
          </Field>
          {!edit && !running && (
            <Button tone="activity" className="mb-5 w-full" onClick={() => void startNow()} disabled={!draft.data.kind}>
              Start timer
            </Button>
          )}
          <WhenPicker label="Started" value={draft.start} onChange={(d) => set({ start: d })} timeZone={tz} minDate={minDate} />
          {!edit?.timer_state && (
            <Field label="How long">
              <Stepper value={draft.durationMin} onChange={(v) => set({ durationMin: v })} step={5} unit="min" label="duration" />
            </Field>
          )}
        </>
      )}

      {/* ------------------------------------------------------------ MILESTONE */}
      {type === 'milestone' && (
        <>
          <Field label="Which first">
            <Choices options={MILESTONE_KINDS} value={draft.data.kind as 'smile' | undefined} onChange={(v) => setData({ kind: v, label: undefined })} tone="milestone" columns={3} />
          </Field>
          <TextInput label="Or name it yourself" value={draft.data.label ?? ''} onChange={(e) => setData({ label: e.target.value, kind: e.target.value ? undefined : draft.data.kind })} placeholder="e.g. First trip to the beach" />
          <WhenPicker label="When" value={draft.start} onChange={(d) => set({ start: d })} timeZone={tz} minDate={minDate} />
          <PhotoPicker paths={draft.photos} onChange={(p) => set({ photos: p })} />
        </>
      )}

      {/* ------------------------------------------------------------ NOTE */}
      {type === 'note' && (
        <>
          <WhenPicker label="Day" value={draft.start} onChange={(d) => set({ start: d })} timeZone={tz} minDate={minDate} />
          <TextArea label="What happened today" value={draft.notes} onChange={(v) => set({ notes: v })} rows={6} placeholder="A little story for the Baby Diary" />
          <PhotoPicker paths={draft.photos} onChange={(p) => set({ photos: p })} />
        </>
      )}

      {/* ------------------------------------------------------------ CONTRACTION */}
      {type === 'contraction' && <ContractionPanel draft={draft} setData={setData} onStart={() => void startNow()} edit={edit} onSaveEdit={() => void save()} />}

      {type !== 'note' && type !== 'contraction' && (details || edit || !['diaper', 'nursing'].includes(type)) && (
        <TextArea label="Notes" value={draft.notes} onChange={(v) => set({ notes: v })} rows={2} placeholder="Anything worth remembering" />
      )}
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
function SolidsFields({
  draft,
  setData,
  foodInput,
  setFoodInput,
  events,
  childId,
  tz,
  minDate,
  set,
}: {
  draft: Draft
  setData: (p: EventData) => void
  foodInput: string
  setFoodInput: (v: string) => void
  events: LeelaEvent[]
  childId: string | null
  tz: string
  minDate: string | null
  set: (p: Partial<Draft>) => void
}) {
  const tried = useMemo(() => {
    const names = new Map<string, number>()
    for (const e of events) {
      if (e.deleted_at || e.type !== 'solids' || (childId && e.child_id !== childId)) continue
      for (const f of e.data.foods ?? []) names.set(f.name, (names.get(f.name) ?? 0) + 1)
    }
    return [...names.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n)
  }, [events, childId])
  const foods = draft.data.foods ?? []
  const addFood = (name: string) => {
    const n = name.trim()
    if (!n || foods.some((f) => f.name.toLowerCase() === n.toLowerCase())) return
    setData({ foods: [...foods, { name: n, first: !tried.some((t) => t.toLowerCase() === n.toLowerCase()) }] })
    setFoodInput('')
  }
  const allergens = foods.filter((f) => f.allergen).map((f) => f.name)
  return (
    <>
      <WhenPicker label="When" value={draft.start} onChange={(d) => set({ start: d })} timeZone={tz} minDate={minDate} />
      <Field label="Foods" hint={foods.some((f) => f.first) ? 'New foods are marked as a first try.' : undefined}>
        <div className="mb-2 flex flex-wrap gap-2">
          {foods.map((f) => (
            <button
              key={f.name}
              type="button"
              onClick={() => setData({ foods: foods.filter((x) => x.name !== f.name) })}
              className="min-h-10 rounded-full px-4 text-[15px] font-semibold text-white"
              style={{ background: 'var(--feed)' }}
              aria-label={`Remove ${f.name}`}
            >
              {f.name}
              {f.first ? ' (first try)' : ''} ×
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={foodInput}
            onChange={(e) => setFoodInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addFood(foodInput)
              }
            }}
            placeholder="Type a food"
            aria-label="Food name"
            className="h-12 min-w-0 flex-1 rounded-2xl border border-line bg-card-2 px-4 text-[17px] outline-none focus:border-brand"
          />
          <Button size="md" variant="secondary" onClick={() => addFood(foodInput)}>
            Add
          </Button>
        </div>
        {tried.length > 0 && (
          <div className="no-scrollbar -mx-5 mt-3 flex gap-2 overflow-x-auto px-5">
            {tried.slice(0, 12).map((t) => (
              <button key={t} type="button" onClick={() => addFood(t)} className="min-h-9 shrink-0 rounded-full bg-card-2 px-3 text-[14px] ring-1 ring-line">
                {t}
              </button>
            ))}
          </div>
        )}
      </Field>
      {foods.length > 0 && (
        <Field label="Common allergens in this meal">
          <MultiChips
            options={COMMON_ALLERGENS}
            values={allergens.length ? COMMON_ALLERGENS.filter((a) => foods.some((f) => f.allergen && f.name.toLowerCase().includes(a.toLowerCase()))) : []}
            onChange={(vals) => {
              const marked = new Set(vals.map((v) => v.toLowerCase()))
              const next = foods.map((f) => ({ ...f, allergen: [...marked].some((m) => f.name.toLowerCase().includes(m)) || undefined }))
              const missing = vals.filter((v) => !foods.some((f) => f.name.toLowerCase().includes(v.toLowerCase())))
              setData({ foods: [...next, ...missing.map((m) => ({ name: m, allergen: true }))] })
            }}
            tone="feed"
          />
        </Field>
      )}
      <Field label="How much">
        <Choices
          options={[
            { id: 'taste', label: 'A taste' },
            { id: 'some', label: 'Some' },
            { id: 'most', label: 'Most' },
            { id: 'all', label: 'All of it' },
          ]}
          value={draft.data.eaten}
          onChange={(v) => setData({ eaten: v })}
          tone="feed"
          columns={4}
          allowNone
        />
      </Field>
      <Field label="Reaction">
        <Choices
          options={[
            { id: 'liked', label: 'Loved it' },
            { id: 'neutral', label: 'Okay' },
            { id: 'disliked', label: 'Not a fan' },
          ]}
          value={draft.data.reaction}
          onChange={(v) => setData({ reaction: v })}
          tone="feed"
          allowNone
        />
      </Field>
      <PhotoPicker paths={draft.photos} onChange={(p) => set({ photos: p })} max={2} />
    </>
  )
}

function MedicineFields({
  draft,
  setData,
  set,
  events,
  childId,
  tz,
  minDate,
}: {
  draft: Draft
  setData: (p: EventData) => void
  set: (p: Partial<Draft>) => void
  events: LeelaEvent[]
  childId: string | null
  tz: string
  minDate: string | null
}) {
  const recent = useMemo(() => {
    const seen = new Map<string, LeelaEvent>()
    const sorted = events
      .filter((e) => !e.deleted_at && e.type === 'medicine' && e.child_id === childId && e.data.name)
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
    for (const e of sorted) if (!seen.has(e.data.name!)) seen.set(e.data.name!, e)
    return [...seen.values()].slice(0, 6)
  }, [events, childId])
  const lastSame = recent.find((r) => r.data.name?.toLowerCase() === draft.data.name?.toLowerCase())
  return (
    <>
      <WhenPicker label="Given" value={draft.start} onChange={(d) => set({ start: d })} timeZone={tz} minDate={minDate} />
      {recent.length > 0 && (
        <div className="no-scrollbar -mx-5 mb-3 flex gap-2 overflow-x-auto px-5">
          {recent.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setData({ name: r.data.name, unit: r.data.unit })}
              className="min-h-10 shrink-0 rounded-full bg-card-2 px-4 text-[15px] ring-1 ring-line"
            >
              {r.data.name}
            </button>
          ))}
        </div>
      )}
      <TextInput label="Medicine" value={draft.data.name ?? ''} onChange={(e) => setData({ name: e.target.value })} placeholder="Name on the bottle" />
      {lastSame && (
        <p className="-mt-3 mb-5 text-[14px] text-ink-2">
          Last given {fmtTime(lastSame.started_at, tz)}, {durationText(Date.now() - Date.parse(lastSame.started_at))} ago.
        </p>
      )}
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <TextInput label="Dose given" value={draft.data.dose ?? ''} onChange={(e) => setData({ dose: e.target.value })} placeholder="As your doctor said" inputMode="decimal" />
        <div className="mb-5">
          <div className="mb-2 text-[15px] font-semibold text-ink-2">Unit</div>
          <select
            value={draft.data.unit ?? 'ml'}
            onChange={(e) => setData({ unit: e.target.value })}
            className="h-13 rounded-2xl border border-line bg-card-2 px-3 text-[17px]"
            aria-label="Unit"
          >
            {['ml', 'mg', 'drops', 'tablet', 'sachet', 'puff'].map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </div>
      </div>
      <p className="-mt-2 mb-5 text-[13px] text-ink-3">Leela records what was given. It never suggests doses.</p>
    </>
  )
}

function ContractionPanel({
  draft,
  setData,
  onStart,
  edit,
  onSaveEdit,
}: {
  draft: Draft
  setData: (p: EventData) => void
  onStart: () => void
  edit?: LeelaEvent
  onSaveEdit: () => void
}) {
  const events = useLeela((s) => s.events)
  const userId = useLeela((s) => s.userId)
  const family = useLeela((s) => s.family)
  const recent = Object.values(events)
    .filter((e) => e.type === 'contraction' && !e.deleted_at && e.created_by === userId && e.ended_at)
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, 8)
  const intensity = (
    <Field label="How strong">
      <Choices
        options={[
          { id: 'mild', label: 'Mild' },
          { id: 'moderate', label: 'Moderate' },
          { id: 'strong', label: 'Strong' },
        ]}
        value={draft.data.intensity}
        onChange={(v) => setData({ intensity: v })}
        tone="contraction"
        allowNone
      />
    </Field>
  )
  if (edit) {
    return (
      <>
        {intensity}
        <Button tone="contraction" className="mb-4 w-full" onClick={onSaveEdit}>
          Save changes
        </Button>
      </>
    )
  }
  return (
    <>
      <Button tone="contraction" className="mb-5 h-20 w-full text-[19px]" onClick={onStart}>
        Contraction started
      </Button>
      {recent.length > 0 && family && (
        <div className="mb-4">
          <div className="mb-2 text-[15px] font-semibold text-ink-2">Recent</div>
          <ol className="divide-y divide-line rounded-2xl bg-card-2 ring-1 ring-line">
            {recent.map((e, i) => {
              const secs = Math.round((Date.parse(e.ended_at!) - Date.parse(e.started_at)) / 1000)
              const prev = recent[i + 1]
              const gap = prev ? durationText(Date.parse(e.started_at) - Date.parse(prev.started_at)) : null
              return (
                <li key={e.id} className="flex items-center justify-between px-4 py-2.5 text-[15px]">
                  <span>{fmtTime(e.started_at, family.timezone)}</span>
                  <span className="num font-semibold">{secs}s</span>
                  <span className="text-ink-2">{gap ? `${gap} apart` : 'first'}</span>
                </li>
              )
            })}
          </ol>
        </div>
      )}
      <p className="text-[14px] text-ink-2">Leela only times contractions. For when to go in, follow your doctor’s or midwife’s advice.</p>
    </>
  )
}
