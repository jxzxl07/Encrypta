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
      <header className="z-10 flex h-14 shrink-0 items-center gap-2 border-b border-white/[0.07] bg-ink-900 px-3 sm:px-4">
        <IconButton label="Back" onClick={onBack} className="md:hidden">
          <ArrowLeft className="h-5 w-5" />
        </IconButton>
        <button onClick={onInfo} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <Avatar name={name} seed={seed} size={34} online={contact ? online : undefined} group={!!group} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{name}</div>
            <div className="truncate text-xs text-ink-400">{subtitle}</div>
          </div>
        </button>
        {contact && (
          <>
            <IconButton label="Voice call" disabled={callsDisabled} onClick={() => startCall(contact.id, 'audio')}>
              <Phone className="h-[18px] w-[18px]" />
            </IconButton>
            <IconButton label="Video call" disabled={callsDisabled} onClick={() => startCall(contact.id, 'video')}>
              <Video className="h-[18px] w-[18px]" />
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
            <div className="mx-auto my-4 flex max-w-sm items-start justify-center gap-1.5 px-4 text-center text-xs leading-relaxed text-ink-400">
              <Lock className="mt-0.5 h-3 w-3 shrink-0" />
              {group
                ? 'Messages in this group are end-to-end encrypted with a key only its members hold.'
                : 'Messages are end-to-end encrypted. Only you and ' + name.split(' ')[0] + ' can read them.'}
            </div>
          )}
          <MessageList messages={messages} myId={account.id} groupMembers={group?.members} />
        </div>
      </div>

      <div className="shrink-0 px-3 pt-2 pb-3 sm:px-6 sm:pb-4">
        <div className="mx-auto max-w-3xl">
          {error && <p className="mb-2 px-1 text-xs text-rose-300">{error}</p>}
          <div className="flex items-end gap-2 rounded-lg border border-white/[0.09] bg-ink-850 p-1 pl-3 transition-colors focus-within:border-white/20">
            <textarea
              ref={input}
              rows={1}
              value={draft}
              maxLength={8000}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={`Message ${name}`}
              className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-sm leading-5 placeholder:text-ink-400 outline-none [field-sizing:content]"
            />
            <button
              onClick={() => void submit()}
              disabled={!draft.trim()}
              aria-label="Send"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand-500 text-white transition-colors hover:bg-brand-600 disabled:bg-transparent disabled:text-ink-400"
            >
              <SendHorizontal className="h-4 w-4" />
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
                <span className="text-xs font-medium text-ink-400">{dayLabel(m.created_at)}</span>
              </div>
            )}
            <div className={clsx('flex items-end gap-2', mine ? 'justify-end' : 'justify-start', firstOfRun ? 'mt-3' : 'mt-0.5')}>
              {groupMembers && !mine && (
                <div className="w-8 shrink-0">
                  {lastOfRun && <Avatar name={sender?.display_name ?? '?'} seed={sender?.username ?? m.sender_id} size={28} />}
                </div>
              )}
              <div
                className={clsx(
                  'max-w-[78%] px-3 py-1.5 text-sm leading-relaxed sm:max-w-[65%]',
                  mine ? 'bg-brand-600 text-white' : 'bg-ink-800 text-ink-100',
                  m.failed && 'bg-ink-850! text-ink-400! italic',
                  mine
                    ? clsx('rounded-lg', !firstOfRun && 'rounded-tr-sm', !lastOfRun && 'rounded-br-sm')
                    : clsx('rounded-lg', !firstOfRun && 'rounded-tl-sm', !lastOfRun && 'rounded-bl-sm'),
                  m.pending && 'opacity-70',
                )}
              >
                {sender && firstOfRun && <div className="mb-0.5 text-xs font-medium text-ink-300">{sender.display_name}</div>}
                <span className="break-words whitespace-pre-wrap">{m.text}</span>
                <span className={clsx('float-right mt-1.5 ml-3 text-[10px] leading-none', mine ? 'text-white/60' : 'text-ink-400')}>
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
