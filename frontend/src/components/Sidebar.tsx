import clsx from 'clsx'
import { LogOut, MessageSquarePlus, MessagesSquare, Search, ShieldCheck, UserPlus, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { shortStamp } from '../lib/format'
import type { ConversationKey } from '../lib/types'
import { useAuth } from '../store/auth'
import { useChat } from '../store/chat'
import { Avatar, IconButton, Logo } from './ui'

export type Panel = 'chats' | 'people'

interface Row {
  key: ConversationKey
  name: string
  seed: string
  group: boolean
  online?: boolean
  preview: string
  at: string
  unread: number
}

export default function Sidebar({
  panel,
  onPanel,
  onNewGroup,
  onProfile,
  peopleSlot,
}: {
  panel: Panel
  onPanel: (p: Panel) => void
  onNewGroup: () => void
  onProfile: () => void
  peopleSlot: React.ReactNode
}) {
  const account = useAuth((s) => s.account)!
  const logout = useAuth((s) => s.logout)
  const { contacts, groups, latest, unread, online, active, open, incoming, typing } = useChat()
  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    const out: Row[] = []
    for (const c of contacts) {
      const key: ConversationKey = `dm:${c.user.id}`
      const last = latest[key]
      out.push({
        key,
        name: c.user.display_name,
        seed: c.user.username,
        group: false,
        online: online[c.user.id],
        preview: last ? `${last.sender_id === account.id ? 'You: ' : ''}${last.text}` : `@${c.user.username}`,
        at: last?.created_at ?? c.since,
        unread: unread[key] ?? 0,
      })
    }
    for (const g of groups) {
      const key: ConversationKey = `g:${g.id}`
      const last = latest[key]
      const sender = last && (last.sender_id === account.id ? 'You' : g.members.find((m) => m.id === last.sender_id)?.display_name.split(' ')[0])
      out.push({
        key,
        name: g.name,
        seed: g.id,
        group: true,
        preview: last ? `${sender ?? 'Someone'}: ${last.text}` : `${g.members.length} members`,
        at: last?.created_at ?? g.created_at,
        unread: unread[key] ?? 0,
      })
    }
    const q = query.trim().toLowerCase()
    return out
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.seed.includes(q))
      .sort((a, b) => b.at.localeCompare(a.at))
  }, [contacts, groups, latest, unread, online, account.id, query])

  const now = Date.now()

  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-[68px] shrink-0 flex-col items-center gap-2 border-r border-white/[0.05] bg-ink-950/60 py-4">
        <Logo size={34} />
        <div className="mt-5 flex flex-col gap-1.5">
          <RailButton label="Chats" active={panel === 'chats'} onClick={() => onPanel('chats')}>
            <MessagesSquare className="h-5 w-5" />
          </RailButton>
          <RailButton label="People" active={panel === 'people'} onClick={() => onPanel('people')} badge={incoming.length}>
            <Users className="h-5 w-5" />
          </RailButton>
        </div>
        <div className="mt-auto flex flex-col items-center gap-2">
          <IconButton label="Sign out" onClick={() => void logout()}>
            <LogOut className="h-[18px] w-[18px]" />
          </IconButton>
          <button onClick={onProfile} aria-label="Your profile and keys" title="Your profile and keys" className="rounded-full focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none">
            <Avatar name={account.display_name} seed={account.username} size={38} />
          </button>
        </div>
      </nav>

      <section className="flex min-w-0 flex-1 flex-col bg-ink-900/70">
        {panel === 'people' ? (
          peopleSlot
        ) : (
          <>
            <header className="px-4 pt-5 pb-3">
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-semibold tracking-tight">Chats</h1>
                <div className="flex gap-0.5">
                  <IconButton label="Add a connection" onClick={() => onPanel('people')}>
                    <UserPlus className="h-[18px] w-[18px]" />
                  </IconButton>
                  <IconButton label="New group" onClick={onNewGroup}>
                    <MessageSquarePlus className="h-[18px] w-[18px]" />
                  </IconButton>
                </div>
              </div>
              <div className="relative mt-3">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search conversations"
                  className="h-10 w-full rounded-xl border border-transparent bg-white/[0.05] pr-3 pl-9 text-sm placeholder:text-ink-400 outline-none focus:border-brand-400/50"
                />
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {rows.length === 0 && (
                <div className="mx-3 mt-8 rounded-2xl border border-dashed border-white/10 p-6 text-center">
                  <ShieldCheck className="mx-auto h-8 w-8 text-brand-300" />
                  <p className="mt-3 text-sm font-medium">{query ? 'No matches' : 'No conversations yet'}</p>
                  {!query && (
                    <>
                      <p className="mt-1 text-xs text-ink-400">Add someone by their username to start an encrypted chat.</p>
                      <button onClick={() => onPanel('people')} className="mt-4 text-sm font-semibold text-brand-300 hover:text-brand-200">
                        Find people
                      </button>
                    </>
                  )}
                </div>
              )}
              {rows.map((r) => {
                const isTyping = Object.values(typing[r.key] ?? {}).some((exp) => exp > now)
                return (
                  <button
                    key={r.key}
                    onClick={() => open(r.key)}
                    className={clsx(
                      'group flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition',
                      active === r.key ? 'bg-brand-500/[0.14]' : 'hover:bg-white/[0.04]',
                    )}
                  >
                    <Avatar name={r.name} seed={r.seed} size={46} online={r.online} group={r.group} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[15px] font-medium">{r.name}</span>
                        <span className={clsx('shrink-0 text-[11px]', r.unread ? 'text-glow' : 'text-ink-400')}>{shortStamp(r.at)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <span className={clsx('truncate text-[13px]', isTyping ? 'text-glow' : r.unread ? 'text-ink-100' : 'text-ink-400')}>
                          {isTyping ? 'typing…' : r.preview}
                        </span>
                        {r.unread > 0 && (
                          <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-glow px-1.5 text-[11px] font-bold text-ink-950">
                            {r.unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function RailButton({
  label,
  active,
  badge,
  onClick,
  children,
}: {
  label: string
  active: boolean
  badge?: number
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={clsx(
        'relative grid h-11 w-11 place-items-center rounded-2xl transition focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none',
        active ? 'bg-brand-500/20 text-brand-200' : 'text-ink-400 hover:bg-white/[0.05] hover:text-ink-100',
      )}
    >
      {children}
      {!!badge && (
        <span className="absolute -top-0.5 -right-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-ink-950">
          {badge}
        </span>
      )}
    </button>
  )
}
