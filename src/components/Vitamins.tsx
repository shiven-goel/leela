import clsx from 'clsx'
import { Check, PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import { deleteEvent, logEvent, saveChildSettings } from '../lib/actions'
import { loggedBy, useLeela } from '../lib/store'
import { SUPPLEMENT_PRESETS, SUPPLEMENT_UNITS, doseText, givenToday, readSupplements, sameName, type Supplement } from '../lib/supplements'
import { fmtTime } from '../lib/time'
import type { Child, LeelaEvent } from '../lib/types'
import { uuid } from '../lib/uuid'
import { VitaminIcon } from './Icon'
import { Sheet } from './Sheet'
import { Button, TextInput } from './ui'

/**
 * Today's vitamins and supplements: one tap gives one (a Medicine entry), and everyone in the
 * family sees what's been given today and by whom.
 */
export function VitaminsSheet({
  open,
  onClose,
  child,
  events,
  now,
  tz,
  onOpenEntry,
}: {
  open: boolean
  onClose: () => void
  child: Child
  events: LeelaEvent[]
  now: number
  tz: string
  onOpenEntry: (e: LeelaEvent) => void
}) {
  const list = useMemo(() => readSupplements(child.settings), [child.settings])
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Supplement | null>(null)
  const toast = useLeela((s) => s.toast)

  const given = (s: Supplement) => givenToday(events, child.id, s, now, tz)
  const left = list.filter((s) => !given(s))

  const save = (next: Supplement[]) => void saveChildSettings(child.id, 'supplements', next)
  const give = async (items: Supplement[]) => {
    const made: LeelaEvent[] = []
    for (const s of items) made.push(await logEvent({ type: 'medicine', childId: child.id, data: { name: s.name, dose: s.dose, unit: s.unit, supplement: true } }, { quiet: true }))
    toast({
      text: items.length === 1 ? `${items[0].name} given.` : `${items.length} vitamins given.`,
      action: { label: 'Undo', run: () => made.forEach((e) => void deleteEvent(e.id, { quiet: true })) },
    })
  }
  const submit = () => {
    if (!form || !form.name.trim()) return
    const clean: Supplement = { id: form.id, name: form.name.trim(), dose: form.dose?.trim() || undefined, unit: form.unit }
    save(list.some((s) => s.id === clean.id) ? list.map((s) => (s.id === clean.id ? clean : s)) : [...list, clean])
    setForm(null)
  }
  const remove = (s: Supplement) => {
    const before = list
    save(list.filter((x) => x.id !== s.id))
    toast({ text: `${s.name} taken off the list. Entries already logged stay.`, action: { label: 'Undo', run: () => save(before) } })
  }
  const close = () => {
    setEditing(false)
    setForm(null)
    onClose()
  }
  const presets = SUPPLEMENT_PRESETS.filter((p) => !list.some((s) => sameName(s.name, p.name)))

  return (
    <Sheet open={open} onClose={close} title="Vitamins" tone="health">
      {list.length > 0 && (
        <>
          <div className="mb-2 flex items-end justify-between">
            <h3 className="text-[15px] font-semibold text-ink-2">Today</h3>
            <button type="button" onClick={() => setEditing(!editing)} className="flex min-h-10 items-center gap-1 text-[15px] font-semibold text-brand">
              {editing ? 'Done' : (
                <>
                  <PencilSimple size={16} weight="bold" aria-hidden="true" /> Edit list
                </>
              )}
            </button>
          </div>
          <ul className="mb-3 divide-y divide-line overflow-hidden rounded-2xl bg-card-2 ring-1 ring-line">
            {list.map((s) => {
              const e = given(s)
              const dose = doseText(s)
              return (
                <li key={s.id} className={clsx('flex items-center gap-3 px-4 py-3', e && !editing && 'bg-[var(--health-soft)]')}>
                  <span
                    className={clsx('grid h-11 w-11 shrink-0 place-items-center rounded-full', e ? 'text-white' : 'text-[var(--health)]')}
                    style={{ background: e ? 'var(--health)' : 'var(--health-soft)' }}
                    aria-hidden="true"
                  >
                    {e ? <Check size={22} weight="bold" /> : <VitaminIcon size={22} />}
                  </span>
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => (editing ? setForm({ ...s }) : e ? onOpenEntry(e) : undefined)}
                    disabled={!editing && !e}
                  >
                    <span className="block truncate text-[17px] font-semibold">
                      {s.name}
                      {dose && <span className="font-normal text-ink-2"> · {dose}</span>}
                    </span>
                    <span className="block text-[13px] text-ink-2">
                      {editing ? 'Tap to change' : e ? `Given ${fmtTime(e.started_at, tz)} by ${loggedBy(e)}` : 'Not given yet today'}
                    </span>
                  </button>
                  {editing ? (
                    <button type="button" onClick={() => remove(s)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[var(--health)]" aria-label={`Take ${s.name} off the list`}>
                      <Trash size={20} weight="bold" />
                    </button>
                  ) : e ? (
                    <span className="shrink-0 text-[14px] font-semibold text-[var(--health)]">Done</span>
                  ) : (
                    <Button size="md" tone="health" className="shrink-0 px-5" onClick={() => void give([s])}>
                      Give
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
          {!editing && left.length > 1 && (
            <Button tone="health" className="mb-3 w-full" onClick={() => void give(left)}>
              Give all {left.length} now
            </Button>
          )}
          {!editing && !left.length && <p className="mb-3 text-center text-[15px] font-semibold text-[var(--health)]">All given today.</p>}
        </>
      )}

      {form ? (
        <section className="mb-4 rounded-2xl bg-card-2 p-4 ring-1 ring-line" aria-label="Vitamin details">
          <TextInput label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name on the bottle" autoFocus={!form.name} />
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <TextInput label="Dose each day" value={form.dose ?? ''} onChange={(e) => setForm({ ...form, dose: e.target.value })} placeholder="As your doctor said" inputMode="decimal" />
            <div className="mb-5">
              <div className="mb-2 text-[15px] font-semibold text-ink-2">Unit</div>
              <select
                value={form.unit ?? 'ml'}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className="h-13 rounded-2xl border border-line bg-card px-3 text-[17px]"
                aria-label="Unit"
              >
                {SUPPLEMENT_UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="md" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button tone="health" size="md" onClick={submit} disabled={!form.name.trim()}>
              {list.some((s) => s.id === form.id) ? 'Save' : 'Add to list'}
            </Button>
          </div>
        </section>
      ) : (
        (editing || !list.length) && (
          <section className="mb-4">
            <h3 className="mb-1 text-[15px] font-semibold text-ink-2">{list.length ? 'Add another' : `Add ${child.name}’s daily vitamins`}</h3>
            {!list.length && <p className="mb-3 text-[14px] text-ink-2">Add each one once. Then it’s one tap a day to mark it given, for everyone in the family.</p>}
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => setForm({ id: uuid(), name: p.name, unit: p.unit })}
                  className="flex min-h-11 items-center gap-1.5 rounded-full bg-[var(--health-soft)] px-4 text-[15px] font-semibold"
                >
                  <Plus size={14} weight="bold" aria-hidden="true" className="text-[var(--health)]" /> {p.name}
                </button>
              ))}
              <button type="button" onClick={() => setForm({ id: uuid(), name: '', unit: 'ml' })} className="flex min-h-11 items-center gap-1.5 rounded-full bg-card-2 px-4 text-[15px] font-semibold ring-1 ring-line">
                <Plus size={14} weight="bold" aria-hidden="true" /> Other
              </button>
            </div>
          </section>
        )
      )}

      <p className="text-[13px] leading-snug text-ink-3">
        The list is shared with the family. Each one given is saved as a medicine entry, so it shows on the timeline and in the doctor report. LAPdiary records what was given; it never suggests doses.
      </p>
    </Sheet>
  )
}
