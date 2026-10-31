import { useEffect, useState } from 'react'
import { saveChild } from '../lib/actions'
import { useLeela } from '../lib/store'
import type { Child } from '../lib/types'
import { Sheet } from './Sheet'
import { Button, Choices, TextInput } from './ui'

export function ChildSheet({ open, onClose, child }: { open: boolean; onClose: () => void; child?: Child }) {
  const [name, setName] = useState('')
  const [birth, setBirth] = useState('')
  const [due, setDue] = useState('')
  const [early, setEarly] = useState(false)
  const [sex, setSex] = useState<'female' | 'male' | undefined>()
  const today = new Date().toISOString().slice(0, 10)

  useEffect(() => {
    if (!open) return
    setName(child?.name ?? '')
    setBirth(child?.birth_date ?? '')
    setDue(child?.due_date ?? '')
    setEarly(Boolean(child?.due_date))
    setSex(child?.sex ?? undefined)
  }, [open, child])

  const valid = name.trim().length > 0
  const save = async () => {
    if (!valid) return
    await saveChild({
      id: child?.id,
      name: name.trim(),
      birth_date: birth || null,
      due_date: early && due ? due : null,
      sex: sex ?? null,
      settings: child?.settings ?? {},
    })
    useLeela.getState().toast({ text: child ? 'Saved.' : `${name.trim()} added.` })
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={child ? `Edit ${child.name}` : 'Add your baby'}
      footer={
        <Button className="w-full" onClick={() => void save()} disabled={!valid}>
          {child ? 'Save changes' : 'Add baby'}
        </Button>
      }
    >
      <TextInput label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Baby’s name" autoFocus={!child} maxLength={40} />
      <TextInput label="Birth date" type="date" value={birth} max={today} onChange={(e) => setBirth(e.target.value)} hint="Used for age, nap times and growth charts." />
      <div className="mb-5">
        <button type="button" onClick={() => setEarly((v) => !v)} className="text-[15px] font-semibold text-ink-2 underline underline-offset-4">
          {early ? 'Not born early' : 'Born early? Add the due date'}
        </button>
        {early && (
          <div className="mt-3">
            <TextInput label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} hint="Leela uses corrected age for nap times and growth until age 2." />
          </div>
        )}
      </div>
      <div className="mb-5">
        <div className="mb-2 text-[15px] font-semibold text-ink-2">Sex, for growth charts</div>
        <Choices
          options={[
            { id: 'female', label: 'Girl' },
            { id: 'male', label: 'Boy' },
          ]}
          value={sex}
          onChange={setSex}
          allowNone
          columns={2}
        />
      </div>
    </Sheet>
  )
}
