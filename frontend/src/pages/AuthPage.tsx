import { ArrowLeft, Globe2, KeyRound, Lock, MailCheck, ShieldCheck, Video } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
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

  return (
    <div className="relative flex min-h-full">
      <div className="aurora" />
      <aside className="relative hidden w-[46%] flex-col justify-between overflow-hidden border-r border-white/[0.05] p-12 lg:flex">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="text-lg font-semibold tracking-tight">Encrypta</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-5xl leading-[1.05] font-semibold tracking-tight">
            Talk to anyone, <span className="text-gradient">anywhere.</span>
            <br />
            Only they can listen.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-ink-300">
            Messages, groups and calls are encrypted on your device before they leave it. Our servers carry them. They can't read them.
          </p>
          <ul className="mt-10 space-y-4 text-sm text-ink-200">
            {[
              [Lock, 'Direct messages sealed with X25519 public-key encryption'],
              [KeyRound, 'Group chats share one AES-256 key that only members hold'],
              [Video, 'Peer-to-peer voice and video calls over WebRTC'],
              [Globe2, 'Works across any network, in any country'],
            ].map(([Icon, text], i) => {
              const I = Icon as typeof Lock
              return (
                <li key={i} className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.05] text-brand-300">
                    <I className="h-4 w-4" />
                  </span>
                  {text as string}
                </li>
              )
            })}
          </ul>
        </div>
        <p className="text-xs text-ink-400">Your password never leaves this device. Nor does your private key, unencrypted.</p>
      </aside>

      <main className="relative flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[400px] animate-rise">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo />
            <span className="text-lg font-semibold tracking-tight">Encrypta</span>
          </div>
          {challenge ? (
            <OtpStep
              challenge={challenge}
              onChallenge={setChallenge}
              wrapKey={wrapKey.current!}
              onBack={() => setChallenge(null)}
            />
          ) : mode === 'login' ? (
            <LoginForm
              onChallenge={(c, k) => {
                wrapKey.current = k
                setChallenge(c)
              }}
              onSwitch={() => setMode('signup')}
            />
          ) : (
            <SignupForm
              onChallenge={(c, k) => {
                wrapKey.current = k
                setChallenge(c)
              }}
              onSwitch={() => setMode('login')}
            />
          )}
          <p className="mt-8 text-center text-xs text-ink-400">
            <Link to="/admin" className="hover:text-ink-200">
              Administrator console
            </Link>
          </p>
        </div>
      </main>
    </div>
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
    <form onSubmit={submit} className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
        <p className="mt-1 text-sm text-ink-300">Sign in, then confirm with the code we email you.</p>
      </div>
      <Field label="Username" autoComplete="username" autoCapitalize="none" required value={username} onChange={(e) => setUsername(e.target.value)} placeholder="yourname" />
      <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••" />
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" className="w-full" loading={!!busy}>
        {busy ?? 'Continue'}
      </Button>
      <p className="text-center text-sm text-ink-300">
        New here?{' '}
        <button type="button" onClick={onSwitch} className="font-semibold text-brand-300 hover:text-brand-200">
          Create an account
        </button>
      </p>
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

function SignupForm({ onChallenge, onSwitch }: { onChallenge: (c: Challenge, k: CryptoKey) => void; onSwitch: () => void }) {
  const [form, setForm] = useState({ display_name: '', username: '', email: '', password: '', confirm: '' })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

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
      setBusy('Generating your keys…')
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
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Create your account</h2>
        <p className="mt-1 text-sm text-ink-300">Your encryption keys are generated in this browser.</p>
      </div>
      <Field label="Name" autoComplete="name" value={form.display_name} onChange={set('display_name')} placeholder="Ada Lovelace" maxLength={64} />
      <Field
        label="Username"
        autoComplete="username"
        autoCapitalize="none"
        required
        value={form.username}
        onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase().replace(/\s/g, '') })}
        placeholder="ada"
        maxLength={32}
        hint="How people find you. Lowercase letters, numbers, underscores."
        error={form.username && !usernameValid ? 'Must be 3–32 characters: a–z, 0–9 or _' : undefined}
      />
      <Field label="Email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} placeholder="ada@example.com" hint="We'll send one-time sign-in codes here." />
      <div>
        <Field label="Password" type="password" autoComplete="new-password" required value={form.password} onChange={set('password')} placeholder="At least 10 characters" />
        <div className="mt-2 flex gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                form.password && i < strength ? ['bg-rose-400', 'bg-amber-400', 'bg-lime-400', 'bg-emerald-400'][strength - 1] : 'bg-white/[0.07]'
              }`}
            />
          ))}
        </div>
      </div>
      <Field label="Confirm password" type="password" autoComplete="new-password" required value={form.confirm} onChange={set('confirm')} error={mismatch ? "Passwords don't match" : undefined} />
      <div className="flex gap-2.5 rounded-xl bg-amber-400/[0.07] p-3 text-xs leading-relaxed text-amber-100/80">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        Your password unlocks your private key. There's no reset that keeps old messages readable, so keep it somewhere safe.
      </div>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" className="w-full" loading={!!busy}>
        {busy ?? 'Create account'}
      </Button>
      <p className="text-center text-sm text-ink-300">
        Already have an account?{' '}
        <button type="button" onClick={onSwitch} className="font-semibold text-brand-300 hover:text-brand-200">
          Sign in
        </button>
      </p>
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
    <div className="space-y-6">
      <button onClick={onBack} className="-ml-1 flex items-center gap-1.5 text-sm text-ink-300 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <div>
        <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-brand-500/15 text-brand-300">
          <MailCheck className="h-6 w-6" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">{challenge.purpose === 'verify' ? 'Verify your email' : 'Check your email'}</h2>
        <p className="mt-1 text-sm text-ink-300">
          We sent a 6-digit code to <span className="font-medium text-ink-100">{challenge.email_hint}</span>.
        </p>
      </div>
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
            className="h-14 w-full min-w-0 rounded-xl border border-white/[0.08] bg-ink-950/60 text-center font-mono text-2xl text-white transition outline-none focus:border-brand-400/70"
          />
        ))}
      </div>
      <ErrorNote>{error}</ErrorNote>
      <Button className="w-full" loading={busy} disabled={!digits.every(Boolean)} onClick={() => verify(digits.join(''))}>
        Verify
      </Button>
      <p className="text-center text-sm text-ink-400">
        Didn't get it?{' '}
        {cooldown > 0 ? (
          <span>Resend in {cooldown}s</span>
        ) : (
          <button onClick={resend} className="font-semibold text-brand-300 hover:text-brand-200">
            Send a new code
          </button>
        )}
      </p>
    </div>
  )
}
