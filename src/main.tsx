import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './app/App'
import './styles/index.css'

async function bootstrap(): Promise<void> {
  // Plain-browser dev (vite server without Electron): install the mock API.
  if (import.meta.env.DEV && typeof window.pidex === 'undefined') {
    const { installMockPidex } = await import('./dev/mockPidex')
    installMockPidex()
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

void bootstrap()
