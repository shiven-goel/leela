import clsx from 'clsx'
import { Copy, ShareNetwork, UsersThree, HouseSimple } from '@phosphor-icons/react'
import { useState } from 'react'
import { LeelaMark } from '../components/LeelaMark'
import { Button, Choices, TextInput } from '../components/ui'
import { rpc, saveChild } from '../lib/actions'
import { useLeela } from '../lib/store'
import { supabase } from '../lib/supabase'
import { bootstrap } from '../lib/sync'
import { deviceTimeZone } from '../lib/time'

type Step = 'choose' | 'start' | 'baby' | 'share' | 'join' | 'preview'

const JOIN_ERRORS: Record<string, string> = {
  invalid_code: 'That code doesn’t match a family. Check it with whoever shared it.',
  too_many_attempts: 'Too many wrong codes. Wait an hour, then try again.',
  family_full: 'That family already has 6 members. The owner can remove someone to make room.',
  already_in_family: 'You’re already in a family.',
}

/** Formats as you type: LEELA-7KQ2-9XPM. */
function formatCode(raw: string): string {
  let s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (s.startsWith('LEELA')) s = s.slice(5)
  s = s.slice(0, 8)
  return s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s
}

export function OnboardingScreen() {
  const userId = useLeela((s) => s.userId)
  const removed = useLeela((s) => s.removedNotice)
  const [step, setStep] = useState<Step>('choose')
  const [familyName, setFamilyName] = useState('')
  const [code, setCode] = useState('')
  const [newCode, setNewCode] = useState('')
  const [preview, setPreview] = useState<{ family_name: string; members: string[]; children: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [baby, setBaby] = useState({ name: '', birth: '', sex: undefined as 'female' | 'male' | undefined })

  const myName = async () => {
    if (!userId) return ''
    const { data } = await supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle()
    return (data?.display_name as string | undefined) ?? ''
  }

  const create = async () => {
    setBusy(true)
    setError(null)
    const res = await rpc('create_family', {
      p_family_name: familyName.trim() || 'Our family',
      p_display_name: await myName(),
      p_timezone: deviceTimeZone(),
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.error === 'already_in_family' ? JOIN_ERRORS.already_in_family : `Couldn’t create the family: ${res.error}`)
      return
    }
    setNewCode(String(res.code))
    useLeela.getState().set({ onboarding: true })
    await bootstrap()
    setStep('baby')
  }

  const addBaby = async () => {
    if (!useLeela.getState().family || !baby.name.trim()) return
    setBusy(true)
    await saveChild({ name: baby.name.trim(), birth_date: baby.birth || null, sex: baby.sex ?? null })
    setBusy(false)
    setStep('share')
  }

  const check = async () => {
    setBusy(true)
    setError(null)
    const res = await rpc('join_family', { p_code: code, p_display_name: await myName(), p_confirm: false })
    setBusy(false)
    if (!res.ok) {
      const left = typeof res.attempts_left === 'number' && res.error === 'invalid_code' ? ` ${res.attempts_left} tries left this hour.` : ''
      setError((JOIN_ERRORS[res.error ?? ''] ?? `Couldn’t check the code: ${res.error}`) + left)
      return
    }
    setPreview(res.preview as typeof preview)
    setStep('preview')
  }

  const join = async () => {
    setBusy(true)
    setError(null)
    const res = await rpc('join_family', { p_code: code, p_display_name: await myName(), p_confirm: true })
    setBusy(false)
    if (!res.ok) {
      setError(JOIN_ERRORS[res.error ?? ''] ?? `Couldn’t join: ${res.error}`)
      setStep('join')
      return
    }
    await bootstrap()
  }

  const shareCode = async () => {
    const text = `Join our family on Leela to log the baby’s day together. Our family code is ${newCode}.\n${window.location.origin}${window.location.pathname}`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join our family on Leela', text })
        return
      } catch {
        /* cancelled */
      }
    }
    await navigator.clipboard.writeText(text)
    useLeela.getState().toast({ text: 'Invite copied. Paste it into WhatsApp or a message.' })
  }

  return (
    <main className="safe-top mx-auto flex min-h-dvh max-w-[480px] flex-col px-6 pb-10">
      <div className="pt-8 pb-6">
        <LeelaMark className="h-12 w-12" />
      </div>

      {removed && step === 'choose' && (
        <p className="mb-5 rounded-2xl bg-card px-4 py-3 text-[15px] text-ink-2">You’re no longer in that family. Start a new one or join with a code.</p>
      )}

      {step === 'choose' && (
        <>
          <h1 className="font-display text-[36px] font-extrabold leading-tight">Set up your family</h1>
          <p className="mt-2 text-[17px] text-ink-2">Everyone who joins with the same code sees the same baby, live.</p>
          <div className="mt-8 flex flex-col gap-3">
            <ChoiceCard
              icon={<HouseSimple size={30} weight="duotone" />}
              title="Start a new family"
              text="You’ll get a family code to share with your partner and helpers."
              onClick={() => setStep('start')}
            />
            <ChoiceCard
              icon={<UsersThree size={30} weight="duotone" />}
              title="I have a family code"
              text="Join the family someone already set up."
              onClick={() => setStep('join')}
            />
          </div>
        </>
      )}

      {step === 'start' && (
        <>
          <h1 className="font-display text-[32px] font-extrabold leading-tight">Name your family</h1>
          <p className="mt-2 mb-6 text-[17px] text-ink-2">People joining will see this name before they confirm.</p>
          <TextInput label="Family name" value={familyName} onChange={(e) => setFamilyName(e.target.value)} placeholder="e.g. The Goels" maxLength={60} autoFocus />
          {error && <ErrorText>{error}</ErrorText>}
          <Button className="w-full" onClick={() => void create()} disabled={busy}>
            {busy ? 'Creating…' : 'Create family'}
          </Button>
          <BackLink onClick={() => setStep('choose')} />
        </>
      )}

      {step === 'baby' && (
        <>
          <h1 className="font-display text-[32px] font-extrabold leading-tight">Add your baby</h1>
          <p className="mt-2 mb-6 text-[17px] text-ink-2">You can add another child later.</p>
          <TextInput label="Name" value={baby.name} onChange={(e) => setBaby({ ...baby, name: e.target.value })} placeholder="Baby’s name" maxLength={40} autoFocus />
          <TextInput label="Birth date" type="date" value={baby.birth} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBaby({ ...baby, birth: e.target.value })} />
          <div className="mb-6">
            <div className="mb-2 text-[15px] font-semibold text-ink-2">Sex, for growth charts</div>
            <Choices
              options={[
                { id: 'female', label: 'Girl' },
                { id: 'male', label: 'Boy' },
              ]}
              value={baby.sex}
              onChange={(v) => setBaby({ ...baby, sex: v })}
              columns={2}
              allowNone
            />
          </div>
          {error && <ErrorText>{error}</ErrorText>}
          <Button className="w-full" onClick={() => void addBaby()} disabled={busy || !baby.name.trim()}>
            {busy ? 'Saving…' : 'Continue'}
          </Button>
          <button type="button" onClick={() => setStep('share')} className="mt-4 text-[15px] font-semibold text-ink-2">
            Expecting? Skip for now
          </button>
        </>
      )}

      {step === 'share' && (
        <>
          <h1 className="font-display text-[32px] font-extrabold leading-tight">Invite your family</h1>
          <p className="mt-2 text-[17px] text-ink-2">Share this code. Whoever enters it once can see and log everything, live, on their own phone.</p>
          <div className="my-7 rounded-[28px] bg-card px-5 py-6 text-center shadow-lift">
            <div className="text-[14px] font-semibold text-ink-2">Family code</div>
            <div className="num mt-1 text-[34px] font-extrabold tracking-wide" aria-label={newCode.split('').join(' ')}>
              {newCode}
            </div>
          </div>
          <Button className="w-full" onClick={() => void shareCode()}>
            <ShareNetwork size={22} weight="bold" aria-hidden="true" /> Share invite
          </Button>
          <Button
            variant="secondary"
            className="mt-2 w-full"
            onClick={() => {
              void navigator.clipboard.writeText(newCode)
              useLeela.getState().toast({ text: 'Code copied.' })
            }}
          >
            <Copy size={20} weight="bold" aria-hidden="true" /> Copy code
          </Button>
          <Button variant="ghost" className="mt-4 w-full" onClick={() => useLeela.getState().set({ onboarding: false, tab: 'today' })}>
            Go to Leela
          </Button>
          <p className="mt-2 text-center text-[14px] text-ink-3">The code is always in the Family tab, and the owner can reset it.</p>
        </>
      )}

      {step === 'join' && (
        <>
          <h1 className="font-display text-[32px] font-extrabold leading-tight">Enter the family code</h1>
          <p className="mt-2 mb-6 text-[17px] text-ink-2">It looks like LEELA-7KQ2-9XPM. You only enter it once.</p>
          <div className="mb-5">
            <label htmlFor="code" className="mb-2 block text-[15px] font-semibold text-ink-2">
              Family code
            </label>
            <div className="flex h-16 items-center gap-2 rounded-2xl border border-line bg-card px-4 focus-within:border-brand">
              <span className="num text-[24px] font-bold text-ink-3">LEELA-</span>
              <input
                id="code"
                value={code}
                onChange={(e) => setCode(formatCode(e.target.value))}
                placeholder="XXXX-XXXX"
                autoCapitalize="characters"
                autoComplete="off"
                autoFocus
                className="num min-w-0 flex-1 bg-transparent text-[24px] font-bold tracking-wide outline-none placeholder:text-ink-3/50"
              />
            </div>
          </div>
          {error && <ErrorText>{error}</ErrorText>}
          <Button className="w-full" onClick={() => void check()} disabled={busy || code.replace('-', '').length !== 8}>
            {busy ? 'Checking…' : 'Check code'}
          </Button>
          <BackLink onClick={() => setStep('choose')} />
        </>
      )}

      {step === 'preview' && preview && (
        <>
          <h1 className="font-display text-[32px] font-extrabold leading-tight">Join {preview.family_name || 'this family'}?</h1>
          <div className="my-6 rounded-[28px] bg-card p-5 shadow-lift">
            <dl className="space-y-3 text-[16px]">
              <div>
                <dt className="text-[14px] font-semibold text-ink-2">Members</dt>
                <dd>{preview.members.join(', ')}</dd>
              </div>
              <div>
                <dt className="text-[14px] font-semibold text-ink-2">Babies</dt>
                <dd>{preview.children.length ? preview.children.join(', ') : 'None added yet'}</dd>
              </div>
            </dl>
          </div>
          {error && <ErrorText>{error}</ErrorText>}
          <Button className="w-full" onClick={() => void join()} disabled={busy}>
            {busy ? 'Joining…' : 'Join family'}
          </Button>
          <BackLink onClick={() => setStep('join')} label="That’s not my family" />
        </>
      )}

      <button
        type="button"
        onClick={() => void supabase.auth.signOut().then(() => bootstrap())}
        className="mt-auto pt-10 text-center text-[14px] font-medium text-ink-3"
      >
        Sign out
      </button>
    </main>
  )
}

function ChoiceCard({ icon, title, text, onClick }: { icon: React.ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={clsx('flex items-start gap-4 rounded-[26px] bg-card p-5 text-left shadow-lift active:scale-[0.99]')}>
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand text-brand-ink">{icon}</span>
      <span>
        <span className="block font-display text-[21px] font-bold leading-tight">{title}</span>
        <span className="block text-[15px] text-ink-2">{text}</span>
      </span>
    </button>
  )
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 rounded-2xl bg-[var(--health-soft)] px-4 py-3 text-[15px] font-medium text-[var(--health)]" role="alert">
      {children}
    </p>
  )
}

function BackLink({ onClick, label = 'Back' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="mt-4 text-[15px] font-semibold text-ink-2">
      {label}
    </button>
  )
}
