import { create } from 'zustand'
import { api, readTokens, setSessionLostHandler, writeTokens } from '../lib/api'
import { clearCryptoCaches, openIdentity, type Me } from '../lib/crypto'
import { clearIdentity, loadIdentity, saveIdentity } from '../lib/keystore'
import { socket } from '../lib/socket'
import type { Account, SessionResponse } from '../lib/types'

interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn'
  account: Account | null
  identity: Me | null
  init: () => Promise<void>
  completeSession: (session: SessionResponse, wrapKey: CryptoKey) => Promise<void>
  logout: () => Promise<void>
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  account: null,
  identity: null,

  async init() {
    const tokens = readTokens()
    const stored = await loadIdentity().catch(() => undefined)
    if (!tokens || !stored) {
      set({ status: 'signedOut' })
      return
    }
    try {
      const account = await api<Account>('/api/auth/me')
      if (account.id !== stored.userId) throw new Error('identity mismatch')
      set({
        status: 'signedIn',
        account,
        identity: { id: account.id, privateKey: stored.privateKey, publicKey: stored.publicKey },
      })
    } catch {
      writeTokens(null)
      await clearIdentity().catch(() => {})
      set({ status: 'signedOut' })
    }
  },

  async completeSession(session, wrapKey) {
    // Decrypting the identity key is the real password check on this device.
    const privateKey = await openIdentity(wrapKey, session.keys)
    await saveIdentity({ userId: session.user.id, privateKey, publicKey: session.keys.public_key })
    writeTokens(session)
    set({
      status: 'signedIn',
      account: session.user,
      identity: { id: session.user.id, privateKey, publicKey: session.keys.public_key },
    })
  },

  async logout() {
    const tokens = readTokens()
    socket.stop()
    if (tokens) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: tokens.refresh_token }),
      }).catch(() => {})
    }
    writeTokens(null)
    await clearIdentity().catch(() => {})
    clearCryptoCaches()
    if (get().status !== 'signedOut') set({ status: 'signedOut', account: null, identity: null })
  },
}))

setSessionLostHandler(() => void useAuth.getState().logout())
