import { Check, Clock, Loader2, MessageCircle, Search, UserPlus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { relative } from '../lib/format'
import { useChat } from '../store/chat'
import { Avatar, IconButton } from './ui'

interface SearchResult {
  id: string
  username: string
  display_name: string
  status: 'none' | 'connected' | 'outgoing' | 'incoming'
}

export default function PeoplePanel({ onOpenChat }: { onOpenChat: (userId: string) => void }) {
  const { contacts, incoming, outgoing, online, lastSeen, loadConnections } = useChat()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const q = query.trim().replace(/^@/, '')
    if (!q) {
      setResults(null)
      return
    }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        setResults(await api<SearchResult[]>(`/api/users/search?q=${encodeURIComponent(q)}`))
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [query, contacts.length, incoming.length, outgoing.length])

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id)
    setError('')
    try {
      await fn()
      await loadConnections()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const request = (username: string, id: string) => act(id, () => api('/api/connections', { method: 'POST', json: { username } }))
  const accept = (connectionId: string) => act(connectionId, () => api(`/api/connections/${connectionId}/accept`, { method: 'POST' }))
  const remove = (connectionId: string) => act(connectionId, () => api(`/api/connections/${connectionId}`, { method: 'DELETE' }))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="px-3 pt-4 pb-2">
        <h1 className="px-1 text-[15px] font-semibold">People</h1>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find by username"
            autoCapitalize="none"
            className="h-9 w-full rounded-md border border-white/[0.07] bg-ink-850 pr-9 pl-9 text-sm placeholder:text-ink-400 outline-none focus:border-brand-500"
          />
          {searching && <Loader2 className="absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin text-ink-400" />}
        </div>
        {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {results !== null ? (
          <Section title="Results">
            {results.length === 0 && !searching && <Empty>No one found with that username.</Empty>}
            {results.map((r) => (
              <PersonRow key={r.id} name={r.display_name} username={r.username}>
                {r.status === 'connected' && (
                  <IconButton label="Message" onClick={() => onOpenChat(r.id)}>
                    <MessageCircle className="h-[18px] w-[18px]" />
                  </IconButton>
                )}
                {r.status === 'outgoing' && (
                  <span className="flex items-center gap-1 pr-2 text-xs text-ink-400">
                    <Clock className="h-3.5 w-3.5" /> Sent
                  </span>
                )}
                {(r.status === 'none' || r.status === 'incoming') && (
                  <button
                    disabled={busy === r.id}
                    onClick={() => request(r.username, r.id)}
                    className="flex h-8 items-center gap-1.5 rounded-md border border-white/[0.09] bg-ink-850 px-2.5 text-xs font-medium text-ink-100 transition-colors hover:bg-ink-800 disabled:opacity-50"
                  >
                    {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                    {r.status === 'incoming' ? 'Accept' : 'Connect'}
                  </button>
                )}
              </PersonRow>
            ))}
          </Section>
        ) : (
          <>
            {incoming.length > 0 && (
              <Section title={`Requests · ${incoming.length}`}>
                {incoming.map((c) => (
                  <PersonRow key={c.connection_id} name={c.user.display_name} username={c.user.username} sub={`wants to connect · ${relative(c.since)}`}>
                    <IconButton label="Decline" disabled={busy === c.connection_id} onClick={() => remove(c.connection_id)} className="hover:text-rose-300">
                      <X className="h-[18px] w-[18px]" />
                    </IconButton>
                    <IconButton
                      label="Accept"
                      disabled={busy === c.connection_id}
                      onClick={() => accept(c.connection_id)}
                      className="text-ink-100 hover:bg-white/[0.08]"
                    >
                      <Check className="h-[18px] w-[18px]" />
                    </IconButton>
                  </PersonRow>
                ))}
              </Section>
            )}

            {outgoing.length > 0 && (
              <Section title="Pending">
                {outgoing.map((c) => (
                  <PersonRow key={c.connection_id} name={c.user.display_name} username={c.user.username} sub="request sent">
                    <button onClick={() => remove(c.connection_id)} className="px-2 text-xs font-medium text-ink-400 hover:text-rose-300">
                      Cancel
                    </button>
                  </PersonRow>
                ))}
              </Section>
            )}

            <Section title={`Connections · ${contacts.length}`}>
              {contacts.length === 0 && <Empty>Search for a username above to send your first connection request.</Empty>}
              {contacts.map((c) => (
                <PersonRow
                  key={c.connection_id}
                  name={c.user.display_name}
                  username={c.user.username}
                  online={online[c.user.id]}
                  sub={online[c.user.id] ? 'online' : `last seen ${relative(lastSeen[c.user.id])}`}
                >
                  <IconButton label="Message" onClick={() => onOpenChat(c.user.id)}>
                    <MessageCircle className="h-[18px] w-[18px]" />
                  </IconButton>
                </PersonRow>
              ))}
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="px-2 pt-2 pb-1 text-xs font-medium text-ink-400">{title}</h3>
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-2 text-sm text-ink-400">{children}</p>
}

function PersonRow({
  name,
  username,
  sub,
  online,
  children,
}: {
  name: string
  username: string
  sub?: string
  online?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-white/[0.03]">
      <Avatar name={name} seed={username} size={36} online={online} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="truncate text-xs text-ink-400">
          @{username}
          {sub && ` · ${sub}`}
        </div>
      </div>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  )
}
