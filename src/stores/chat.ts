import { create } from 'zustand'
import type {
  AgentMessage,
  ImageContent,
  Model,
  PiEvent,
  RpcSessionState,
  RpcSlashCommand,
  SessionStats,
  ThinkingLevel,
} from '@shared/rpc'
import {
  emptyChatSession,
  hydrateFromMessages,
  newItemId,
  reduceChatEvent,
  type BashItem,
  type ChatSessionState,
} from '@/features/chat/reducer'

export interface ChatSession extends ChatSessionState {
  /** Session metadata fetched over RPC. */
  meta: RpcSessionState | null
  stats: SessionStats | null
  models: Model[]
  commands: RpcSlashCommand[]
  /**
   * Levels the current model supports, straight from pi
   * (`get_available_thinking_levels`). `null` means "not asked yet" — the
   * picker then derives them locally rather than falling back to a hardcoded
   * list that is wrong for most models.
   */
  thinkingLevels: ThinkingLevel[] | null
  /**
   * True between opening a session that has history on disk and that history
   * arriving. Distinguishes "resuming, messages still replaying" from "brand
   * new session, nothing to show" — without it the chat rendered its empty
   * state over a session with ten turns of history.
   */
  resuming: boolean
}

const emptySession = (): ChatSession => ({
  ...emptyChatSession(),
  meta: null,
  stats: null,
  models: [],
  commands: [],
  thinkingLevels: null,
  resuming: false,
})

interface ChatStore {
  sessions: Record<string, ChatSession>
  ensure: (sessionId: string, options?: { resuming?: boolean }) => void
  applyEvent: (sessionId: string, event: PiEvent) => void
  addUserMessage: (sessionId: string, text: string, images?: ImageContent[]) => void
  addBashItem: (sessionId: string, item: Omit<BashItem, 'id' | 'kind'>) => string
  updateBashItem: (sessionId: string, id: string, patch: Partial<BashItem>) => void
  hydrate: (sessionId: string, messages: AgentMessage[]) => void
  /** Clear the resuming flag; safe to call when it is already clear. */
  doneResuming: (sessionId: string) => void
  setError: (sessionId: string, error: string | null) => void
  setMeta: (sessionId: string, meta: RpcSessionState) => void
  patchMeta: (sessionId: string, patch: Partial<RpcSessionState>) => void
  setStats: (sessionId: string, stats: SessionStats) => void
  setModels: (sessionId: string, models: Model[]) => void
  setCommands: (sessionId: string, commands: RpcSlashCommand[]) => void
  setThinkingLevels: (sessionId: string, levels: ThinkingLevel[] | null) => void
  remove: (sessionId: string) => void
}

function patchSession(
  sessions: Record<string, ChatSession>,
  sessionId: string,
  patch: Partial<ChatSession>,
): Record<string, ChatSession> {
  const session = sessions[sessionId] ?? emptySession()
  return { ...sessions, [sessionId]: { ...session, ...patch } }
}

export const useChatStore = create<ChatStore>((set) => ({
  sessions: {},

  ensure: (sessionId, options) =>
    set((state) =>
      state.sessions[sessionId]
        ? state
        : {
            sessions: {
              ...state.sessions,
              [sessionId]: { ...emptySession(), resuming: options?.resuming ?? false },
            },
          },
    ),

  applyEvent: (sessionId, event) =>
    set((state) => {
      const session = state.sessions[sessionId] ?? emptySession()
      const reduced = reduceChatEvent(session, event)
      if (reduced === session) return state
      return { sessions: { ...state.sessions, [sessionId]: { ...session, ...reduced } } }
    }),

  addUserMessage: (sessionId, text, images) =>
    set((state) => {
      const session = state.sessions[sessionId] ?? emptySession()
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            items: [
              ...session.items,
              { id: newItemId(), kind: 'user', text, images, optimistic: true },
            ],
          },
        },
      }
    }),

  addBashItem: (sessionId, item) => {
    const id = newItemId()
    set((state) => {
      const session = state.sessions[sessionId] ?? emptySession()
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            items: [...session.items, { ...item, id, kind: 'bash' }],
          },
        },
      }
    })
    return id
  },

  updateBashItem: (sessionId, id, patch) =>
    set((state) => {
      const session = state.sessions[sessionId]
      if (!session) return state
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            items: session.items.map((item) =>
              item.id === id && item.kind === 'bash' ? { ...item, ...patch } : item,
            ),
          },
        },
      }
    }),

  hydrate: (sessionId, messages) =>
    set((state) => {
      const session = state.sessions[sessionId] ?? emptySession()
      const hydrated = hydrateFromMessages(messages)
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...session, ...hydrated, resuming: false },
        },
      }
    }),

  doneResuming: (sessionId) =>
    set((s) =>
      s.sessions[sessionId]?.resuming
        ? { sessions: patchSession(s.sessions, sessionId, { resuming: false }) }
        : s,
    ),

  setError: (sessionId, error) =>
    set((s) => ({
      sessions: patchSession(s.sessions, sessionId, {
        error,
        ...(error ? { resuming: false } : {}),
      }),
    })),
  setMeta: (sessionId, meta) =>
    set((s) => ({ sessions: patchSession(s.sessions, sessionId, { meta }) })),
  patchMeta: (sessionId, patch) =>
    set((s) => {
      const session = s.sessions[sessionId]
      if (!session?.meta) return s
      return {
        sessions: patchSession(s.sessions, sessionId, { meta: { ...session.meta, ...patch } }),
      }
    }),
  setStats: (sessionId, stats) =>
    set((s) => ({ sessions: patchSession(s.sessions, sessionId, { stats }) })),
  setModels: (sessionId, models) =>
    set((s) => ({ sessions: patchSession(s.sessions, sessionId, { models }) })),
  setCommands: (sessionId, commands) =>
    set((s) => ({ sessions: patchSession(s.sessions, sessionId, { commands }) })),
  setThinkingLevels: (sessionId, levels) =>
    set((s) => ({ sessions: patchSession(s.sessions, sessionId, { thinkingLevels: levels }) })),

  remove: (sessionId) =>
    set((state) => {
      if (!state.sessions[sessionId]) return state
      const sessions = { ...state.sessions }
      delete sessions[sessionId]
      return { sessions }
    }),
}))
