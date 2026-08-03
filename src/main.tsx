import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './app/App'
import './styles/index.css'

async function bootstrap(): Promise<void> {
  // Plain-browser dev (vite server without Electron): install the mock API.
  if (import.meta.env.DEV && typeof window.pidex === 'undefined') {
    const { installMockPidex } = await import('./dev/mockPidex')
    installMockPidex()
    // Debug access to stores from the browser console.
    void import('./stores/chat').then((m) => {
      ;(window as unknown as Record<string, unknown>).__chatStore = m.useChatStore
    })
    void import('./stores/sessions').then((m) => {
      ;(window as unknown as Record<string, unknown>).__sessionsStore = m.useSessionsStore
    })
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

void bootstrap()
