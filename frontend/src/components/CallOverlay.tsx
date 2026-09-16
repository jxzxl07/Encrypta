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
          className="surface fixed right-4 bottom-4 z-50 flex animate-rise items-center gap-3 rounded-lg py-2 pr-4 pl-2"
        >
          <Avatar name={name} seed={seed} size={32} />
          <div className="text-left">
            <div className="text-sm font-semibold">{name}</div>
            <div className="text-xs text-ink-300 tabular-nums">{status}</div>
          </div>
        </button>
      </>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex animate-rise flex-col overflow-hidden bg-ink-950">
      {remoteAudio}
      {isVideo && call.remoteStream && (
        <StreamVideo
          stream={call.remoteStream}
          className={clsx('absolute inset-0 h-full w-full object-cover transition-opacity duration-500', remoteHasVideo ? 'opacity-100' : 'opacity-0')}
        />
      )}
      {isVideo && remoteHasVideo && <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink-950/60 via-transparent to-ink-950/80" />}

      <header className="relative flex items-center justify-between p-4 sm:p-6">
        <span className="flex items-center gap-1.5 rounded-md bg-black/30 px-2.5 py-1 text-xs text-ink-300">
          <Lock className="h-3 w-3" /> End-to-end encrypted
        </span>
        {(call.phase === 'active' || call.phase === 'connecting') && (
          <button onClick={() => setMinimised(true)} aria-label="Minimise call" className="grid h-9 w-9 place-items-center rounded-md bg-black/30 text-ink-200 hover:bg-black/50">
            <Minimize2 className="h-4 w-4" />
          </button>
        )}
      </header>

      <div className={clsx('relative flex flex-1 flex-col items-center justify-center px-6 text-center', isVideo && remoteHasVideo && 'invisible')}>
        <Avatar name={name} seed={seed} size={96} />
        <h2 className="mt-5 text-xl font-semibold">{name}</h2>
        <p className="mt-1 text-sm text-ink-300 tabular-nums">{status}</p>
      </div>

      {isVideo && remoteHasVideo && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 text-center">
          <div className="text-base font-semibold">{name}</div>
          <div className="text-sm text-ink-200 tabular-nums">{status}</div>
        </div>
      )}

      {isVideo && call.localStream && (
        <div className="absolute right-4 bottom-32 h-44 w-32 overflow-hidden rounded-lg border border-white/10 bg-ink-800 sm:right-6 sm:h-52 sm:w-72">
          <StreamVideo stream={call.localStream} muted className={clsx('h-full w-full -scale-x-100 object-cover', call.cameraOff && 'opacity-0')} />
          {call.cameraOff && (
            <div className="absolute inset-0 grid place-items-center text-ink-400">
              <VideoOff className="h-5 w-5" />
            </div>
          )}
        </div>
      )}

      <footer className="relative flex items-center justify-center gap-4 p-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {call.phase === 'incoming' ? (
          <>
            <RoundButton label="Decline" onClick={call.decline} className="bg-rose-600 hover:bg-rose-500">
              <PhoneOff className="h-5 w-5" />
            </RoundButton>
            <RoundButton label="Accept" onClick={() => void call.accept()} className="bg-emerald-600 hover:bg-emerald-500">
              {isVideo ? <Video className="h-5 w-5" /> : <Phone className="h-5 w-5" />}
            </RoundButton>
          </>
        ) : call.phase === 'ended' ? null : (
          <>
            <RoundButton label={call.muted ? 'Unmute' : 'Mute'} onClick={call.toggleMute} className={call.muted ? 'bg-white text-ink-950' : 'bg-white/10 hover:bg-white/20'}>
              {call.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </RoundButton>
            {isVideo && (
              <RoundButton
                label={call.cameraOff ? 'Turn camera on' : 'Turn camera off'}
                onClick={call.toggleCamera}
                className={call.cameraOff ? 'bg-white text-ink-950' : 'bg-white/10 hover:bg-white/20'}
              >
                {call.cameraOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
              </RoundButton>
            )}
            <RoundButton label="Hang up" onClick={call.hangUp} className="bg-rose-600 hover:bg-rose-500">
              <PhoneOff className="h-5 w-5" />
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
      className={clsx('grid h-14 w-14 place-items-center rounded-full text-white transition-colors', className)}
    >
      {children}
    </button>
  )
}
