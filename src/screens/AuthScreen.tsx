import clsx from 'clsx'
import { useState } from 'react'
import { LeelaMark } from '../components/LeelaMark'
import { Button, TextInput } from '../components/ui'
import { SUPABASE_KEY, SUPABASE_URL, backendConfigured, supabase } from '../lib/supabase'
import { bootstrap } from '../lib/sync'

const MESSAGES: Record<string, string> = {
  email_taken: 'There’s already an account with this email. Sign in instead.',
  invalid_email: 'That email doesn’t look right.',
  weak_password: 'Use at least 8 characters for your password.',
  name_required: 'Add your name so your family knows who logged what.',
  too_many_attempts: 'Too many sign-ups from this network. Try again in an hour.',
  invalid_credentials: 'That email and password don’t match.',
}

export function AuthScreen() {
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!backendConfigured) {
      setError('Leela isn’t connected to its database yet.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'new') {
        let code: string | null = null
        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
            body: JSON.stringify({ email: email.trim(), password, name: name.trim() }),
          })
          if (!res.ok) code = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'signup_failed'
        } catch {
          code = 'network'
        }
        if (code) {
          setError(MESSAGES[code] ?? 'Couldn’t create your account. Check your connection and try again.')
          return
        }
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (signInError) {
        setError(signInError.message.toLowerCase().includes('invalid') ? MESSAGES.invalid_credentials : signInError.message)
        return
      }
      await bootstrap()
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="safe-top mx-auto flex min-h-dvh max-w-[480px] flex-col px-6 pb-10">
      <div className="flex flex-1 flex-col justify-center pt-8">
        <LeelaMark className="h-16 w-16" />
        <h1 className="mt-5 font-display text-[56px] font-extrabold leading-[0.9] tracking-tight">Leela</h1>
        <p className="mt-3 max-w-[22ch] text-[19px] leading-snug text-ink-2">Your baby’s day, shared by the whole family.</p>
      </div>

      <form onSubmit={(e) => void submit(e)} className="mt-8" noValidate>
        <div className="mb-6 grid grid-cols-2 gap-1 rounded-2xl bg-card p-1 ring-1 ring-line" role="tablist">
          {(
            [
              ['new', 'Create account'],
              ['existing', 'Sign in'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              onClick={() => {
                setMode(id)
                setError(null)
              }}
              className={clsx('h-11 rounded-xl text-[15px] font-semibold', mode === id ? 'bg-brand text-brand-ink' : 'text-ink-2')}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'new' && (
          <TextInput label="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" placeholder="What your family calls you" maxLength={40} />
        )}
        <TextInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" placeholder="you@example.com" />
        <TextInput
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'new' ? 'new-password' : 'current-password'}
          placeholder={mode === 'new' ? 'At least 8 characters' : 'Your password'}
        />

        {error && (
          <p className="mb-4 rounded-2xl bg-[var(--health-soft)] px-4 py-3 text-[15px] font-medium text-[var(--health)]" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={busy || !email || password.length < (mode === 'new' ? 8 : 1) || (mode === 'new' && !name.trim())}>
          {busy ? 'One moment…' : mode === 'new' ? 'Create account' : 'Sign in'}
        </Button>
        <p className="mt-4 text-center text-[14px] text-ink-3">
          {mode === 'new' ? 'Joining a partner? Create your account, then enter their family code.' : 'Forgot your password? Create a new account and rejoin with your family code.'}
        </p>
      </form>
    </main>
  )
}
