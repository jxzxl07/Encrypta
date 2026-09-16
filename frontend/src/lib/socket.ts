import { accessToken, refreshSession } from './api'

export type ServerEvent = { type: string; [key: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any

type Listener = (e: ServerEvent) => void
type Status = 'connecting' | 'open' | 'closed'

class RealtimeSocket {
  private ws: WebSocket | null = null
  private listeners = new Set<Listener>()
  private statusListeners = new Set<(s: Status) => void>()
  private heartbeat: number | undefined
  private retry = 0
  private stopped = true
  private queue: string[] = []
  status: Status = 'closed'

  start() {
    if (!this.stopped) return
    this.stopped = false
    this.connect()
  }

  stop() {
    this.stopped = true
    clearInterval(this.heartbeat)
    this.ws?.close(1000)
    this.ws = null
    this.setStatus('closed')
  }

  on(fn: Listener) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  onStatus(fn: (s: Status) => void) {
    this.statusListeners.add(fn)
    return () => this.statusListeners.delete(fn)
  }

  send(event: ServerEvent) {
    const frame = JSON.stringify(event)
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(frame)
    else if (event.type !== 'typing' && event.type !== 'ping') this.queue.push(frame)
  }

  private setStatus(s: Status) {
    this.status = s
    this.statusListeners.forEach((fn) => fn(s))
  }

  private connect() {
    const token = accessToken()
    if (!token || this.stopped) return
    this.setStatus('connecting')
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/api/ws?token=${encodeURIComponent(token)}`)
    this.ws = ws

    ws.onopen = () => {
      this.retry = 0
      this.setStatus('open')
      clearInterval(this.heartbeat)
      this.heartbeat = window.setInterval(() => this.send({ type: 'ping' }), 25_000)
      for (const frame of this.queue.splice(0)) ws.send(frame)
    }
    ws.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as ServerEvent
        this.listeners.forEach((fn) => fn(event))
      } catch {
        /* ignore malformed frame */
      }
    }
    ws.onclose = async (e) => {
      clearInterval(this.heartbeat)
      if (this.ws !== ws) return
      this.ws = null
      this.setStatus('closed')
      if (this.stopped) return
      if (e.code === 4401 && !(await refreshSession())) return
      const delay = Math.min(15_000, 500 * 2 ** this.retry++) + Math.random() * 400
      setTimeout(() => this.connect(), delay)
    }
  }
}

export const socket = new RealtimeSocket()
