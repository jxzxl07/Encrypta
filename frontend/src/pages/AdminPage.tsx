import clsx from 'clsx'
import { Activity, ArrowLeft, LogOut, MessageSquare, RefreshCw, Search, ShieldCheck, Users, UsersRound } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { relative } from '../lib/format'
import { Avatar, Button, ErrorNote, Field, IconButton, Logo, Spinner } from '../components/ui'

const TOKEN_KEY = 'encrypta.admin'

interface AdminUser {
  id: string
  username: string
  display_name: string
  email: string
  email_verified: boolean
  created_at: string
  last_seen_at: string | null
  online: boolean
  sessions: { ip: string; user_agent: string; connected_at: string }[]
}

interface Overview {
  generated_at: string
  stats: { users: number; verified: number; online: number; sessions: number; connections: number; groups: number; messages: number }
  users: AdminUser[]
}

function readToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(readToken)

  const save = (t: string | null) => {
    try {
      if (t) sessionStorage.setItem(TOKEN_KEY, t)
      else sessionStorage.removeItem(TOKEN_KEY)
    } catch {
      /* tab-only session */
    }
    setToken(t)
  }

  return token ? <Dashboard token={token} onSignOut={() => save(null)} /> : <AdminLogin onToken={save} />
}

function AdminLogin({ onToken }: { onToken: (t: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { access_token } = await api<{ access_token: string }>('/api/admin/login', { method: 'POST', json: { username, password } })
      onToken(access_token)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative grid min-h-full place-items-center px-4 py-10">
      <div className="aurora" />
      <form onSubmit={submit} className="glass relative w-full max-w-sm animate-rise space-y-5 rounded-3xl p-7 shadow-2xl">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <div className="font-semibold">Encrypta Admin</div>
            <div className="text-xs text-ink-400">Accounts and live presence</div>
          </div>
        </div>
        <Field label="Admin username" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
        <Field label="Admin password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" className="w-full" loading={busy}>
          Sign in
        </Button>
        <Link to="/" className="flex items-center justify-center gap-1.5 text-sm text-ink-400 hover:text-ink-200">
          <ArrowLeft className="h-4 w-4" /> Back to Encrypta
        </Link>
      </form>
    </div>
  )
}

type Filter = 'all' | 'online' | 'offline' | 'unverified'

function Dashboard({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      setData(await api<Overview>('/api/admin/overview', { token }))
      setError('')
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onSignOut()
      else setError((e as Error).message)
    } finally {
      setRefreshing(false)
    }
  }, [token, onSignOut])

  useEffect(() => {
    void load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])

  const users = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    return data.users
      .filter((u) =>
        filter === 'online' ? u.online : filter === 'offline' ? !u.online && u.email_verified : filter === 'unverified' ? !u.email_verified : true,
      )
      .filter((u) => !q || u.username.includes(q) || u.display_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .sort((a, b) => Number(b.online) - Number(a.online) || (b.last_seen_at ?? '').localeCompare(a.last_seen_at ?? ''))
  }, [data, filter, query])

  return (
    <div className="relative min-h-full">
      <div className="aurora" />
      <header className="glass sticky top-0 z-20 border-x-0 border-t-0">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Logo size={32} />
          <div className="flex-1">
            <div className="font-semibold">Encrypta Admin</div>
            <div className="flex items-center gap-1.5 text-xs text-ink-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Live · refreshes every 5s
            </div>
          </div>
          <IconButton label="Refresh" onClick={() => void load()}>
            <RefreshCw className={clsx('h-4 w-4', refreshing && 'animate-spin')} />
          </IconButton>
          <Button variant="subtle" className="h-9" onClick={onSignOut}>
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl px-4 py-8">
        <ErrorNote>{error}</ErrorNote>
        {!data ? (
          <div className="grid place-items-center py-24">
            <Spinner className="h-7 w-7" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat icon={<Users className="h-4 w-4" />} label="Signed up" value={data.stats.users} sub={`${data.stats.verified} verified`} />
              <Stat
                icon={<Activity className="h-4 w-4" />}
                label="Online now"
                value={data.stats.online}
                sub={`${data.stats.sessions} session${data.stats.sessions === 1 ? '' : 's'}`}
                accent
              />
              <Stat icon={<UsersRound className="h-4 w-4" />} label="Connections" value={data.stats.connections} sub={`${data.stats.groups} groups`} />
              <Stat icon={<MessageSquare className="h-4 w-4" />} label="Messages" value={data.stats.messages} sub="all ciphertext" />
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex gap-1 rounded-xl bg-white/[0.04] p-1">
                {(['all', 'online', 'offline', 'unverified'] as Filter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={clsx(
                      'rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition',
                      filter === f ? 'bg-brand-500/25 text-white' : 'text-ink-400 hover:text-ink-100',
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <div className="relative sm:ml-auto sm:w-72">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search users"
                  className="h-10 w-full rounded-xl bg-white/[0.05] pr-3 pl-9 text-sm placeholder:text-ink-400 outline-none focus:ring-1 focus:ring-brand-400/50"
                />
              </div>
            </div>

            <div className="glass mt-4 overflow-hidden rounded-2xl">
              <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,2fr)_1fr_1fr_1fr] gap-4 border-b border-white/[0.06] px-5 py-3 text-[11px] font-semibold tracking-wider text-ink-400 uppercase md:grid">
                <span>User</span>
                <span>Email</span>
                <span>Status</span>
                <span>Last seen</span>
                <span>Joined</span>
              </div>
              {users.length === 0 && <p className="px-5 py-10 text-center text-sm text-ink-400">No users match.</p>}
              {users.map((u) => (
                <div
                  key={u.id}
                  className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 border-b border-white/[0.04] px-5 py-3.5 last:border-0 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_1fr_1fr_1fr] md:gap-4"
                >
                  <div className="row-span-3 flex min-w-0 items-center gap-3 md:row-span-1">
                    <Avatar name={u.display_name} seed={u.username} size={38} online={u.online} />
                    <div className="hidden min-w-0 md:block">
                      <div className="truncate text-sm font-medium">{u.display_name}</div>
                      <div className="truncate text-xs text-ink-400">@{u.username}</div>
                    </div>
                  </div>
                  <div className="min-w-0 md:hidden">
                    <div className="truncate text-sm font-medium">
                      {u.display_name} <span className="text-ink-400">@{u.username}</span>
                    </div>
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5 text-sm text-ink-300">
                    <span className="truncate">{u.email}</span>
                    {u.email_verified && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-label="Email verified" />}
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    {!u.email_verified ? (
                      <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-xs font-medium text-amber-300">Unverified</span>
                    ) : u.online ? (
                      <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2 py-0.5 text-xs font-medium text-emerald-300" title={u.sessions.map((s) => `${s.ip} · ${s.user_agent}`).join('\n')}>
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        Online{u.sessions.length > 1 && ` · ${u.sessions.length}`}
                      </span>
                    ) : (
                      <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-xs font-medium text-ink-400">Offline</span>
                    )}
                    <span className="text-xs text-ink-400 md:hidden">{u.online ? '' : relative(u.last_seen_at)}</span>
                  </div>
                  <div className="hidden text-sm text-ink-300 md:block">{u.online ? 'now' : relative(u.last_seen_at)}</div>
                  <div className="hidden text-sm text-ink-300 md:block">{new Date(u.created_at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-center text-xs text-ink-400">Message contents are end-to-end encrypted and are not visible here.</p>
          </>
        )}
      </main>
    </div>
  )
}

function Stat({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: number; sub: string; accent?: boolean }) {
  return (
    <div className={clsx('glass rounded-2xl p-4 sm:p-5', accent && 'border-emerald-400/20!')}>
      <div className={clsx('flex items-center gap-2 text-xs font-medium', accent ? 'text-emerald-300' : 'text-ink-400')}>
        {icon} {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value.toLocaleString()}</div>
      <div className="mt-0.5 text-xs text-ink-400">{sub}</div>
    </div>
  )
}
