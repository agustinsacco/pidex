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

/** Fetch session metadata over RPC and stash it in the chat store. */
async function bootstrapSession(sessionId: string): Promise<void> {
  const chat = useChatStore.getState()
  const [state, models, commands, stats] = await Promise.allSettled([
    window.pidex.piCommand(sessionId, { type: 'get_state' }),
    window.pidex.piCommand(sessionId, { type: 'get_available_models' }),
    window.pidex.piCommand(sessionId, { type: 'get_commands' }),
    window.pidex.piCommand(sessionId, { type: 'get_session_stats' }),
  ])
  if (state.status === 'fulfilled' && state.value.success && state.value.data) {
    chat.setMeta(sessionId, state.value.data)
  }
  if (models.status === 'fulfilled' && models.value.success && models.value.data) {
    chat.setModels(sessionId, models.value.data.models)
  }
  if (commands.status === 'fulfilled' && commands.value.success && commands.value.data) {
    chat.setCommands(sessionId, commands.value.data.commands)
  }
  if (stats.status === 'fulfilled' && stats.value.success && stats.value.data) {
    chat.setStats(sessionId, stats.value.data)
  }
}

async function refreshStats(sessionId: string): Promise<void> {
  try {
    const response = await window.pidex.piCommand(sessionId, { type: 'get_session_stats' })
    if (response.success && response.data) {
      useChatStore.getState().setStats(sessionId, response.data)
    }
  } catch {
    // session likely gone; ignore
  }
}

export function attachSessionPushHandler(sessionId: string): void {
  const unsubscribe = window.pidex.onSessionPush(sessionId, (push: SessionPush) => {
    const chatStore = useChatStore.getState()
    switch (push.kind) {
      case 'event':
        chatStore.applyEvent(sessionId, push.event)
        if (push.event.type === 'agent_end' || push.event.type === 'compaction_end') {
          void refreshStats(sessionId)
        }
        break
      case 'exit':
        if (!push.expected) {
          chatStore.setError(
            sessionId,
            `pi exited unexpectedly (code ${push.code ?? 'unknown'}). The session file is preserved — you can resume it.`,
          )
        }
        break
      case 'stderr':
        console.warn(`[pi stderr] ${push.text}`)
        break
      case 'extension-ui':
        // Full extension-UI protocol lands in P6.
        break
    }
  })
  unsubscribers.set(sessionId, unsubscribe)
}

export const useSessionsStore = create<SessionsState>((set) => ({
  activeSessionId: null,
  creating: false,

  createSession: async (workspacePath) => {
    set({ creating: true })
    try {
      const info = await window.pidex.invoke('pi:createSession', { workspacePath })
      useChatStore.getState().ensure(info.sessionId)
      attachSessionPushHandler(info.sessionId)
      set({ activeSessionId: info.sessionId })
      void bootstrapSession(info.sessionId)
      return info.sessionId
    } finally {
      set({ creating: false })
    }
  },

  disposeSession: async (sessionId) => {
    unsubscribers.get(sessionId)?.()
    unsubscribers.delete(sessionId)
    await window.pidex.invoke('pi:disposeSession', sessionId)
    useChatStore.getState().remove(sessionId)
    set((state) => (state.activeSessionId === sessionId ? { activeSessionId: null } : state))
  },
}))
