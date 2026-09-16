import clsx from 'clsx'
import { ArrowLeft, Lock } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { createIdentity, deriveAccountSecrets } from '../lib/crypto'
import type { Challenge, SessionResponse } from '../lib/types'
import { useAuth } from '../store/auth'
import { Button, ErrorNote, Field, Logo } from '../components/ui'

type Mode = 'login' | 'signup'

export default function AuthPage({ initialMode = 'login' }: { initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const wrapKey = useRef<CryptoKey | null>(null)

  const onChallenge = (c: Challenge, k: CryptoKey) => {
    wrapKey.current = k
    setChallenge(c)
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center gap-2.5 px-6 py-5">
        <Logo size={24} />
        <span className="text-[15px] font-semibold">Encrypta</span>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pt-[6vh] pb-10">
        <div className="w-full max-w-[380px]">
          <div className="surface rounded-lg p-6 sm:p-7">
            {challenge ? (
              <OtpStep challenge={challenge} onChallenge={setChallenge} wrapKey={wrapKey.current!} onBack={() => setChallenge(null)} />
            ) : mode === 'login' ? (
              <LoginForm onChallenge={onChallenge} onSwitch={() => setMode('signup')} />
            ) : (
              <SignupForm onChallenge={onChallenge} onSwitch={() => setMode('login')} />
            )}
          </div>
          <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-ink-400">
            <Lock className="h-3 w-3" />
            End-to-end encrypted. Your password never leaves this device.
          </p>
        </div>
      </main>

      <footer className="px-6 py-5 text-center text-xs text-ink-400">
        <Link to="/admin" className="hover:text-ink-200">
          Administrator console
        </Link>
      </footer>
    </div>
  )
}

function Heading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-ink-300">{children}</p>
    </div>
  )
}

function SwitchLink({ prompt, action, onClick }: { prompt: string; action: string; onClick: () => void }) {
  return (
    <p className="pt-1 text-center text-sm text-ink-400">
      {prompt}{' '}
      <button type="button" onClick={onClick} className="font-medium text-brand-400 hover:text-brand-300">
        {action}
      </button>
    </p>
  )
}

function LoginForm({ onChallenge, onSwitch }: { onChallenge: (c: Challenge, k: CryptoKey) => void; onSwitch: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      setBusy('Deriving keys…')
      const secrets = await deriveAccountSecrets(username, password)
      setBusy('Signing in…')
      const challenge = await api<Challenge>('/api/auth/login', {
        method: 'POST',
        json: { username: username.trim().toLowerCase(), auth_secret: secrets.authSecret },
      })
      onChallenge(challenge, secrets.wrapKey)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Heading title="Sign in">We'll email you a one-time code to confirm it's you.</Heading>
      <Field label="Username" autoComplete="username" autoCapitalize="none" required value={username} onChange={(e) => setUsername(e.target.value)} />
      <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" className="w-full" loading={!!busy}>
        {busy ?? 'Continue'}
      </Button>
      <SwitchLink prompt="No account?" action="Create one" onClick={onSwitch} />
    </form>
  )
}

function passwordStrength(pw: string) {
  let score = 0
  if (pw.length >= 10) score++
  if (pw.length >= 14) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  return Math.min(4, score)
}

const STRENGTH = ['Weak', 'Fair', 'Good', 'Strong']

function SignupForm({ onChallenge, onSwitch }: { onChallenge: (c: Challenge, k: CryptoKey) => void; onSwitch: () => void }) {
  const [form, setForm] = useState({ display_name: '', username: '', email: '', password: '', confirm: '' })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  const usernameValid = /^[a-z0-9_]{3,32}$/.test(form.username)
  const strength = passwordStrength(form.password)
  const mismatch = form.confirm.length > 0 && form.confirm !== form.password

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!usernameValid) return setError('Usernames are 3–32 lowercase letters, numbers or underscores.')
    if (form.password.length < 10) return setError('Use a password of at least 10 characters.')
    if (mismatch) return setError("Passwords don't match.")
    try {
      setBusy('Generating keys…')
      const secrets = await deriveAccountSecrets(form.username, form.password)
      const identity = await createIdentity(secrets.wrapKey)
      setBusy('Creating account…')
      const challenge = await api<Challenge>('/api/auth/signup', {
        method: 'POST',
        json: {
          username: form.username,
          display_name: form.display_name || form.username,
          email: form.email,
          auth_secret: secrets.authSecret,
          ...identity,
        },
      })
      onChallenge(challenge, secrets.wrapKey)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Heading title="Create an account">Your encryption keys are generated on this device.</Heading>
      <Field label="Name" autoComplete="name" value={form.display_name} onChange={set('display_name')} maxLength={64} />
      <Field
        label="Username"
        autoComplete="username"
        autoCapitalize="none"
        required
        value={form.username}
        onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase().replace(/\s/g, '') })}
        maxLength={32}
        hint="Others find you by this. Lowercase letters, numbers and underscores."
        error={form.username && !usernameValid ? '3–32 characters: a–z, 0–9 or _' : undefined}
      />
      <Field label="Email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} hint="Used for sign-in codes." />
      <div>
        <Field label="Password" type="password" autoComplete="new-password" required value={form.password} onChange={set('password')} hint="At least 10 characters." />
        {form.password && (
          <div className="mt-2 flex items-center gap-2">
            <div className="flex flex-1 gap-1">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={clsx('h-0.5 flex-1 rounded-full', i < strength ? 'bg-ink-200' : 'bg-white/[0.08]')} />
              ))}
            </div>
            <span className="w-12 text-right text-xs text-ink-400">{STRENGTH[Math.max(0, strength - 1)]}</span>
          </div>
        )}
      </div>
      <Field label="Confirm password" type="password" autoComplete="new-password" required value={form.confirm} onChange={set('confirm')} error={mismatch ? "Passwords don't match" : undefined} />
      <p className="text-xs leading-relaxed text-ink-400">
        Your password also unlocks your encryption key. If you forget it, your existing messages can't be recovered.
      </p>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" className="w-full" loading={!!busy}>
        {busy ?? 'Create account'}
      </Button>
      <SwitchLink prompt="Already have an account?" action="Sign in" onClick={onSwitch} />
    </form>
  )
}

function OtpStep({
  challenge,
  onChallenge,
  wrapKey,
  onBack,
}: {
  challenge: Challenge
  onChallenge: (c: Challenge) => void
  wrapKey: CryptoKey
  onBack: () => void
}) {
  const [digits, setDigits] = useState(['', '', '', '', '', ''])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(30)
  const inputs = useRef<(HTMLInputElement | null)[]>([])
  const completeSession = useAuth((s) => s.completeSession)

  useEffect(() => {
    inputs.current[0]?.focus()
  }, [challenge.challenge_id])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function verify(code: string) {
    setBusy(true)
    setError('')
    try {
      const session = await api<SessionResponse>('/api/auth/otp/verify', {
        method: 'POST',
        json: { challenge_id: challenge.challenge_id, code },
      })
      await completeSession(session, wrapKey)
    } catch (err) {
      const msg = err instanceof DOMException ? 'Could not unlock your keys with this password.' : (err as Error).message
      setError(msg)
      setDigits(['', '', '', '', '', ''])
      inputs.current[0]?.focus()
    } finally {
      setBusy(false)
    }
  }

  function update(index: number, value: string) {
    const clean = value.replace(/\D/g, '')
    if (clean.length > 1) {
      const next = clean.slice(0, 6).split('')
      const filled = [...next, ...Array(6 - next.length).fill('')]
      setDigits(filled)
      inputs.current[Math.min(5, next.length)]?.focus()
      if (next.length === 6) void verify(next.join(''))
      return
    }
    const next = [...digits]
    next[index] = clean
    setDigits(next)
    if (clean && index < 5) inputs.current[index + 1]?.focus()
    if (next.every(Boolean)) void verify(next.join(''))
  }

  async function resend() {
    setError('')
    try {
      onChallenge(await api<Challenge>('/api/auth/otp/resend', { method: 'POST', json: { challenge_id: challenge.challenge_id } }))
      setCooldown(30)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="-ml-0.5 flex items-center gap-1 text-sm text-ink-400 hover:text-ink-100">
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </button>
      <Heading title={challenge.purpose === 'verify' ? 'Verify your email' : 'Enter your code'}>
        We sent a 6-digit code to <span className="text-ink-100">{challenge.email_hint}</span>.
      </Heading>
      <div className="flex justify-between gap-2">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              inputs.current[i] = el
            }}
            value={d}
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            aria-label={`Digit ${i + 1}`}
            disabled={busy}
            onChange={(e) => update(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !d && i > 0) inputs.current[i - 1]?.focus()
            }}
            className="h-11 w-full min-w-0 rounded-md border border-white/[0.09] bg-ink-850 text-center font-mono text-lg text-ink-100 transition-colors outline-none focus:border-brand-500"
          />
        ))}
      </div>
      <ErrorNote>{error}</ErrorNote>
      <Button className="w-full" loading={busy} disabled={!digits.every(Boolean)} onClick={() => verify(digits.join(''))}>
        Verify
      </Button>
      <p className="text-center text-sm text-ink-400">
        {cooldown > 0 ? (
          <span>Resend code in {cooldown}s</span>
        ) : (
          <button onClick={resend} className="font-medium text-brand-400 hover:text-brand-300">
            Resend code
          </button>
        )}
      </p>
    </div>
  )
}
