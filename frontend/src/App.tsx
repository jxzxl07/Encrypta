import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Spinner } from './components/ui'
import AdminPage from './pages/AdminPage'
import AuthPage from './pages/AuthPage'
import MessengerPage from './pages/MessengerPage'
import { useAuth } from './store/auth'
import { useChat } from './store/chat'

function Home() {
  const status = useAuth((s) => s.status)
  if (status === 'loading') {
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="h-7 w-7" />
      </div>
    )
  }
  return status === 'signedIn' ? <MessengerPage /> : <AuthPage />
}

export default function App() {
  const init = useAuth((s) => s.init)
  const status = useAuth((s) => s.status)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    if (status === 'signedOut') useChat.getState().reset()
  }, [status])

  const unsupported = !globalThis.crypto?.subtle
  if (unsupported) {
    return (
      <div className="grid h-full place-items-center p-8 text-center text-ink-300">
        Encrypta needs a secure (HTTPS) connection and a modern browser for encryption.
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
