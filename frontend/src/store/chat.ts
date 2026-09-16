import { create } from 'zustand'
import { api, ApiError } from '../lib/api'
import {
  decryptDirect,
  decryptGroup,
  encryptDirect,
  encryptGroup,
  newGroupKey,
  openGroupKey,
  openGroupKeyRaw,
  sealGroupKey,
  type Me,
} from '../lib/crypto'
import { socket, type ServerEvent } from '../lib/socket'
import type { ChatMessage, ConnectionItem, ConversationKey, Group, UserPublic, WireMessage } from '../lib/types'
import { useAuth } from './auth'

const PAGE = 50
const LAST_READ_KEY = 'encrypta.lastRead'

function readLastRead(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LAST_READ_KEY) || '{}')
  } catch {
    return {}
  }
}

function markRead(key: ConversationKey, at: string) {
  try {
    const all = readLastRead()
    if (!all[key] || all[key] < at) {
      all[key] = at
      localStorage.setItem(LAST_READ_KEY, JSON.stringify(all))
    }
  } catch {
    /* storage unavailable */
  }
}

interface ConversationState {
  messages: ChatMessage[]
  loaded: boolean
  hasMore: boolean
  loading: boolean
}

interface ChatState {
  ready: boolean
  contacts: ConnectionItem[]
  incoming: ConnectionItem[]
  outgoing: ConnectionItem[]
  groups: Group[]
  online: Record<string, boolean>
  lastSeen: Record<string, string>
  latest: Partial<Record<ConversationKey, ChatMessage>>
  conversations: Partial<Record<ConversationKey, ConversationState>>
  unread: Partial<Record<ConversationKey, number>>
  typing: Partial<Record<ConversationKey, Record<string, number>>>
  active: ConversationKey | null

  bootstrap: () => Promise<void>
  reset: () => void
  loadConnections: () => Promise<void>
  loadGroups: () => Promise<void>
  open: (key: ConversationKey | null) => void
  loadOlder: (key: ConversationKey) => Promise<void>
  send: (key: ConversationKey, text: string) => Promise<void>
  sendTyping: (key: ConversationKey) => void
  createGroup: (name: string, members: UserPublic[]) => Promise<Group>
  addMember: (groupId: string, user: UserPublic) => Promise<void>
  removeMember: (groupId: string, userId: string) => Promise<void>
  renameGroup: (groupId: string, name: string) => Promise<void>
  handle: (event: ServerEvent) => void
}

const initial = {
  ready: false,
  contacts: [],
  incoming: [],
  outgoing: [],
  groups: [],
  online: {},
  lastSeen: {},
  latest: {},
  conversations: {},
  unread: {},
  typing: {},
  active: null,
}

function me(): Me {
  const identity = useAuth.getState().identity
  if (!identity) throw new Error('Not signed in')
  return identity
}

export function keyFor(msg: WireMessage, myId: string): ConversationKey {
  if (msg.group_id) return `g:${msg.group_id}`
  return `dm:${msg.sender_id === myId ? msg.recipient_id : msg.sender_id}`
}

export const useChat = create<ChatState>((set, get) => {
  async function decrypt(msg: WireMessage): Promise<ChatMessage> {
    const base = { id: msg.id, sender_id: msg.sender_id, created_at: msg.created_at }
    const identity = me()
    try {
      if (msg.group_id) {
        const group = get().groups.find((g) => g.id === msg.group_id)
        const sealed = group?.keys.find((k) => k.version === msg.key_version)
        const wrapper = sealed && group?.wrappers[sealed.wrapped_by]
        if (!group || !sealed || !wrapper) throw new Error('missing group key')
        const key = await openGroupKey(identity, group.id, sealed, wrapper)
        const body = await decryptGroup(key, { ...msg, group_id: msg.group_id })
        return { ...base, text: body.text }
      }
      const partnerId = msg.sender_id === identity.id ? msg.recipient_id : msg.sender_id
      const partner = get().contacts.find((c) => c.user.id === partnerId)?.user
      if (!partner) throw new Error('unknown contact')
      const body = await decryptDirect(identity, partner, { ...msg, recipient_id: msg.recipient_id! })
      return { ...base, text: body.text }
    } catch {
      return { ...base, text: 'This message could not be decrypted on this device.', failed: true }
    }
  }

  function patchConversation(key: ConversationKey, fn: (c: ConversationState) => ConversationState) {
    set((s) => {
      const current = s.conversations[key] ?? { messages: [], loaded: false, hasMore: true, loading: false }
      return { conversations: { ...s.conversations, [key]: fn(current) } }
    })
  }

  function insert(key: ConversationKey, message: ChatMessage, replaceId?: string) {
    patchConversation(key, (c) => {
      let messages = c.messages.filter((m) => m.id !== replaceId)
      if (messages.some((m) => m.id === message.id)) return { ...c, messages }
      messages = [...messages, message].sort((a, b) => a.created_at.localeCompare(b.created_at))
      return { ...c, messages }
    })
    const prev = get().latest[key]
    if (!prev || prev.created_at <= message.created_at || prev.id === replaceId) {
      set((s) => ({ latest: { ...s.latest, [key]: message } }))
    }
  }

  async function refreshGroup(groupId: string): Promise<Group | null> {
    try {
      const group = await api<Group>(`/api/groups/${groupId}`)
      set((s) => ({
        groups: s.groups.some((g) => g.id === groupId)
          ? s.groups.map((g) => (g.id === groupId ? group : g))
          : [...s.groups, group],
      }))
      return group
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        set((s) => ({ groups: s.groups.filter((g) => g.id !== groupId), active: s.active === `g:${groupId}` ? null : s.active }))
      }
      return null
    }
  }

  /** Replace the group key so members who left can't read anything new. */
  async function rotate(group: Group): Promise<Group> {
    const identity = me()
    const raw = newGroupKey()
    const version = group.key_version + 1
    const keys = await Promise.all(group.members.map((m) => sealGroupKey(identity, m, raw, version)))
    try {
      const updated = await api<Group>(`/api/groups/${group.id}/rotate`, { method: 'POST', json: { version, keys } })
      set((s) => ({ groups: s.groups.map((g) => (g.id === group.id ? updated : g)) }))
      return updated
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const fresh = await refreshGroup(group.id)
        if (fresh) return fresh
      }
      throw e
    }
  }

  async function sendGroup(groupId: string, text: string, attempt = 0): Promise<WireMessage> {
    const identity = me()
    let group = get().groups.find((g) => g.id === groupId)
    if (!group) throw new Error('Group not found')
    if (group.rotation_needed) group = await rotate(group)
    const sealed = group.keys.find((k) => k.version === group.key_version)
    const wrapper = sealed && group.wrappers[sealed.wrapped_by]
    if (!sealed || !wrapper) throw new Error("You don't have the current group key yet")
    const key = await openGroupKey(identity, group.id, sealed, wrapper)
    const payload = await encryptGroup(key, group.id, identity.id, { kind: 'text', text })
    try {
      return await api<WireMessage>(`/api/groups/${groupId}/messages`, {
        method: 'POST',
        json: { ...payload, key_version: group.key_version },
      })
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && attempt < 2) {
        await refreshGroup(groupId)
        return sendGroup(groupId, text, attempt + 1)
      }
      throw e
    }
  }

  return {
    ...initial,

    reset: () => set({ ...initial }),

    async bootstrap() {
      await Promise.all([get().loadConnections(), get().loadGroups()])
      const summary = await api<{ dms: Record<string, WireMessage>; groups: Record<string, WireMessage> }>('/api/conversations')
      const lastRead = readLastRead()
      const all = [...Object.values(summary.dms), ...Object.values(summary.groups)]
      const decrypted = await Promise.all(all.map(decrypt))
      const latest: ChatState['latest'] = {}
      const unread: ChatState['unread'] = {}
      all.forEach((wire, i) => {
        const key = keyFor(wire, me().id)
        latest[key] = decrypted[i]
        if (wire.sender_id !== me().id && (!lastRead[key] || lastRead[key] < wire.created_at)) unread[key] = 1
      })
      set({ latest, unread, ready: true })
    },

    async loadConnections() {
      const data = await api<{ contacts: ConnectionItem[]; incoming: ConnectionItem[]; outgoing: ConnectionItem[] }>(
        '/api/connections',
      )
      const online = { ...get().online }
      const lastSeen = { ...get().lastSeen }
      for (const c of data.contacts) {
        online[c.user.id] = c.user.online
        if (c.user.last_seen_at) lastSeen[c.user.id] = c.user.last_seen_at
      }
      set({ ...data, online, lastSeen })
    },

    async loadGroups() {
      set({ groups: await api<Group[]>('/api/groups') })
    },

    open(key) {
      set((s) => ({ active: key, unread: key ? { ...s.unread, [key]: 0 } : s.unread }))
      if (!key) return
      const latest = get().latest[key]
      if (latest) markRead(key, latest.created_at)
      if (!get().conversations[key]?.loaded) void get().loadOlder(key)
    },

    async loadOlder(key) {
      const conv = get().conversations[key]
      if (conv?.loading || (conv?.loaded && !conv.hasMore)) return
      patchConversation(key, (c) => ({ ...c, loading: true }))
      const oldest = conv?.loaded ? conv.messages.find((m) => !m.pending)?.created_at : undefined
      const [kind, id] = key.split(':') as ['dm' | 'g', string]
      const path = kind === 'dm' ? `/api/dm/${id}/messages` : `/api/groups/${id}/messages`
      const qs = new URLSearchParams({ limit: String(PAGE) })
      if (oldest) qs.set('before', oldest)
      try {
        const wire = await api<WireMessage[]>(`${path}?${qs}`)
        const older = await Promise.all(wire.map(decrypt))
        patchConversation(key, (c) => {
          const seen = new Set(c.messages.map((m) => m.id))
          return {
            messages: [...older.filter((m) => !seen.has(m.id)), ...c.messages],
            loaded: true,
            hasMore: wire.length === PAGE,
            loading: false,
          }
        })
      } catch {
        patchConversation(key, (c) => ({ ...c, loading: false }))
      }
    },

    async send(key, text) {
      const identity = me()
      const tempId = `pending-${crypto.randomUUID()}`
      insert(key, { id: tempId, sender_id: identity.id, created_at: new Date().toISOString(), text, pending: true })
      try {
        const [kind, id] = key.split(':') as ['dm' | 'g', string]
        let wire: WireMessage
        if (kind === 'dm') {
          const peer = get().contacts.find((c) => c.user.id === id)?.user
          if (!peer) throw new Error('You are no longer connected')
          const payload = await encryptDirect(identity, peer, { kind: 'text', text })
          wire = await api<WireMessage>(`/api/dm/${id}/messages`, { method: 'POST', json: payload })
        } else {
          wire = await sendGroup(id, text)
        }
        insert(key, { id: wire.id, sender_id: wire.sender_id, created_at: wire.created_at, text }, tempId)
        markRead(key, wire.created_at)
      } catch (e) {
        patchConversation(key, (c) => ({ ...c, messages: c.messages.filter((m) => m.id !== tempId) }))
        throw e
      }
    },

    sendTyping(key) {
      const [kind, id] = key.split(':')
      socket.send(kind === 'dm' ? { type: 'typing', to: id } : { type: 'typing', group_id: id })
    },

    async createGroup(name, members) {
      const identity = me()
      const account = useAuth.getState().account!
      const raw = newGroupKey()
      const everyone = [...members, { id: identity.id, public_key: identity.publicKey, username: account.username }]
      const keys = await Promise.all(everyone.map((m) => sealGroupKey(identity, m, raw, 1)))
      const group = await api<Group>('/api/groups', {
        method: 'POST',
        json: { name, member_ids: members.map((m) => m.id), keys },
      })
      set((s) => ({ groups: [...s.groups.filter((g) => g.id !== group.id), group] }))
      return group
    },

    async addMember(groupId, user) {
      const identity = me()
      let group = get().groups.find((g) => g.id === groupId)!
      if (group.rotation_needed) group = await rotate(group)
      const sealed = group.keys.find((k) => k.version === group.key_version)
      const wrapper = sealed && group.wrappers[sealed.wrapped_by]
      if (!sealed || !wrapper) throw new Error("You don't hold the current group key")
      const raw = await openGroupKeyRaw(identity, sealed, wrapper)
      const key = await sealGroupKey(identity, user, raw, group.key_version)
      const updated = await api<Group>(`/api/groups/${groupId}/members`, { method: 'POST', json: { user_id: user.id, key } })
      set((s) => ({ groups: s.groups.map((g) => (g.id === groupId ? updated : g)) }))
    },

    async removeMember(groupId, userId) {
      await api(`/api/groups/${groupId}/members/${userId}`, { method: 'DELETE' })
      if (userId === me().id) {
        set((s) => ({
          groups: s.groups.filter((g) => g.id !== groupId),
          active: s.active === `g:${groupId}` ? null : s.active,
        }))
      } else {
        await refreshGroup(groupId)
      }
    },

    async renameGroup(groupId, name) {
      const updated = await api<Group>(`/api/groups/${groupId}`, { method: 'PATCH', json: { name } })
      set((s) => ({ groups: s.groups.map((g) => (g.id === groupId ? updated : g)) }))
    },

    handle(event) {
      switch (event.type) {
        case 'hello': {
          const online: Record<string, boolean> = {}
          for (const c of get().contacts) online[c.user.id] = false
          for (const id of event.online as string[]) online[id] = true
          set({ online })
          break
        }
        case 'presence':
          set((s) => ({
            online: { ...s.online, [event.user_id]: event.online },
            lastSeen: event.online ? s.lastSeen : { ...s.lastSeen, [event.user_id]: event.at },
          }))
          break
        case 'connections.changed':
          void get().loadConnections()
          break
        case 'groups.changed':
          void refreshGroup(event.group_id)
          break
        case 'typing': {
          const key: ConversationKey = event.group_id ? `g:${event.group_id}` : `dm:${event.from}`
          const until = Date.now() + 4000
          set((s) => ({ typing: { ...s.typing, [key]: { ...s.typing[key], [event.from]: until } } }))
          setTimeout(() => {
            const current = get().typing[key]
            if (current?.[event.from] !== until) return
            const rest = { ...current }
            delete rest[event.from]
            set((s) => ({ typing: { ...s.typing, [key]: rest } }))
          }, 4100)
          break
        }
        case 'message.new': {
          const wire = event.message as WireMessage
          const identity = useAuth.getState().identity
          if (!identity) break
          const key = keyFor(wire, identity.id)
          void (async () => {
            if (wire.group_id) {
              const group = get().groups.find((g) => g.id === wire.group_id)
              if (!group || !group.keys.some((k) => k.version === wire.key_version)) await refreshGroup(wire.group_id)
            }
            // Our own sends are inserted by send(); skip the echo to avoid a flash.
            const conv = get().conversations[key]
            if (wire.sender_id === identity.id && conv?.messages.some((m) => m.pending)) return
            const message = await decrypt(wire)
            insert(key, message)
            if (wire.sender_id !== identity.id) {
              const typing = { ...get().typing[key] }
              delete typing[wire.sender_id]
              set((s) => ({ typing: { ...s.typing, [key]: typing } }))
              if (get().active === key && document.visibilityState === 'visible') markRead(key, wire.created_at)
              else set((s) => ({ unread: { ...s.unread, [key]: (s.unread[key] ?? 0) + 1 } }))
            }
          })()
          break
        }
      }
    },
  }
})
