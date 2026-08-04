/**
 * Chat view-model reducer: folds the pi RPC event stream into renderable
 * items incrementally. Pure functions — unit-tested without React.
 *
 * Invariants:
 * - Never rebuilds unrelated items; each event touches at most one item plus
 *   the tools map.
 * - `tool_execution_update.partialResult` is accumulated output — REPLACE,
 *   never append.
 * - `message_end` content is authoritative; streamed deltas are best-effort.
 */
import type {
  AgentMessage,
  AssistantMessage,
  BashExecutionMessage,
  CustomMessage,
  PiEvent,
  ToolResultMessage,
} from '@shared/rpc'
import type {
  AssistantBlock,
  AssistantItem,
  BashItem,
  ChatSessionState,
  CustomItem,
  DividerItem,
  ToolState,
  UserItem,
} from './chatItems'
import { emptyChatSession, newItemId } from './chatItems'
import {
  blocksFromContent,
  isAssistant,
  lastAssistantIndex,
  replaceItem,
  toolsFromContent,
  userMessageImages,
  userMessageText,
} from './messageContent'

// The chat surface imports its types from here, so keep one public entry point.
export type {
  AssistantBlock,
  AssistantItem,
  BashItem,
  ChatItem,
  ChatSessionState,
  CustomItem,
  DividerItem,
  ToolState,
  ToolStatus,
  UserItem,
} from './chatItems'
export { emptyChatSession, newItemId } from './chatItems'
export { userMessageText } from './messageContent'

// ---------- the reducer ----------

export function reduceChatEvent(state: ChatSessionState, event: PiEvent): ChatSessionState {
  switch (event.type) {
    case 'agent_start':
      return { ...state, isStreaming: true, error: null }

    case 'agent_end': {
      const items = state.items.map((item) =>
        item.kind === 'assistant' && item.streaming ? { ...item, streaming: false } : item,
      )
      return { ...state, isStreaming: false, retry: null, items }
    }

    case 'turn_start':
    case 'turn_end':
      return state

    case 'message_start': {
      const message = event.message
      if (isAssistant(message)) {
        const item: AssistantItem = {
          id: newItemId(),
          kind: 'assistant',
          blocks: [],
          streaming: true,
        }
        return { ...state, items: [...state.items, item] }
      }
      return state
    }

    case 'message_update':
      return applyAssistantDelta(state, event)

    case 'message_end':
      return applyMessageEnd(state, event.message)

    case 'tool_execution_start': {
      const existing = state.tools[event.toolCallId]
      return {
        ...state,
        tools: {
          ...state.tools,
          [event.toolCallId]: {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
            argsText: existing?.argsText ?? JSON.stringify(event.args ?? {}),
            status: 'running',
            output: existing?.output ?? null,
            startedAt: Date.now(),
          },
        },
      }
    }

    case 'tool_execution_update': {
      const existing = state.tools[event.toolCallId]
      if (!existing) return state
      return {
        ...state,
        tools: {
          ...state.tools,
          // partialResult is accumulated: replace, don't append.
          [event.toolCallId]: { ...existing, output: event.partialResult, status: 'running' },
        },
      }
    }

    case 'tool_execution_end': {
      const existing = state.tools[event.toolCallId]
      const base: ToolState = existing ?? {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        argsText: '',
        status: 'running',
        output: null,
      }
      return {
        ...state,
        tools: {
          ...state.tools,
          [event.toolCallId]: {
            ...base,
            result: event.result,
            output: event.result,
            isError: event.isError,
            status: event.isError ? 'error' : 'done',
            endedAt: Date.now(),
          },
        },
      }
    }

    case 'queue_update':
      return { ...state, queues: { steering: event.steering, followUp: event.followUp } }

    case 'compaction_start':
      return { ...state, isCompacting: true }

    case 'compaction_end': {
      const items = [...state.items]
      if (event.result) {
        items.push({
          id: newItemId(),
          kind: 'divider',
          variant: 'compaction',
          summary: event.result.summary,
          tokensBefore: event.result.tokensBefore,
          reason: event.reason,
        })
      } else if (!event.aborted && event.errorMessage) {
        items.push({
          id: newItemId(),
          kind: 'divider',
          variant: 'error',
          summary: `Compaction failed: ${event.errorMessage}`,
        })
      }
      return { ...state, isCompacting: false, items }
    }

    case 'auto_retry_start':
      return {
        ...state,
        retry: {
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          errorMessage: event.errorMessage,
        },
      }

    case 'auto_retry_end': {
      const items = event.success
        ? state.items
        : [
            ...state.items,
            {
              id: newItemId(),
              kind: 'divider' as const,
              variant: 'error' as const,
              summary: `Auto-retry gave up after ${event.attempt} attempts${event.finalError ? `: ${event.finalError}` : ''}`,
            },
          ]
      return { ...state, retry: null, items }
    }

    case 'extension_error': {
      const items = [
        ...state.items,
        {
          id: newItemId(),
          kind: 'divider' as const,
          variant: 'error' as const,
          summary: `Extension error${event.extensionPath ? ` (${event.extensionPath})` : ''}: ${event.error}`,
        },
      ]
      return { ...state, items }
    }

    default:
      return state
  }
}

/**
 * Append streamed text to the block at `contentIndex`, creating it when the
 * delta arrives before its `*_start` event. Blocks stay sorted by index so
 * out-of-order arrivals still render in the model's order.
 *
 * Shared by the `text` and `thinking` paths, which differ only in discriminant.
 */
function appendTextishDelta(
  blocks: AssistantBlock[],
  contentIndex: number,
  delta: string,
  kind: 'text' | 'thinking',
): AssistantBlock[] {
  if (blocks.some((b) => b.index === contentIndex)) {
    return blocks.map((b) =>
      b.index === contentIndex && b.type === kind ? { ...b, text: b.text + delta } : b,
    )
  }
  return [...blocks, { type: kind, index: contentIndex, text: delta, closed: false }].sort(
    (a, b) => a.index - b.index,
  )
}

function applyAssistantDelta(
  state: ChatSessionState,
  event: Extract<PiEvent, { type: 'message_update' }>,
): ChatSessionState {
  const delta = event.assistantMessageEvent
  const index = lastAssistantIndex(state.items)
  if (index === -1) return state
  const item = state.items[index] as AssistantItem

  const ensureBlock = (
    blocks: AssistantBlock[],
    contentIndex: number,
    make: () => AssistantBlock,
  ): AssistantBlock[] => {
    if (blocks.some((b) => b.index === contentIndex)) return blocks
    return [...blocks, make()].sort((a, b) => a.index - b.index)
  }

  switch (delta.type) {
    case 'start':
      return state

    case 'text_start':
    case 'thinking_start': {
      const kind = delta.type === 'text_start' ? 'text' : 'thinking'
      const blocks = ensureBlock(item.blocks, delta.contentIndex, () => ({
        type: kind,
        index: delta.contentIndex,
        text: '',
        closed: false,
      }))
      return { ...state, items: replaceItem(state.items, index, { ...item, blocks }) }
    }

    case 'text_delta':
    case 'thinking_delta': {
      const kind = delta.type === 'text_delta' ? 'text' : 'thinking'
      const blocks = appendTextishDelta(item.blocks, delta.contentIndex, delta.delta, kind)
      return { ...state, items: replaceItem(state.items, index, { ...item, blocks }) }
    }

    case 'text_end':
    case 'thinking_end': {
      const kind = delta.type === 'text_end' ? 'text' : 'thinking'
      const blocks = item.blocks.map((b) =>
        b.index === delta.contentIndex && b.type === kind
          ? { ...b, text: delta.content ?? b.text, closed: true }
          : b,
      )
      return { ...state, items: replaceItem(state.items, index, { ...item, blocks }) }
    }

    case 'toolcall_start': {
      // The partial message may already carry the toolCall id/name.
      const partialBlock = delta.partial?.content?.[delta.contentIndex]
      const toolCallId =
        partialBlock && partialBlock.type === 'toolCall'
          ? partialBlock.id
          : `pending-${item.id}-${delta.contentIndex}`
      const toolName =
        partialBlock && partialBlock.type === 'toolCall' ? partialBlock.name : 'unknown'

      const blocks = ensureBlock(item.blocks, delta.contentIndex, () => ({
        type: 'tool',
        index: delta.contentIndex,
        toolCallId,
      }))
      const tools = state.tools[toolCallId]
        ? state.tools
        : {
            ...state.tools,
            [toolCallId]: {
              toolCallId,
              toolName,
              argsText: '',
              status: 'starting' as const,
              output: null,
            },
          }
      return { ...state, items: replaceItem(state.items, index, { ...item, blocks }), tools }
    }

    case 'toolcall_delta': {
      const block = item.blocks.find((b) => b.index === delta.contentIndex)
      if (!block || block.type !== 'tool') return state
      const tool = state.tools[block.toolCallId]
      if (!tool) return state
      return {
        ...state,
        tools: {
          ...state.tools,
          [block.toolCallId]: { ...tool, argsText: tool.argsText + delta.delta },
        },
      }
    }

    case 'toolcall_end': {
      const block = item.blocks.find((b) => b.index === delta.contentIndex)
      if (!block || block.type !== 'tool' || !delta.toolCall) return state
      const finalId = delta.toolCall.id
      const oldId = block.toolCallId
      const old = state.tools[oldId]

      const tools = { ...state.tools }
      if (oldId !== finalId) delete tools[oldId]
      tools[finalId] = {
        toolCallId: finalId,
        toolName: delta.toolCall.name,
        args: delta.toolCall.arguments,
        argsText: old?.argsText || JSON.stringify(delta.toolCall.arguments ?? {}),
        status: old?.status === 'running' || old?.status === 'done' ? old.status : 'starting',
        output: old?.output ?? null,
        result: old?.result,
        isError: old?.isError,
        startedAt: old?.startedAt,
        endedAt: old?.endedAt,
      }

      const blocks =
        oldId === finalId
          ? item.blocks
          : item.blocks.map((b) =>
              b.index === delta.contentIndex && b.type === 'tool'
                ? { ...b, toolCallId: finalId }
                : b,
            )
      return { ...state, items: replaceItem(state.items, index, { ...item, blocks }), tools }
    }

    case 'done': {
      const updated: AssistantItem = { ...item, stopReason: delta.reason }
      return { ...state, items: replaceItem(state.items, index, updated) }
    }

    case 'error': {
      const message = delta.message
      const updated: AssistantItem = {
        ...item,
        streaming: false,
        stopReason: delta.reason,
        errorMessage:
          message?.errorMessage ?? (typeof delta.error === 'string' ? delta.error : undefined),
      }
      return { ...state, items: replaceItem(state.items, index, updated) }
    }

    default:
      return state
  }
}

function applyMessageEnd(state: ChatSessionState, message: AgentMessage): ChatSessionState {
  if (!('role' in message)) return state

  switch (message.role) {
    case 'assistant': {
      const assistant = message as AssistantMessage
      const index = lastAssistantIndex(state.items)
      if (index === -1) {
        // No streamed counterpart (e.g. hydration edge): append final.
        const item: AssistantItem = {
          id: newItemId(),
          kind: 'assistant',
          blocks: blocksFromContent(assistant),
          streaming: false,
          stopReason: assistant.stopReason,
          errorMessage: assistant.errorMessage,
          usage: assistant.usage,
          model: assistant.model,
          timestamp: assistant.timestamp,
        }
        return {
          ...state,
          items: [...state.items, item],
          tools: toolsFromContent(assistant, state.tools),
        }
      }
      const item = state.items[index] as AssistantItem
      const updated: AssistantItem = {
        ...item,
        blocks: blocksFromContent(assistant),
        streaming: false,
        stopReason: assistant.stopReason,
        errorMessage: assistant.errorMessage,
        usage: assistant.usage,
        model: assistant.model,
        timestamp: assistant.timestamp,
      }
      return {
        ...state,
        items: replaceItem(state.items, index, updated),
        tools: toolsFromContent(assistant, state.tools),
      }
    }

    case 'user': {
      const text = userMessageText(message)
      // Dedup against the optimistic item we appended on send.
      for (let i = state.items.length - 1; i >= 0; i--) {
        const item = state.items[i]!
        if (item.kind === 'assistant') continue
        if (item.kind === 'user') {
          if (item.optimistic && item.text === text) {
            const items = replaceItem(state.items, i, { ...item, optimistic: false })
            return { ...state, items }
          }
          break
        }
        break
      }
      const item: UserItem = {
        id: newItemId(),
        kind: 'user',
        text,
        images: userMessageImages(message),
        timestamp: message.timestamp,
      }
      return { ...state, items: [...state.items, item] }
    }

    case 'toolResult': {
      const result = message as ToolResultMessage
      const existing = state.tools[result.toolCallId]
      const base: ToolState = existing ?? {
        toolCallId: result.toolCallId,
        toolName: result.toolName,
        argsText: '',
        status: 'running',
        output: null,
      }
      return {
        ...state,
        tools: {
          ...state.tools,
          [result.toolCallId]: {
            ...base,
            result: { content: result.content, details: result.details },
            output: { content: result.content, details: result.details },
            isError: result.isError,
            status: result.isError ? 'error' : 'done',
            endedAt: base.endedAt ?? Date.now(),
          },
        },
      }
    }

    case 'custom':
    case 'customMessage': {
      const item = customItemFrom(message as CustomMessage)
      // `display: false` means the extension wants it hidden from the UI.
      return item ? { ...state, items: [...state.items, item] } : state
    }

    default:
      return state
  }
}

/**
 * Build a renderable item from an extension-injected message.
 * Returns null when the extension marked it non-displayable.
 */
function customItemFrom(message: CustomMessage): CustomItem | null {
  if (message.display === false) return null
  const content = message.content
  const text =
    typeof content === 'string'
      ? content
      : (userMessageText({ content: content as Array<{ type: string; text?: string }> }) ?? '')
  const images = userMessageImages({
    content: content as string | Array<{ type: string; data?: string; mimeType?: string }>,
  })
  if (!text && !images) return null
  return {
    id: newItemId(),
    kind: 'custom',
    customType: typeof message.customType === 'string' ? message.customType : undefined,
    text,
    images,
    // `customMessage` role == pi's custom_message entry: it reaches the LLM.
    inContext: message.role === 'customMessage',
  }
}

// ---------- hydration from get_messages (resume / attach) ----------

export function hydrateFromMessages(messages: AgentMessage[]): ChatSessionState {
  let state = emptyChatSession()
  for (const message of messages) {
    if (!('role' in message)) continue
    switch (message.role) {
      case 'user': {
        const item: UserItem = {
          id: newItemId(),
          kind: 'user',
          text: userMessageText(message),
          images: userMessageImages(message),
          timestamp: message.timestamp,
        }
        state = { ...state, items: [...state.items, item] }
        break
      }
      case 'assistant': {
        const assistant = message as AssistantMessage
        const item: AssistantItem = {
          id: newItemId(),
          kind: 'assistant',
          blocks: blocksFromContent(assistant),
          streaming: false,
          stopReason: assistant.stopReason,
          errorMessage: assistant.errorMessage,
          usage: assistant.usage,
          model: assistant.model,
          timestamp: assistant.timestamp,
        }
        state = {
          ...state,
          items: [...state.items, item],
          tools: toolsFromContent(assistant, state.tools),
        }
        break
      }
      case 'toolResult':
        state = applyMessageEnd(state, message)
        break
      case 'bashExecution': {
        const bash = message as BashExecutionMessage
        const item: BashItem = {
          id: newItemId(),
          kind: 'bash',
          command: bash.command,
          output: bash.output,
          exitCode: bash.exitCode,
          running: false,
          truncated: bash.truncated,
          fullOutputPath: bash.fullOutputPath,
          excludeFromContext: bash.excludeFromContext,
        }
        state = { ...state, items: [...state.items, item] }
        break
      }
      case 'compactionSummary': {
        const item: DividerItem = {
          id: newItemId(),
          kind: 'divider',
          variant: 'compaction',
          summary: (message as { summary?: string }).summary,
          tokensBefore: (message as { tokensBefore?: number }).tokensBefore,
        }
        state = { ...state, items: [...state.items, item] }
        break
      }
      case 'branchSummary': {
        const item: DividerItem = {
          id: newItemId(),
          kind: 'divider',
          variant: 'branchSummary',
          summary: (message as { summary?: string }).summary,
        }
        state = { ...state, items: [...state.items, item] }
        break
      }
      case 'custom':
      case 'customMessage': {
        const item = customItemFrom(message as CustomMessage)
        if (item) state = { ...state, items: [...state.items, item] }
        break
      }
      default:
        break
    }
  }
  return state
}
