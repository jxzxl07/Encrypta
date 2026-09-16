import clsx from 'clsx'
import { ArrowLeft, Info, Lock, Phone, SendHorizontal, ShieldAlert, Video } from 'lucide-react'
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { dayLabel, relative, timeOfDay } from '../lib/format'
import type { ChatMessage, ConversationKey } from '../lib/types'
import { useAuth } from '../store/auth'
import { useCall } from '../store/call'
import { useChat } from '../store/chat'
import { Avatar, IconButton, Spinner } from './ui'

export default function ChatView({ convKey, onBack, onInfo }: { convKey: ConversationKey; onBack: () => void; onInfo: () => void }) {
  const account = useAuth((s) => s.account)!
  const [kind, id] = convKey.split(':') as ['dm' | 'g', string]
  const contact = useChat((s) => (kind === 'dm' ? s.contacts.find((c) => c.user.id === id)?.user : undefined))
  const group = useChat((s) => (kind === 'g' ? s.groups.find((g) => g.id === id) : undefined))
  const conv = useChat((s) => s.conversations[convKey])
  const online = useChat((s) => (kind === 'dm' ? s.online[id] : undefined))
  const lastSeen = useChat((s) => (kind === 'dm' ? s.lastSeen[id] : undefined))
  const typing = useChat((s) => s.typing[convKey])
  const { send, sendTyping, loadOlder } = useChat.getState()
  const startCall = useCall((s) => s.start)
  const callPhase = useCall((s) => s.phase)

  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const lastTypingSent = useRef(0)
  const input = useRef<HTMLTextAreaElement>(null)
  const [, tick] = useState(0)

  useEffect(() => {
    setDraft('')
    setError('')
    stickToBottom.current = true
    input.current?.focus()
  }, [convKey])

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1500)
    return () => clearInterval(t)
  }, [])

  const messages = conv?.messages ?? []
  const prevHeight = useRef(0)
  const prevFirst = useRef<string | undefined>(undefined)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const first = messages[0]?.id
    if (prevFirst.current && first !== prevFirst.current && !stickToBottom.current) {
      // Older messages were prepended: keep the viewport anchored.
      el.scrollTop += el.scrollHeight - prevHeight.current
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight
    }
    prevFirst.current = first
    prevHeight.current = el.scrollHeight
  }, [messages])

  if (!contact && !group) {
    return (
      <div className="grid h-full place-items-center p-8 text-center text-ink-400">
        <div>
          <ShieldAlert className="mx-auto h-8 w-8" />
          <p className="mt-3">This conversation is no longer available.</p>
          <button onClick={onBack} className="mt-3 text-sm text-brand-300">
            Back
          </button>
        </div>
      </div>
    )
  }

  const name = contact?.display_name ?? group!.name
  const seed = contact?.username ?? group!.id
  const now = Date.now()
  const typers = Object.entries(typing ?? {})
    .filter(([, exp]) => exp > now)
    .map(([uid]) => (group ? group.members.find((m) => m.id === uid)?.display_name.split(' ')[0] : contact?.display_name.split(' ')[0]))
    .filter(Boolean)

  const subtitle = typers.length
    ? `${group ? typers.join(', ') + (typers.length > 1 ? ' are' : ' is') : ''} typing…`
    : contact
      ? online
        ? 'online'
        : `last seen ${relative(lastSeen ?? contact.last_seen_at)}`
      : `${group!.members.length} members · ${group!.members.filter((m) => useChat.getState().online[m.id] || m.id === account.id).length} online`

  async function submit() {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    setError('')
    stickToBottom.current = true
    try {
      await send(convKey, text)
    } catch (e) {
      setDraft(text)
      setError((e as Error).message)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  function onChange(value: string) {
    setDraft(value)
    if (Date.now() - lastTypingSent.current > 2500 && value) {
      lastTypingSent.current = Date.now()
      sendTyping(convKey)
    }
  }

  const callsDisabled = !contact || callPhase !== 'idle'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="glass z-10 flex h-[68px] shrink-0 items-center gap-3 border-x-0 border-t-0 px-3 sm:px-5">
        <IconButton label="Back" onClick={onBack} className="md:hidden">
          <ArrowLeft className="h-5 w-5" />
        </IconButton>
        <button onClick={onInfo} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <Avatar name={name} seed={seed} size={42} online={contact ? online : undefined} group={!!group} />
          <div className="min-w-0">
            <div className="truncate font-semibold">{name}</div>
            <div className={clsx('truncate text-xs', typers.length || online ? 'text-glow' : 'text-ink-400')}>{subtitle}</div>
          </div>
        </button>
        {contact && (
          <>
            <IconButton label="Voice call" disabled={callsDisabled} onClick={() => startCall(contact.id, 'audio')}>
              <Phone className="h-[18px] w-[18px]" />
            </IconButton>
            <IconButton label="Video call" disabled={callsDisabled} onClick={() => startCall(contact.id, 'video')}>
              <Video className="h-5 w-5" />
            </IconButton>
          </>
        )}
        <IconButton label="Details" onClick={onInfo}>
          <Info className="h-[18px] w-[18px]" />
        </IconButton>
      </header>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          if (el.scrollTop < 120 && conv?.hasMore && !conv.loading) void loadOlder(convKey)
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6"
      >
        <div className="mx-auto flex max-w-3xl flex-col">
          {conv?.loading && (
            <div className="flex justify-center py-3">
              <Spinner />
            </div>
          )}
          {conv?.loaded && !conv.hasMore && (
            <div className="mx-auto my-4 flex max-w-sm items-start gap-2.5 rounded-2xl bg-amber-300/[0.06] px-4 py-3 text-xs leading-relaxed text-amber-100/70">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300/80" />
              {group
                ? 'Messages in this group are encrypted with a shared AES-256 key held only by its members.'
                : 'Messages are end-to-end encrypted with X25519 keys. Only you and ' + name.split(' ')[0] + ' can read them.'}
            </div>
          )}
          <MessageList messages={messages} myId={account.id} groupMembers={group?.members} />
        </div>
      </div>

      <div className="shrink-0 px-3 pt-2 pb-3 sm:px-6 sm:pb-5">
        <div className="mx-auto max-w-3xl">
          {error && <p className="mb-2 px-1 text-xs text-rose-300">{error}</p>}
          <div className="glass flex items-end gap-2 rounded-2xl p-1.5 pl-4 focus-within:border-brand-400/40">
            <textarea
              ref={input}
              rows={1}
              value={draft}
              maxLength={8000}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={`Message ${name}`}
              className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-2.5 text-[15px] leading-5 placeholder:text-ink-400 outline-none [field-sizing:content]"
            />
            <button
              onClick={() => void submit()}
              disabled={!draft.trim()}
              aria-label="Send"
              className="bg-brand-gradient grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white shadow-lg shadow-brand-600/30 transition hover:brightness-110 disabled:opacity-30 disabled:shadow-none"
            >
              <SendHorizontal className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function MessageList({
  messages,
  myId,
  groupMembers,
}: {
  messages: ChatMessage[]
  myId: string
  groupMembers?: { id: string; display_name: string; username: string }[]
}) {
  return (
    <>
      {messages.map((m, i) => {
        const prev = messages[i - 1]
        const next = messages[i + 1]
        const mine = m.sender_id === myId
        const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()
        const closeTo = (a?: ChatMessage) =>
          a && a.sender_id === m.sender_id && Math.abs(new Date(a.created_at).getTime() - new Date(m.created_at).getTime()) < 5 * 60_000
        const firstOfRun = newDay || !closeTo(prev)
        const lastOfRun = !closeTo(next) || (next && new Date(next.created_at).toDateString() !== new Date(m.created_at).toDateString())
        const sender = groupMembers && !mine ? groupMembers.find((u) => u.id === m.sender_id) : undefined

        return (
          <Fragment key={m.id}>
            {newDay && (
              <div className="my-4 flex justify-center">
                <span className="rounded-full bg-white/[0.05] px-3 py-1 text-[11px] font-medium text-ink-300">{dayLabel(m.created_at)}</span>
              </div>
            )}
            <div className={clsx('flex items-end gap-2', mine ? 'justify-end' : 'justify-start', firstOfRun ? 'mt-3' : 'mt-0.5')}>
              {groupMembers && !mine && (
                <div className="w-8 shrink-0">
                  {lastOfRun && <Avatar name={sender?.display_name ?? '?'} seed={sender?.username ?? m.sender_id} size={30} />}
                </div>
              )}
              <div
                className={clsx(
                  'max-w-[78%] animate-rise px-3.5 py-2 text-[15px] leading-snug shadow-sm sm:max-w-[65%]',
                  mine ? 'bg-brand-gradient text-white' : 'bg-ink-800 text-ink-100',
                  m.failed && 'bg-ink-850! text-ink-400! italic',
                  mine
                    ? clsx('rounded-2xl', !firstOfRun && 'rounded-tr-md', !lastOfRun && 'rounded-br-md')
                    : clsx('rounded-2xl', !firstOfRun && 'rounded-tl-md', !lastOfRun && 'rounded-bl-md'),
                  m.pending && 'opacity-70',
                )}
              >
                {sender && firstOfRun && <div className="mb-0.5 text-xs font-semibold text-brand-300">{sender.display_name}</div>}
                <span className="break-words whitespace-pre-wrap">{m.text}</span>
                <span className={clsx('float-right mt-1.5 ml-3 text-[10px] leading-none', mine ? 'text-white/65' : 'text-ink-400')}>
                  {m.pending ? 'sending…' : timeOfDay(m.created_at)}
                </span>
              </div>
            </div>
          </Fragment>
        )
      })}
    </>
  )
}
