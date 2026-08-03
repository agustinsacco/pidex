import { create } from 'zustand'
import type { SessionPush } from '@shared/models'
import { useChatStore } from './chat'

interface SessionsState {
  /** pidex session id of the currently displayed session. */
  activeSessionId: string | null
  creating: boolean
  createSession: (workspacePath: string) => Promise<string>
  disposeSession: (sessionId: string) => Promise<void>
}

const unsubscribers = new Map<string, () => void>()

export const useSessionsStore = create<SessionsState>((set) => ({
  activeSessionId: null,
  creating: false,

  createSession: async (workspacePath) => {
    set({ creating: true })
    try {
      const info = await window.pidex.invoke('pi:createSession', { workspacePath })
      const chat = useChatStore.getState()
      chat.ensure(info.sessionId)

      const unsubscribe = window.pidex.onSessionPush(info.sessionId, (push: SessionPush) => {
        const chatStore = useChatStore.getState()
        switch (push.kind) {
          case 'event':
            chatStore.applyEvent(info.sessionId, push.event)
            break
          case 'exit':
            if (!push.expected) {
              chatStore.setError(
                info.sessionId,
                `pi exited unexpectedly (code ${push.code ?? 'unknown'}). The session file is preserved — you can resume it.`,
              )
            }
            break
          case 'stderr':
            console.warn(`[pi stderr] ${push.text}`)
            break
          case 'extension-ui':
            // P6 implements the full extension UI protocol.
            break
        }
      })
      unsubscribers.set(info.sessionId, unsubscribe)

      set({ activeSessionId: info.sessionId })
      return info.sessionId
    } finally {
      set({ creating: false })
    }
  },

  disposeSession: async (sessionId) => {
    unsubscribers.get(sessionId)?.()
    unsubscribers.delete(sessionId)
    await window.pidex.invoke('pi:disposeSession', sessionId)
    set((state) => (state.activeSessionId === sessionId ? { activeSessionId: null } : state))
  },
}))
