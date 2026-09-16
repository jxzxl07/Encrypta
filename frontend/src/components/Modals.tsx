import clsx from 'clsx'
import { Check, Crown, KeyRound, LogOut, Pencil, UserMinus, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { fingerprint } from '../lib/crypto'
import { relative } from '../lib/format'
import type { ConversationKey, UserPublic } from '../lib/types'
import { useAuth } from '../store/auth'
import { useChat } from '../store/chat'
import { Avatar, Button, ErrorNote, Field, IconButton, Modal } from './ui'

function Fingerprint({ publicKey }: { publicKey: string }) {
  const [fp, setFp] = useState('')
  useEffect(() => {
    void fingerprint(publicKey).then(setFp)
  }, [publicKey])
  return <code className="block rounded-xl bg-ink-950/70 px-3 py-2.5 text-center font-mono text-sm tracking-wider text-brand-200">{fp || '…'}</code>
}

function MemberPicker({
  people,
  selected,
  onToggle,
}: {
  people: UserPublic[]
  selected: Set<string>
  onToggle: (id: string) => void
}) {
  const [q, setQ] = useState('')
  const shown = people.filter((p) => !q || p.display_name.toLowerCase().includes(q.toLowerCase()) || p.username.includes(q.toLowerCase()))
  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter connections"
        className="mb-2 h-10 w-full rounded-xl bg-white/[0.05] px-3 text-sm placeholder:text-ink-400 outline-none"
      />
      <div className="max-h-64 space-y-0.5 overflow-y-auto">
        {shown.length === 0 && <p className="py-4 text-center text-sm text-ink-400">No connections to add.</p>}
        {shown.map((p) => {
          const on = selected.has(p.id)
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onToggle(p.id)}
              className={clsx('flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition', on ? 'bg-brand-500/15' : 'hover:bg-white/[0.04]')}
            >
              <Avatar name={p.display_name} seed={p.username} size={36} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{p.display_name}</div>
                <div className="truncate text-xs text-ink-400">@{p.username}</div>
              </div>
              <span className={clsx('grid h-5 w-5 place-items-center rounded-md border', on ? 'border-brand-400 bg-brand-500 text-white' : 'border-white/20')}>
                {on && <Check className="h-3.5 w-3.5" />}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function NewGroupModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (key: ConversationKey) => void }) {
  const contacts = useChat((s) => s.contacts)
  const createGroup = useChat((s) => s.createGroup)
  const [name, setName] = useState('')
  const [selected, setSelected] = useState(new Set<string>())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setName('')
      setSelected(new Set())
      setError('')
    }
  }, [open])

  async function submit() {
    setBusy(true)
    setError('')
    try {
      const members = contacts.map((c) => c.user).filter((u) => selected.has(u.id))
      const group = await createGroup(name.trim(), members)
      onCreated(`g:${group.id}`)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New encrypted group">
      <div className="space-y-4">
        <Field label="Group name" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} placeholder="Weekend plans" autoFocus />
        <div>
          <div className="mb-2 text-xs font-medium tracking-wide text-ink-300">Members · {selected.size} selected</div>
          <MemberPicker
            people={contacts.map((c) => c.user)}
            selected={selected}
            onToggle={(id) => {
              const next = new Set(selected)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              setSelected(next)
            }}
          />
        </div>
        <p className="flex gap-2 text-xs leading-relaxed text-ink-400">
          <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />A fresh AES-256 group key is generated on this device and sealed individually to each member's public key.
        </p>
        <ErrorNote>{error}</ErrorNote>
        <Button className="w-full" disabled={!name.trim() || selected.size === 0} loading={busy} onClick={submit}>
          Create group
        </Button>
      </div>
    </Modal>
  )
}

export function DetailsModal({ convKey, open, onClose }: { convKey: ConversationKey | null; open: boolean; onClose: () => void }) {
  const account = useAuth((s) => s.account)!
  const { contacts, groups, online, lastSeen, addMember, removeMember, renameGroup } = useChat()
  const [adding, setAdding] = useState(false)
  const [selected, setSelected] = useState(new Set<string>())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setAdding(false)
    setSelected(new Set())
    setRenaming(null)
    setError('')
  }, [convKey, open])

  if (!convKey) return null
  const [kind, id] = convKey.split(':')
  const contact = kind === 'dm' ? contacts.find((c) => c.user.id === id) : undefined
  const group = kind === 'g' ? groups.find((g) => g.id === id) : undefined

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (contact) {
    const u = contact.user
    return (
      <Modal open={open} onClose={onClose} title="Contact">
        <div className="flex flex-col items-center text-center">
          <Avatar name={u.display_name} seed={u.username} size={84} online={online[u.id]} />
          <h3 className="mt-3 text-lg font-semibold">{u.display_name}</h3>
          <p className="text-sm text-ink-400">
            @{u.username} · {online[u.id] ? 'online' : `last seen ${relative(lastSeen[u.id] ?? u.last_seen_at)}`}
          </p>
        </div>
        <div className="mt-6 space-y-2">
          <div className="text-xs font-medium tracking-wide text-ink-300">Safety number</div>
          <Fingerprint publicKey={u.public_key} />
          <p className="text-xs leading-relaxed text-ink-400">
            Compare this with what {u.display_name.split(' ')[0]} sees on their profile. If they match, no one is intercepting your conversation.
          </p>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <Button
          variant="danger"
          className="mt-6 w-full"
          loading={busy}
          onClick={() =>
            confirm(`Remove ${u.display_name} from your connections?`) &&
            run(async () => {
              await api(`/api/connections/${contact.connection_id}`, { method: 'DELETE' })
              onClose()
            })
          }
        >
          <UserMinus className="h-4 w-4" /> Remove connection
        </Button>
      </Modal>
    )
  }

  if (!group) return null
  const isOwner = group.owner_id === account.id
  const memberIds = new Set(group.members.map((m) => m.id))
  const addable = contacts.map((c) => c.user).filter((u) => !memberIds.has(u.id))

  return (
    <Modal open={open} onClose={onClose} title="Group details" wide>
      <div className="flex items-center gap-4">
        <Avatar name={group.name} seed={group.id} size={64} group />
        <div className="min-w-0 flex-1">
          {renaming !== null ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void run(async () => {
                  await renameGroup(group.id, renaming)
                  setRenaming(null)
                })
              }}
            >
              <input
                autoFocus
                value={renaming}
                maxLength={64}
                onChange={(e) => setRenaming(e.target.value)}
                className="h-10 min-w-0 flex-1 rounded-xl bg-ink-950/70 px-3 outline-none"
              />
              <Button type="submit" className="h-10" loading={busy}>
                Save
              </Button>
            </form>
          ) : (
            <div className="flex items-center gap-1">
              <h3 className="truncate text-lg font-semibold">{group.name}</h3>
              <IconButton label="Rename group" className="h-8 w-8" onClick={() => setRenaming(group.name)}>
                <Pencil className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          )}
          <p className="text-sm text-ink-400">
            {group.members.length} members · key v{group.key_version}
            {group.rotation_needed && ' · rotates on next message'}
          </p>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wider text-ink-400 uppercase">Members</span>
        {isOwner && !adding && addable.length > 0 && (
          <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 text-sm font-semibold text-brand-300 hover:text-brand-200">
            <UserPlus className="h-4 w-4" /> Add
          </button>
        )}
      </div>

      {adding ? (
        <div className="mt-3 space-y-3">
          <MemberPicker
            people={addable}
            selected={selected}
            onToggle={(uid) => {
              const next = new Set(selected)
              if (next.has(uid)) next.delete(uid)
              else next.add(uid)
              setSelected(next)
            }}
          />
          <div className="flex gap-2">
            <Button variant="subtle" className="flex-1" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={!selected.size}
              loading={busy}
              onClick={() =>
                run(async () => {
                  for (const u of addable.filter((a) => selected.has(a.id))) await addMember(group.id, u)
                  setAdding(false)
                  setSelected(new Set())
                })
              }
            >
              Add {selected.size || ''}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 space-y-0.5">
          {group.members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-xl px-1 py-1.5">
              <Avatar name={m.display_name} seed={m.username} size={38} online={m.id === account.id ? true : online[m.id]} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 truncate text-sm font-medium">
                  {m.id === account.id ? 'You' : m.display_name}
                  {m.id === group.owner_id && <Crown className="h-3.5 w-3.5 text-amber-300" />}
                </div>
                <div className="truncate text-xs text-ink-400">@{m.username}</div>
              </div>
              {isOwner && m.id !== account.id && (
                <IconButton
                  label={`Remove ${m.display_name}`}
                  className="h-8 w-8 hover:text-rose-300"
                  disabled={busy}
                  onClick={() => confirm(`Remove ${m.display_name} from ${group.name}?`) && run(() => removeMember(group.id, m.id))}
                >
                  <UserMinus className="h-4 w-4" />
                </IconButton>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="mt-5 flex gap-2 rounded-xl bg-white/[0.03] p-3 text-xs leading-relaxed text-ink-400">
        <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Everyone in this group shares one AES-256 key. When someone leaves, the key is replaced so they can't read new messages. New members can't read messages sent before they joined.
      </p>
      <ErrorNote>{error}</ErrorNote>
      <Button
        variant="danger"
        className="mt-4 w-full"
        loading={busy}
        onClick={() =>
          confirm(`Leave ${group.name}?`) &&
          run(async () => {
            await removeMember(group.id, account.id)
            onClose()
          })
        }
      >
        <LogOut className="h-4 w-4" /> Leave group
      </Button>
    </Modal>
  )
}

export function ProfileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const account = useAuth((s) => s.account)
  const identity = useAuth((s) => s.identity)
  const logout = useAuth((s) => s.logout)
  if (!account || !identity) return null
  return (
    <Modal open={open} onClose={onClose} title="Your account">
      <div className="flex flex-col items-center text-center">
        <Avatar name={account.display_name} seed={account.username} size={84} />
        <h3 className="mt-3 text-lg font-semibold">{account.display_name}</h3>
        <p className="text-sm text-ink-400">@{account.username}</p>
        <p className="text-sm text-ink-400">{account.email}</p>
      </div>
      <div className="mt-6 space-y-2">
        <div className="text-xs font-medium tracking-wide text-ink-300">Your safety number</div>
        <Fingerprint publicKey={identity.publicKey} />
        <p className="text-xs leading-relaxed text-ink-400">
          Derived from your public key. Your contacts see the same number when they open your profile. Share your username, <span className="text-ink-200">@{account.username}</span>, so people can connect with you.
        </p>
      </div>
      <Button variant="subtle" className="mt-6 w-full" onClick={() => void logout()}>
        <LogOut className="h-4 w-4" /> Sign out of this device
      </Button>
    </Modal>
  )
}
