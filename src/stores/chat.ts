import { create } from 'zustand'
import type { AgentMessage, AssistantMessage, PiEvent } from '@shared/rpc'

/**
 * P0 chat view-model: user + streamed assistant text messages.
 * P1 expands this into the full reducer (tools, thinking, queues, compaction).
 */

export interface UserItem {
  id: string
  kind: 'user'
  text: string
}

export interface AssistantItem {
  id: string
  kind: 'assistant'
  /** Ordered text segments (indexes follow contentIndex). */
  text: string
  streaming: boolean
  stopReason?: string
  errorMessage?: string
}

export type ChatItem = UserItem | AssistantItem

export interface ChatSessionState {
  items: ChatItem[]
  isStreaming: boolean
  /** Transport-level error (pi crashed, command failed). */
  error: string | null
}

interface ChatStore {
  sessions: Record<string, ChatSessionState>
  ensure: (sessionId: string) => void
  addUserMessage: (sessionId: string, text: string) => void
  applyEvent: (sessionId: string, event: PiEvent) => void
  setError: (sessionId: string, error: string | null) => void
  reset: (sessionId: string) => void
}

const emptySession = (): ChatSessionState => ({ items: [], isStreaming: false, error: null })

let nextItemId = 1
const newItemId = (): string => `item-${nextItemId++}`

function assistantTextFrom(message: AgentMessage | undefined): string {
  if (!message || !('role' in message) || message.role !== 'assistant') return ''
  const assistant = message as AssistantMessage
  return assistant.content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n\n')
}

export const useChatStore = create<ChatStore>((set, get) => ({
  sessions: {},

  ensure: (sessionId) => {
    if (!get().sessions[sessionId]) {
      set((state) => ({ sessions: { ...state.sessions, [sessionId]: emptySession() } }))
    }
  },

  addUserMessage: (sessionId, text) => {
    set((state) => {
      const session = state.sessions[sessionId] ?? emptySession()
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            items: [...session.items, { id: newItemId(), kind: 'user', text }],
          },
        },
      }
    })
  },

  applyEvent: (sessionId, event) => {
    set((state) => {
      const session = state.sessions[sessionId] ?? emptySession()
      const next = reduceEvent(session, event)
      if (next === session) return state
      return { sessions: { ...state.sessions, [sessionId]: next } }
    })
  },

  setError: (sessionId, error) => {
    set((state) => {
      const session = state.sessions[sessionId] ?? emptySession()
      return { sessions: { ...state.sessions, [sessionId]: { ...session, error } } }
    })
  },

  reset: (sessionId) => {
    set((state) => ({ sessions: { ...state.sessions, [sessionId]: emptySession() } }))
  },
}))

function reduceEvent(session: ChatSessionState, event: PiEvent): ChatSessionState {
  switch (event.type) {
    case 'agent_start':
      return { ...session, isStreaming: true, error: null }

    case 'agent_end':
      return {
        ...session,
        isStreaming: false,
        items: finalizeStreaming(session.items),
      }

    case 'message_start': {
      const message = event.message
      if ('role' in message && message.role === 'assistant') {
        return {
          ...session,
          items: [
            ...session.items,
            { id: newItemId(), kind: 'assistant', text: '', streaming: true },
          ],
        }
      }
      return session
    }

    case 'message_update': {
      const delta = event.assistantMessageEvent
      if (delta.type === 'text_delta') {
        return updateLastAssistant(session, (item) => ({ ...item, text: item.text + delta.delta }))
      }
      if (delta.type === 'error') {
        return updateLastAssistant(session, (item) => ({
          ...item,
          streaming: false,
          stopReason: delta.reason,
          errorMessage:
            typeof delta.error === 'string' ? delta.error : delta.error ? String(delta.error) : undefined,
        }))
      }
      return session
    }

    case 'message_end': {
      const message = event.message
      if (!('role' in message) || message.role !== 'assistant') return session
      const assistant = message as AssistantMessage
      // Snap to the authoritative final text; deltas can be lossy on abort.
      const finalText = assistantTextFrom(assistant)
      return updateLastAssistant(session, (item) => ({
        ...item,
        text: finalText || item.text,
        streaming: false,
        stopReason: assistant.stopReason,
        errorMessage: assistant.errorMessage,
      }))
    }

    default:
      return session
  }
}

function updateLastAssistant(
  session: ChatSessionState,
  update: (item: AssistantItem) => AssistantItem,
): ChatSessionState {
  for (let i = session.items.length - 1; i >= 0; i--) {
    const item = session.items[i]
    if (item && item.kind === 'assistant') {
      const items = session.items.slice()
      items[i] = update(item)
      return { ...session, items }
    }
  }
  return session
}

function finalizeStreaming(items: ChatItem[]): ChatItem[] {
  return items.map((item) =>
    item.kind === 'assistant' && item.streaming ? { ...item, streaming: false } : item,
  )
}
