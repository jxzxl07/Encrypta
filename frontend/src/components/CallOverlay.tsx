import clsx from 'clsx'
import { Lock, Mic, MicOff, Minimize2, Phone, PhoneOff, Video, VideoOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { duration } from '../lib/format'
import { useCall } from '../store/call'
import { useChat } from '../store/chat'
import { Avatar } from './ui'

function StreamVideo({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream
  }, [stream])
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} />
}

export default function CallOverlay() {
  const call = useCall()
  const peer = useChat((s) => s.contacts.find((c) => c.user.id === call.peerId)?.user)
  const [now, setNow] = useState(Date.now())
  const [minimised, setMinimised] = useState(false)
  const [remoteHasVideo, setRemoteHasVideo] = useState(false)

  useEffect(() => {
    if (call.phase !== 'active') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [call.phase])

  useEffect(() => {
    if (call.phase === 'idle') setMinimised(false)
  }, [call.phase])

  useEffect(() => {
    const stream = call.remoteStream
    if (!stream) return setRemoteHasVideo(false)
    const update = () => setRemoteHasVideo(stream.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted))
    update()
    const tracks = stream.getVideoTracks()
    tracks.forEach((t) => {
      t.addEventListener('mute', update)
      t.addEventListener('unmute', update)
    })
    stream.addEventListener('addtrack', update)
    const poll = setInterval(update, 1000)
    return () => {
      clearInterval(poll)
      stream.removeEventListener('addtrack', update)
      tracks.forEach((t) => {
        t.removeEventListener('mute', update)
        t.removeEventListener('unmute', update)
      })
    }
  }, [call.remoteStream])

  if (call.phase === 'idle') return null

  const name = peer?.display_name ?? 'Unknown'
  const seed = peer?.username ?? call.peerId ?? '?'
  const isVideo = call.media === 'video'
  const status =
    call.phase === 'incoming'
      ? `Incoming ${isVideo ? 'video' : 'voice'} call`
      : call.phase === 'outgoing'
        ? 'Ringing…'
        : call.phase === 'connecting'
          ? 'Connecting…'
          : call.phase === 'active'
            ? duration(now - (call.startedAt ?? now))
            : call.endReason

  // Remote audio must play even when the overlay is minimised or audio-only.
  const remoteAudio = !isVideo && <StreamVideo stream={call.remoteStream} className="hidden" />

  if (minimised && (call.phase === 'active' || call.phase === 'connecting')) {
    return (
      <>
        {remoteAudio}
        {isVideo && <StreamVideo stream={call.remoteStream} className="hidden" />}
        <button
          onClick={() => setMinimised(false)}
          className="glass fixed right-4 bottom-4 z-50 flex animate-rise items-center gap-3 rounded-2xl py-2.5 pr-4 pl-2.5 shadow-2xl"
        >
          <Avatar name={name} seed={seed} size={40} />
          <div className="text-left">
            <div className="text-sm font-semibold">{name}</div>
            <div className="font-mono text-xs text-emerald-300">{status}</div>
          </div>
        </button>
      </>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex animate-rise flex-col overflow-hidden bg-ink-950">
      <div className="aurora" />
      {remoteAudio}
      {isVideo && call.remoteStream && (
        <StreamVideo
          stream={call.remoteStream}
          className={clsx('absolute inset-0 h-full w-full object-cover transition-opacity duration-500', remoteHasVideo ? 'opacity-100' : 'opacity-0')}
        />
      )}
      {isVideo && remoteHasVideo && <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink-950/60 via-transparent to-ink-950/80" />}

      <header className="relative flex items-center justify-between p-4 sm:p-6">
        <span className="flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1.5 text-xs text-ink-200 backdrop-blur">
          <Lock className="h-3 w-3" /> End-to-end encrypted
        </span>
        {(call.phase === 'active' || call.phase === 'connecting') && (
          <button onClick={() => setMinimised(true)} aria-label="Minimise call" className="grid h-10 w-10 place-items-center rounded-full bg-white/[0.07] text-ink-200 backdrop-blur hover:bg-white/15">
            <Minimize2 className="h-4 w-4" />
          </button>
        )}
      </header>

      <div className={clsx('relative flex flex-1 flex-col items-center justify-center px-6 text-center', isVideo && remoteHasVideo && 'invisible')}>
        <div className={clsx('rounded-full', (call.phase === 'incoming' || call.phase === 'outgoing') && 'animate-pulse-ring')}>
          <Avatar name={name} seed={seed} size={132} />
        </div>
        <h2 className="mt-6 text-3xl font-semibold tracking-tight">{name}</h2>
        <p className={clsx('mt-2 text-base', call.phase === 'active' ? 'font-mono text-emerald-300' : 'text-ink-300')}>{status}</p>
      </div>

      {isVideo && remoteHasVideo && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 text-center">
          <div className="text-lg font-semibold drop-shadow">{name}</div>
          <div className="font-mono text-sm text-emerald-300 drop-shadow">{status}</div>
        </div>
      )}

      {isVideo && call.localStream && (
        <div className="absolute right-4 bottom-32 h-44 w-32 overflow-hidden rounded-2xl border border-white/10 bg-ink-800 shadow-2xl sm:right-6 sm:h-52 sm:w-72">
          <StreamVideo stream={call.localStream} muted className={clsx('h-full w-full -scale-x-100 object-cover', call.cameraOff && 'opacity-0')} />
          {call.cameraOff && (
            <div className="absolute inset-0 grid place-items-center text-ink-400">
              <VideoOff className="h-6 w-6" />
            </div>
          )}
        </div>
      )}

      <footer className="relative flex items-center justify-center gap-4 p-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {call.phase === 'incoming' ? (
          <>
            <RoundButton label="Decline" onClick={call.decline} className="bg-rose-500 hover:bg-rose-400">
              <PhoneOff className="h-6 w-6" />
            </RoundButton>
            <RoundButton label="Accept" onClick={() => void call.accept()} className="bg-emerald-500 hover:bg-emerald-400">
              {isVideo ? <Video className="h-6 w-6" /> : <Phone className="h-6 w-6" />}
            </RoundButton>
          </>
        ) : call.phase === 'ended' ? null : (
          <>
            <RoundButton label={call.muted ? 'Unmute' : 'Mute'} onClick={call.toggleMute} className={call.muted ? 'bg-white text-ink-950' : 'bg-white/10 hover:bg-white/20'}>
              {call.muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
            </RoundButton>
            {isVideo && (
              <RoundButton
                label={call.cameraOff ? 'Turn camera on' : 'Turn camera off'}
                onClick={call.toggleCamera}
                className={call.cameraOff ? 'bg-white text-ink-950' : 'bg-white/10 hover:bg-white/20'}
              >
                {call.cameraOff ? <VideoOff className="h-6 w-6" /> : <Video className="h-6 w-6" />}
              </RoundButton>
            )}
            <RoundButton label="Hang up" onClick={call.hangUp} className="bg-rose-500 hover:bg-rose-400">
              <PhoneOff className="h-6 w-6" />
            </RoundButton>
          </>
        )}
      </footer>
    </div>
  )
}

function RoundButton({ label, onClick, className, children }: { label: string; onClick: () => void; className: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={clsx('grid h-16 w-16 place-items-center rounded-full text-white shadow-xl backdrop-blur transition active:scale-95', className)}
    >
      {children}
    </button>
  )
}
