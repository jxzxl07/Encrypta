import clsx from 'clsx'
import { Globe2, KeyRound, Lock, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import CallOverlay from '../components/CallOverlay'
import ChatView from '../components/ChatView'
import { DetailsModal, NewGroupModal, ProfileModal } from '../components/Modals'
import PeoplePanel from '../components/PeoplePanel'
import Sidebar, { type Panel } from '../components/Sidebar'
import { Logo, Spinner } from '../components/ui'
import { socket } from '../lib/socket'
import { useAuth } from '../store/auth'
import { useCall } from '../store/call'
import { useChat } from '../store/chat'

export default function MessengerPage() {
  const account = useAuth((s) => s.account)!
  const { ready, active, open, bootstrap, handle, unread } = useChat()
  const handleCall = useCall((s) => s.handle)
  const [panel, setPanel] = useState<Panel>('chats')
  const [newGroup, setNewGroup] = useState(false)
  const [details, setDetails] = useState(false)
  const [profile, setProfile] = useState(false)
  const [connected, setConnected] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    const offEvents = socket.on((e) => {
      handle(e)
      handleCall(e)
    })
    const offStatus = socket.onStatus((s) => {
      setConnected(s === 'open')
      // Catch up on anything missed while the socket was down.
      if (s === 'open' && useChat.getState().ready) void bootstrap()
    })
    socket.start()
    bootstrap().catch((e) => setLoadError((e as Error).message))
    return () => {
      offEvents()
      offStatus()
      socket.stop()
    }
  }, [bootstrap, handle, handleCall])

  useEffect(() => {
    const total = Object.values(unread).reduce<number>((a, b) => a + (b ?? 0), 0)
    document.title = total ? `(${total}) Encrypta` : 'Encrypta'
  }, [unread])

  useEffect(() => {
    const onVisible = () => {
      const key = useChat.getState().active
      if (document.visibilityState === 'visible' && key) open(key)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [open])

  if (!ready) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex flex-col items-center gap-4">
          <Logo size={48} />
          {loadError ? <p className="text-sm text-rose-300">{loadError}</p> : <Spinner />}
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-full overflow-hidden">
      <div className="aurora" />
      <div
        className={clsx(
          'relative z-10 h-full w-full shrink-0 border-r border-white/[0.05] md:w-[380px]',
          active ? 'hidden md:block' : 'block',
        )}
      >
        <Sidebar
          panel={panel}
          onPanel={setPanel}
          onNewGroup={() => setNewGroup(true)}
          onProfile={() => setProfile(true)}
          peopleSlot={
            <PeoplePanel
              onOpenChat={(id) => {
                open(`dm:${id}`)
                setPanel('chats')
              }}
            />
          }
        />
      </div>

      <main className={clsx('relative z-10 h-full min-w-0 flex-1', active ? 'block' : 'hidden md:block')}>
        {!connected && (
          <div className="absolute top-[76px] left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-amber-400/15 px-3 py-1.5 text-xs text-amber-200 backdrop-blur">
            <WifiOff className="h-3.5 w-3.5" /> Reconnecting…
          </div>
        )}
        {active ? (
          <ChatView convKey={active} onBack={() => open(null)} onInfo={() => setDetails(true)} />
        ) : (
          <div className="grid h-full place-items-center p-8">
            <div className="max-w-md text-center">
              <div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-brand-500/10">
                <Lock className="h-9 w-9 text-brand-300" />
              </div>
              <h2 className="mt-6 text-2xl font-semibold tracking-tight">Hi {account.display_name.split(' ')[0]}</h2>
              <p className="mt-2 text-ink-300">Pick a conversation, or add someone by username to start one. Everything you send is encrypted on this device first.</p>
              <div className="mt-8 grid grid-cols-3 gap-3 text-xs text-ink-400">
                <Feature icon={<Lock className="h-4 w-4" />} label="Asymmetric DMs" />
                <Feature icon={<KeyRound className="h-4 w-4" />} label="Shared-key groups" />
                <Feature icon={<Globe2 className="h-4 w-4" />} label="Global calls" />
              </div>
            </div>
          </div>
        )}
      </main>

      <NewGroupModal open={newGroup} onClose={() => setNewGroup(false)} onCreated={(key) => open(key)} />
      <DetailsModal convKey={active} open={details} onClose={() => setDetails(false)} />
      <ProfileModal open={profile} onClose={() => setProfile(false)} />
      <CallOverlay />
    </div>
  )
}

function Feature({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="glass flex flex-col items-center gap-2 rounded-2xl px-2 py-4">
      <span className="text-brand-300">{icon}</span>
      {label}
    </div>
  )
}
