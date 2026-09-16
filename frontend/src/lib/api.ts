export interface Tokens {
  access_token: string
  refresh_token: string
}

const SESSION_KEY = 'encrypta.session'

export function readTokens(): Tokens | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
  } catch {
    return null
  }
}

export function writeTokens(t: Tokens | null) {
  try {
    if (t) localStorage.setItem(SESSION_KEY, JSON.stringify({ access_token: t.access_token, refresh_token: t.refresh_token }))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    /* storage unavailable; session lasts for this tab only */
  }
  memoryTokens = t
}

let memoryTokens: Tokens | null = readTokens()
let refreshing: Promise<boolean> | null = null
let onSessionLost: () => void = () => {}

export function setSessionLostHandler(fn: () => void) {
  onSessionLost = fn
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function accessToken() {
  return memoryTokens?.access_token ?? null
}

async function parseError(res: Response): Promise<ApiError> {
  let message = `Request failed (${res.status})`
  try {
    const body = await res.json()
    if (typeof body.detail === 'string') message = body.detail
    else if (Array.isArray(body.detail)) message = body.detail.map((d: { msg: string }) => d.msg.replace(/^Value error, /, '')).join('. ')
  } catch {
    /* not JSON */
  }
  return new ApiError(res.status, message)
}

export async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const current = memoryTokens
      if (!current) return false
      // Another tab may already have rotated the token.
      const stored = readTokens()
      if (stored && stored.refresh_token !== current.refresh_token) {
        memoryTokens = stored
        return true
      }
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: current.refresh_token }),
      })
      if (res.ok) {
        writeTokens(await res.json())
        return true
      }
      const latest = readTokens()
      if (latest && latest.refresh_token !== current.refresh_token) {
        memoryTokens = latest
        return true
      }
      return false
    })().finally(() => {
      refreshing = null
    })
  }
  return refreshing
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown; token?: string } = {}): Promise<T> {
  const { json, token, ...rest } = init
  const send = () => {
    const headers = new Headers(rest.headers)
    if (json !== undefined) headers.set('Content-Type', 'application/json')
    const bearer = token ?? memoryTokens?.access_token
    if (bearer) headers.set('Authorization', `Bearer ${bearer}`)
    return fetch(path, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body })
  }

  let res = await send()
  if (res.status === 401 && !token && memoryTokens && !path.startsWith('/api/auth/')) {
    if (await refreshSession()) res = await send()
    else {
      onSessionLost()
      throw new ApiError(401, 'Your session has ended. Please sign in again.')
    }
  }
  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T
  return res.json()
}
