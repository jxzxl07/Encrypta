/**
 * One-to-one voice and video calls over WebRTC.
 *
 * Media flows peer-to-peer, encrypted with DTLS-SRTP by the browser. The
 * server only relays the signalling (invite, SDP offer/answer, ICE candidates)
 * between two people who are connected.
 */
import { create } from 'zustand'
import { socket, type ServerEvent } from '../lib/socket'

export type CallMedia = 'audio' | 'video'
export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended'

interface CallState {
  phase: CallPhase
  callId: string | null
  peerId: string | null
  media: CallMedia
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  muted: boolean
  cameraOff: boolean
  startedAt: number | null
  endReason: string | null
  iceServers: RTCIceServer[]

  start: (peerId: string, media: CallMedia) => Promise<void>
  accept: () => Promise<void>
  decline: () => void
  hangUp: () => void
  toggleMute: () => void
  toggleCamera: () => void
  handle: (event: ServerEvent) => void
}

let pc: RTCPeerConnection | null = null
let pendingIce: RTCIceCandidateInit[] = []
let ringTimeout: number | undefined
let ringer: { stop: () => void } | null = null

function ring(kind: 'incoming' | 'outgoing') {
  try {
    const ctx = new AudioContext()
    const gain = ctx.createGain()
    gain.gain.value = 0
    gain.connect(ctx.destination)
    const osc = ctx.createOscillator()
    osc.frequency.value = kind === 'incoming' ? 660 : 440
    osc.connect(gain)
    osc.start()
    const pulse = () => {
      const t = ctx.currentTime
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.08, t + 0.05)
      gain.gain.setValueAtTime(0.08, t + (kind === 'incoming' ? 0.35 : 0.9))
      gain.gain.linearRampToValueAtTime(0, t + (kind === 'incoming' ? 0.4 : 1))
      if (kind === 'incoming') {
        gain.gain.linearRampToValueAtTime(0.08, t + 0.55)
        gain.gain.setValueAtTime(0.08, t + 0.85)
        gain.gain.linearRampToValueAtTime(0, t + 0.9)
      }
    }
    pulse()
    const id = window.setInterval(pulse, kind === 'incoming' ? 2000 : 3000)
    return {
      stop: () => {
        clearInterval(id)
        osc.stop()
        void ctx.close()
      },
    }
  } catch {
    return { stop: () => {} }
  }
}

function stopRinging() {
  ringer?.stop()
  ringer = null
  clearTimeout(ringTimeout)
}

async function getMedia(media: CallMedia) {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: media === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
  })
}

function mediaError(e: unknown) {
  if (e instanceof DOMException && e.name === 'NotAllowedError') return 'Microphone or camera permission was denied'
  if (e instanceof DOMException && e.name === 'NotFoundError') return 'No microphone or camera was found'
  return 'Could not start your microphone or camera'
}

export const useCall = create<CallState>((set, get) => {
  function signal(type: string, data?: unknown) {
    const { peerId, callId } = get()
    if (peerId && callId) socket.send({ type, to: peerId, call_id: callId, data })
  }

  function cleanup(reason: string | null) {
    stopRinging()
    pc?.close()
    pc = null
    pendingIce = []
    get().localStream?.getTracks().forEach((t) => t.stop())
    set({
      phase: reason ? 'ended' : 'idle',
      endReason: reason,
      localStream: null,
      remoteStream: null,
      startedAt: null,
      muted: false,
      cameraOff: false,
    })
    if (reason) {
      const endedCall = get().callId
      window.setTimeout(() => {
        if (get().phase === 'ended' && get().callId === endedCall) set({ phase: 'idle', callId: null, peerId: null, endReason: null })
      }, 2200)
    } else {
      set({ callId: null, peerId: null })
    }
  }

  function createPeer(stream: MediaStream) {
    const conn = new RTCPeerConnection({ iceServers: get().iceServers })
    stream.getTracks().forEach((t) => conn.addTrack(t, stream))
    const remote = new MediaStream()
    set({ remoteStream: remote })
    conn.ontrack = (e) => {
      e.streams[0]?.getTracks().forEach((t) => remote.addTrack(t))
      if (!e.streams[0]) remote.addTrack(e.track)
      set({ remoteStream: remote })
    }
    conn.onicecandidate = (e) => {
      if (e.candidate) signal('call.ice', e.candidate.toJSON())
    }
    conn.onconnectionstatechange = () => {
      if (conn.connectionState === 'connected') set({ phase: 'active', startedAt: get().startedAt ?? Date.now() })
      if (conn.connectionState === 'failed') {
        signal('call.end')
        cleanup('Connection failed. A TURN server may be needed on this network.')
      }
    }
    pc = conn
    return conn
  }

  async function flushIce() {
    for (const c of pendingIce.splice(0)) await pc?.addIceCandidate(c).catch(() => {})
  }

  return {
    phase: 'idle',
    callId: null,
    peerId: null,
    media: 'audio',
    localStream: null,
    remoteStream: null,
    muted: false,
    cameraOff: false,
    startedAt: null,
    endReason: null,
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],

    async start(peerId, media) {
      if (get().phase !== 'idle' && get().phase !== 'ended') return
      let stream: MediaStream
      try {
        stream = await getMedia(media)
      } catch (e) {
        set({ phase: 'ended', peerId, media, endReason: mediaError(e) })
        window.setTimeout(() => get().phase === 'ended' && set({ phase: 'idle', peerId: null, endReason: null }), 2500)
        return
      }
      set({ phase: 'outgoing', callId: crypto.randomUUID(), peerId, media, localStream: stream, endReason: null })
      signal('call.invite', { media })
      ringer = ring('outgoing')
      ringTimeout = window.setTimeout(() => {
        if (get().phase === 'outgoing') {
          signal('call.end')
          cleanup('No answer')
        }
      }, 45_000)
    },

    async accept() {
      if (get().phase !== 'incoming') return
      stopRinging()
      try {
        const stream = await getMedia(get().media)
        set({ localStream: stream, phase: 'connecting' })
        createPeer(stream)
        signal('call.accept')
      } catch (e) {
        signal('call.decline')
        cleanup(mediaError(e))
      }
    },

    decline() {
      signal('call.decline')
      cleanup(null)
    },

    hangUp() {
      signal('call.end')
      cleanup('Call ended')
    },

    toggleMute() {
      const muted = !get().muted
      get().localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted))
      set({ muted })
    },

    toggleCamera() {
      const cameraOff = !get().cameraOff
      get().localStream?.getVideoTracks().forEach((t) => (t.enabled = !cameraOff))
      set({ cameraOff })
    },

    handle(event) {
      const state = get()
      if (event.type === 'hello' && Array.isArray(event.ice_servers)) {
        set({ iceServers: event.ice_servers })
        return
      }
      if (!event.type.startsWith('call.')) return

      if (event.type === 'call.invite') {
        if (state.phase !== 'idle' && state.phase !== 'ended') {
          socket.send({ type: 'call.busy', to: event.from, call_id: event.call_id })
          return
        }
        set({
          phase: 'incoming',
          callId: event.call_id,
          peerId: event.from,
          media: event.data?.media === 'video' ? 'video' : 'audio',
          endReason: null,
        })
        ringer = ring('incoming')
        ringTimeout = window.setTimeout(() => get().phase === 'incoming' && cleanup('Missed call'), 45_000)
        return
      }

      if (event.type === 'call.handled') {
        if (state.phase === 'incoming' && event.call_id === state.callId) cleanup(null)
        return
      }

      if (event.call_id !== state.callId || event.from !== state.peerId) {
        if (event.type === 'call.unavailable' && event.call_id === state.callId) cleanup('They are offline')
        return
      }

      void (async () => {
        switch (event.type) {
          case 'call.unavailable':
            cleanup('They are offline')
            break
          case 'call.accept': {
            if (state.phase !== 'outgoing' || !state.localStream) return
            stopRinging()
            set({ phase: 'connecting' })
            const conn = createPeer(state.localStream)
            const offer = await conn.createOffer()
            await conn.setLocalDescription(offer)
            signal('call.offer', offer)
            break
          }
          case 'call.offer': {
            if (!pc) return
            await pc.setRemoteDescription(event.data)
            await flushIce()
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            signal('call.answer', answer)
            break
          }
          case 'call.answer':
            await pc?.setRemoteDescription(event.data)
            await flushIce()
            break
          case 'call.ice':
            if (pc?.remoteDescription) await pc.addIceCandidate(event.data).catch(() => {})
            else pendingIce.push(event.data)
            break
          case 'call.decline':
            cleanup('Call declined')
            break
          case 'call.busy':
            cleanup('They are on another call')
            break
          case 'call.end':
            cleanup(state.phase === 'incoming' ? 'Missed call' : 'Call ended')
            break
        }
      })()
    },
  }
})
