import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './app/App'
import { hostPlatform } from './lib/shortcuts'
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
    void import('./stores/extensionUi').then((m) => {
      ;(window as unknown as Record<string, unknown>).__extUiStore = m.useExtensionUiStore
    })
  }

  // Platform class on <html>, set before the first paint so the CSS that
  // reserves space for window controls (.titlebar-inset-start) never flashes
  // the wrong layout. Read after the mock install above, or browser-only dev
  // has no bridge to ask.
  document.documentElement.classList.add(`platform-${hostPlatform()}`)

  // The floating monitor is the same bundle in a second BrowserWindow; the
  // query flag selects the compact view instead of the whole app.
  const isMonitorWindow = new URLSearchParams(window.location.search).get('view') === 'monitor'
  const { MonitorWindowView } = isMonitorWindow
    ? await import('./features/resources/MonitorModal')
    : { MonitorWindowView: null }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>{MonitorWindowView ? <MonitorWindowView /> : <App />}</React.StrictMode>,
  )
}

void bootstrap()
