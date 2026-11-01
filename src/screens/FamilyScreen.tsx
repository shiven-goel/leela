import { Copy, Crown, FileArrowUp, PencilSimple, Plus, ShareNetwork, X } from '@phosphor-icons/react'
import { useState } from 'react'
import { ChildSheet } from '../components/ChildSheet'
import { Sheet } from '../components/Sheet'
import { Button, Choices, TextInput } from '../components/ui'
import { rpc, saveDisplayName, saveFamilySettings, savePrefs } from '../lib/actions'
import { MAX_FAMILY_MEMBERS } from '../lib/config'
import { myPrefs, useLeela } from '../lib/store'
import { supabase } from '../lib/supabase'
import { bootstrap, refresh, teardown } from '../lib/sync'
import { getThemeMode, setThemeMode, type ThemeMode } from '../lib/theme'
import { forgetWord } from '../lib/import/learn'
import { meaningById } from '../lib/import/vocab'
import { ageText } from '../lib/time'
import type { Child } from '../lib/types'
import type { RpcName } from '../lib/database.types'

export function FamilyScreen() {
  const family = useLeela((s) => s.family)!
  const members = useLeela((s) => s.members)
  const profiles = useLeela((s) => s.profiles)
  const children = useLeela((s) => s.children)
  const userId = useLeela((s) => s.userId)
  const email = useLeela((s) => s.email)
  const toast = useLeela((s) => s.toast)
  const prefs = myPrefs()
  const [childSheet, setChildSheet] = useState<{ child?: Child } | null>(null)
  const [nameSheet, setNameSheet] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [theme, setTheme] = useState<ThemeMode>(getThemeMode())
  const [busy, setBusy] = useState(false)

  const ownerId = family.owner_id && members.some((m) => m.user_id === family.owner_id) ? family.owner_id : members[0]?.user_id
  const iAmOwner = ownerId === userId
  const myName = userId ? profiles[userId]?.display_name ?? '' : ''
  const [nameDraft, setNameDraft] = useState(myName)
  const lastOne = members.length <= 1

  const share = async () => {
    const text = `Join our family on Leela to log the baby’s day together. Our family code is ${family.code}.\n${window.location.origin}${window.location.pathname}`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join our family on Leela', text })
        return
      } catch {
        /* cancelled */
      }
    }
    await navigator.clipboard.writeText(text)
    toast({ text: 'Invite copied. Paste it into WhatsApp or a message.' })
  }

  const ownerAction = async (fn: RpcName, args: Record<string, unknown>, done: string) => {
    if (!navigator.onLine) {
      toast({ text: 'This needs a connection.', tone: 'error' })
      return
    }
    const res = await rpc(fn, args)
    if (!res.ok) toast({ text: `Couldn’t do that: ${res.error}`, tone: 'error' })
    else {
      toast({ text: done })
      await refresh()
    }
  }

  const leave = async () => {
    setBusy(true)
    const res = await rpc('leave_family', { p_confirm: lastOne ? confirmText.trim().toUpperCase() : null })
    setBusy(false)
    if (!res.ok) {
      toast({ text: res.error === 'confirm_required' ? 'Type DELETE to confirm.' : `Couldn’t leave: ${res.error}`, tone: 'error' })
      return
    }
    setLeaving(false)
    teardown()
    await bootstrap()
  }

  return (
    <div className="mx-auto max-w-[560px] px-5 pb-32">
      <header className="safe-top pb-4">
        <h1 className="font-display text-[30px] font-extrabold leading-tight">{family.name || 'Family'}</h1>
        <p className="text-[15px] text-ink-2">
          {members.length} of {MAX_FAMILY_MEMBERS} members
        </p>
      </header>

      <section className="mb-6 rounded-[28px] bg-card p-5 shadow-lift" aria-labelledby="code-h">
        <h2 id="code-h" className="text-[15px] font-semibold text-ink-2">
          Family code
        </h2>
        <p className="num mt-1 text-[30px] font-extrabold tracking-wide">{family.code}</p>
        <p className="mb-4 text-[14px] text-ink-2">Anyone who enters this once can see and log everything for your babies.</p>
        <div className="grid grid-cols-2 gap-2">
          <Button size="md" onClick={() => void share()}>
            <ShareNetwork size={20} weight="bold" aria-hidden="true" /> Share
          </Button>
          <Button
            size="md"
            variant="secondary"
            onClick={() => {
              void navigator.clipboard.writeText(family.code)
              toast({ text: 'Code copied.' })
            }}
          >
            <Copy size={20} weight="bold" aria-hidden="true" /> Copy
          </Button>
        </div>
        {iAmOwner && (
          <button
            type="button"
            className="mt-4 text-[14px] font-semibold text-ink-2 underline underline-offset-4"
            onClick={() => {
              if (window.confirm('Reset the code? The old one stops working right away. Everyone already in the family stays in.')) {
                void ownerAction('reset_family_code', {}, 'New code ready. Share it with anyone new.')
              }
            }}
          >
            Reset code
          </button>
        )}
      </section>

      <Section title="Members">
        <ul className="divide-y divide-line">
          {members.map((m) => {
            const p = profiles[m.user_id]
            const isMe = m.user_id === userId
            return (
              <li key={m.user_id} className="flex items-center gap-3 py-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-card-2 font-display text-[18px] font-bold">
                  {(p?.display_name || '?').slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[16px] font-semibold">
                    <span className="truncate">{p?.display_name || 'Family member'}</span>
                    {isMe && <span className="text-[14px] font-normal text-ink-2">(you)</span>}
                    {m.user_id === ownerId && <Crown size={16} weight="fill" className="text-[var(--milestone)]" aria-label="Owner" />}
                  </span>
                </span>
                {isMe && (
                  <button type="button" onClick={() => setNameSheet(true)} className="grid h-10 w-10 place-items-center rounded-full bg-card-2" aria-label="Edit your name">
                    <PencilSimple size={18} weight="bold" />
                  </button>
                )}
                {iAmOwner && !isMe && (
                  <span className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        if (window.confirm(`Make ${p?.display_name || 'them'} the owner? They’ll be able to remove members and reset the code.`)) {
                          void ownerAction('transfer_ownership', { p_user_id: m.user_id }, 'Ownership handed over.')
                        }
                      }}
                    >
                      Make owner
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        if (window.confirm(`Remove ${p?.display_name || 'this member'}? They lose access right away.`)) {
                          void ownerAction('remove_member', { p_user_id: m.user_id }, 'Removed.')
                        }
                      }}
                    >
                      Remove
                    </Button>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </Section>

      <Section title="Babies">
        <ul className="divide-y divide-line">
          {children.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setChildSheet({ child: c })} className="flex w-full items-center gap-3 py-3 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-semibold">{c.name}</span>
                  <span className="block text-[14px] text-ink-2">{c.birth_date ? ageText(c.birth_date) : 'Birth date not set'}</span>
                </span>
                <PencilSimple size={18} weight="bold" className="text-ink-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <Button variant="secondary" size="md" className="mt-2 w-full" onClick={() => setChildSheet({})}>
          <Plus size={18} weight="bold" aria-hidden="true" /> Add a baby
        </Button>
      </Section>

      <Section title="Units and display">
        <div className="mb-4">
          <div className="mb-2 text-[15px] font-semibold text-ink-2">Length</div>
          <Choices
            options={[
              { id: 'cm', label: 'Centimetres' },
              { id: 'in', label: 'Inches' },
            ]}
            value={prefs.length === 'in' ? 'in' : 'cm'}
            onChange={(v) => void savePrefs({ length: v ?? 'cm' })}
            columns={2}
          />
        </div>
        <div className="mb-4">
          <div className="mb-2 text-[15px] font-semibold text-ink-2">Temperature</div>
          <Choices
            options={[
              { id: 'c', label: '°C' },
              { id: 'f', label: '°F' },
            ]}
            value={prefs.temp === 'f' ? 'f' : 'c'}
            onChange={(v) => void savePrefs({ temp: v ?? 'c' })}
            columns={2}
          />
        </div>
        <p className="mb-4 text-[14px] text-ink-2">Milk is always in ml and weight in kg.</p>
        <div className="mb-4">
          <div className="mb-2 text-[15px] font-semibold text-ink-2">Theme</div>
          <Choices
            options={[
              { id: 'auto', label: 'Automatic' },
              { id: 'day', label: 'Day' },
              { id: 'night', label: 'Night' },
            ]}
            value={theme}
            onChange={(v) => {
              const mode = v ?? 'auto'
              setTheme(mode)
              setThemeMode(mode, family)
            }}
          />
          <p className="mt-1.5 text-[14px] text-ink-2">Automatic switches to night colours during the night window.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextInput label="Night starts" type="time" value={family.night_start.slice(0, 5)} onChange={(e) => e.target.value && void saveFamilySettings({ night_start: e.target.value })} />
          <TextInput label="Night ends" type="time" value={family.night_end.slice(0, 5)} onChange={(e) => e.target.value && void saveFamilySettings({ night_end: e.target.value })} />
        </div>
        <p className="-mt-3 text-[14px] text-ink-2">Sleep that starts in this window counts as night sleep.</p>
      </Section>

      <Section title="Past logs">
        <p className="mb-3 text-[15px] text-ink-2">Bring in what you wrote before Leela, from a PDF, Word file, Google Doc, spreadsheet or WhatsApp chat. You check everything before it’s saved, and any import can be undone.</p>
        <Button variant="secondary" size="md" className="w-full" onClick={() => useLeela.getState().set({ overlay: { kind: 'import' } })}>
          <FileArrowUp size={18} weight="bold" aria-hidden="true" /> Bring in past logs
        </Button>
      </Section>

      <Section title="Words Leela has learned">
        {Object.keys(prefs.vocab ?? {}).length === 0 ? (
          <p className="text-[15px] text-ink-2">When Leela meets shorthand it doesn’t know, it asks you once and remembers. Your words show up here.</p>
        ) : (
          <ul className="divide-y divide-line">
            {Object.entries(prefs.vocab ?? {})
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([term, meaning]) => (
                <li key={term} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1 text-[16px]">
                    <span className="font-semibold">“{term}”</span> <span className="text-ink-2">means {meaningById(meaning)?.label.toLowerCase() ?? meaning}</span>
                  </span>
                  <button type="button" onClick={() => void forgetWord(term)} className="grid h-10 w-10 place-items-center rounded-full bg-card-2" aria-label={`Forget ${term}`}>
                    <X size={16} weight="bold" />
                  </button>
                </li>
              ))}
          </ul>
        )}
        {(prefs.feedDefault || prefs.dateOrder) && (
          <p className="mt-3 text-[14px] text-ink-3">
            {prefs.feedDefault ? `A plain “fed” means ${prefs.feedDefault === 'bottle' ? 'a bottle' : 'breastfeeding'}. ` : ''}
            {prefs.dateOrder ? `Dates are read as ${prefs.dateOrder === 'dmy' ? 'day/month' : 'month/day'}.` : ''}{' '}
            <button type="button" className="font-semibold underline underline-offset-4" onClick={() => void savePrefs({ feedDefault: undefined, dateOrder: undefined })}>
              Reset
            </button>
          </p>
        )}
      </Section>

      <Section title="Your account">
        <p className="mb-3 text-[15px] text-ink-2">Signed in as {email}</p>
        <div className="flex flex-col gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={() => {
              teardown()
              void supabase.auth.signOut().then(() => bootstrap())
            }}
          >
            Sign out
          </Button>
          <Button variant="danger" size="md" onClick={() => setLeaving(true)}>
            Leave family
          </Button>
        </div>
      </Section>

      <Sheet open={nameSheet} onClose={() => setNameSheet(false)} title="Your name" footer={
        <Button className="w-full" disabled={!nameDraft.trim()} onClick={() => { void saveDisplayName(nameDraft.trim()); setNameSheet(false) }}>Save</Button>
      }>
        <TextInput label="What your family sees" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={40} />
      </Sheet>

      <Sheet open={leaving} onClose={() => setLeaving(false)} title="Leave family?">
        {lastOne ? (
          <>
            <p className="mb-4 text-[16px] text-ink-2">You’re the only member. Leaving deletes this family and everything logged in it. This can’t be undone.</p>
            <TextInput label="Type DELETE to confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoCapitalize="characters" />
          </>
        ) : (
          <p className="mb-5 text-[16px] text-ink-2">
            You’ll stop seeing this family’s babies. Everything stays for the others.
            {iAmOwner ? ' Ownership passes to the longest-standing member.' : ''}
          </p>
        )}
        <Button variant="danger" className="mb-2 w-full" disabled={busy || (lastOne && confirmText.trim().toUpperCase() !== 'DELETE')} onClick={() => void leave()}>
          {lastOne ? 'Delete family and leave' : 'Leave family'}
        </Button>
      </Sheet>

      {childSheet && <ChildSheet open onClose={() => setChildSheet(null)} child={childSheet.child} />}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-[28px] bg-card p-5" aria-label={title}>
      <h2 className="mb-2 font-display text-[20px] font-bold">{title}</h2>
      {children}
    </section>
  )
}
