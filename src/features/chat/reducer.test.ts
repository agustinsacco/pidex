import { describe, expect, it } from 'vitest'
import {
  emptyChatSession,
  hydrateFromMessages,
  reduceChatEvent,
  type AssistantItem,
  type ChatSessionState,
} from './reducer'
import type { AssistantMessage, PiEvent } from '@shared/rpc'

function run(events: PiEvent[], initial?: ChatSessionState): ChatSessionState {
  return events.reduce(reduceChatEvent, initial ?? emptyChatSession())
}

const assistantStart: PiEvent = {
  type: 'message_start',
  message: { role: 'assistant', content: [] },
}

function textDelta(delta: string, contentIndex = 0): PiEvent {
  return {
    type: 'message_update',
    message: { role: 'assistant', content: [] },
    assistantMessageEvent: { type: 'text_delta', contentIndex, delta },
  }
}

describe('chat reducer — streaming text', () => {
  it('accumulates text deltas into one assistant item', () => {
    const state = run([
      { type: 'agent_start' },
      assistantStart,
      textDelta('Hello'),
      textDelta(' world'),
    ])
    expect(state.isStreaming).toBe(true)
    const item = state.items[0] as AssistantItem
    expect(item.kind).toBe('assistant')
    expect(item.blocks).toEqual([{ type: 'text', index: 0, text: 'Hello world', closed: false }])
  })

  it('closes text blocks on text_end and snaps to authoritative content', () => {
    const state = run([
      assistantStart,
      textDelta('Hel'),
      {
        type: 'message_update',
        message: { role: 'assistant', content: [] },
        assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: 'Hello!' },
      },
    ])
    const item = state.items[0] as AssistantItem
    expect(item.blocks[0]).toEqual({ type: 'text', index: 0, text: 'Hello!', closed: true })
  })

  it('message_end snaps blocks to final content and clears streaming', () => {
    const final: AssistantMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Final answer' }],
      stopReason: 'stop',
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
    }
    const state = run([
      assistantStart,
      textDelta('Fin'),
      { type: 'message_end', message: final },
      { type: 'agent_end', messages: [final] },
    ])
    const item = state.items[0] as AssistantItem
    expect(item.streaming).toBe(false)
    expect(item.stopReason).toBe('stop')
    expect(item.blocks[0]).toEqual({ type: 'text', index: 0, text: 'Final answer', closed: true })
    expect(state.isStreaming).toBe(false)
  })

  it('keeps interleaved thinking and text blocks ordered by contentIndex', () => {
    const state = run([
      assistantStart,
      {
        type: 'message_update',
        message: { role: 'assistant', content: [] },
        assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'hmm' },
      },
      textDelta('answer', 1),
    ])
    const item = state.items[0] as AssistantItem
    expect(item.blocks.map((b) => b.type)).toEqual(['thinking', 'text'])
  })
})

describe('chat reducer — tool calls', () => {
  const toolFlow: PiEvent[] = [
    assistantStart,
    {
      type: 'message_update',
      message: { role: 'assistant', content: [] },
      assistantMessageEvent: {
        type: 'toolcall_start',
        contentIndex: 0,
        partial: {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'call_1', name: 'bash', arguments: {} }],
        },
      },
    },
    {
      type: 'message_update',
      message: { role: 'assistant', content: [] },
      assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 0, delta: '{"command":' },
    },
    {
      type: 'message_update',
      message: { role: 'assistant', content: [] },
      assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 0, delta: '"ls -la"}' },
    },
    {
      type: 'message_update',
      message: { role: 'assistant', content: [] },
      assistantMessageEvent: {
        type: 'toolcall_end',
        contentIndex: 0,
        toolCall: { type: 'toolCall', id: 'call_1', name: 'bash', arguments: { command: 'ls -la' } },
      },
    },
  ]

  it('creates a tool block and streams args', () => {
    const state = run(toolFlow)
    const item = state.items[0] as AssistantItem
    expect(item.blocks[0]).toEqual({ type: 'tool', index: 0, toolCallId: 'call_1' })
    const tool = state.tools['call_1']!
    expect(tool.toolName).toBe('bash')
    expect(tool.argsText).toBe('{"command":"ls -la"}')
    expect(tool.args).toEqual({ command: 'ls -la' })
  })

  it('REPLACES output on tool_execution_update (accumulated partials)', () => {
    const state = run([
      ...toolFlow,
      { type: 'tool_execution_start', toolCallId: 'call_1', toolName: 'bash', args: { command: 'ls' } },
      {
        type: 'tool_execution_update',
        toolCallId: 'call_1',
        toolName: 'bash',
        args: {},
        partialResult: { content: [{ type: 'text', text: 'line1\n' }] },
      },
      {
        type: 'tool_execution_update',
        toolCallId: 'call_1',
        toolName: 'bash',
        args: {},
        partialResult: { content: [{ type: 'text', text: 'line1\nline2\n' }] },
      },
    ])
    const tool = state.tools['call_1']!
    expect(tool.status).toBe('running')
    expect(tool.output?.content).toEqual([{ type: 'text', text: 'line1\nline2\n' }])
  })

  it('finalizes on tool_execution_end with error styling', () => {
    const state = run([
      ...toolFlow,
      { type: 'tool_execution_start', toolCallId: 'call_1', toolName: 'bash', args: {} },
      {
        type: 'tool_execution_end',
        toolCallId: 'call_1',
        toolName: 'bash',
        result: { content: [{ type: 'text', text: 'boom' }] },
        isError: true,
      },
    ])
    expect(state.tools['call_1']!.status).toBe('error')
    expect(state.tools['call_1']!.isError).toBe(true)
  })

  it('reconciles placeholder tool ids when toolcall_start lacks the id', () => {
    const state = run([
      assistantStart,
      {
        type: 'message_update',
        message: { role: 'assistant', content: [] },
        assistantMessageEvent: { type: 'toolcall_start', contentIndex: 0 },
      },
      {
        type: 'message_update',
        message: { role: 'assistant', content: [] },
        assistantMessageEvent: {
          type: 'toolcall_end',
          contentIndex: 0,
          toolCall: { type: 'toolCall', id: 'real-id', name: 'grep', arguments: { pattern: 'x' } },
        },
      },
    ])
    const item = state.items[0] as AssistantItem
    expect(item.blocks[0]).toMatchObject({ type: 'tool', toolCallId: 'real-id' })
    expect(state.tools['real-id']!.toolName).toBe('grep')
    expect(Object.keys(state.tools)).toHaveLength(1)
  })
})

describe('chat reducer — queues, compaction, retry', () => {
  it('tracks queue_update', () => {
    const state = run([{ type: 'queue_update', steering: ['do X'], followUp: ['then Y'] }])
    expect(state.queues).toEqual({ steering: ['do X'], followUp: ['then Y'] })
  })

  it('adds a compaction divider with summary', () => {
    const state = run([
      { type: 'compaction_start', reason: 'threshold' },
      {
        type: 'compaction_end',
        reason: 'threshold',
        result: { summary: 'We did things', firstKeptEntryId: 'aa', tokensBefore: 1234 },
        aborted: false,
      },
    ])
    expect(state.isCompacting).toBe(false)
    expect(state.items[0]).toMatchObject({
      kind: 'divider',
      variant: 'compaction',
      summary: 'We did things',
      tokensBefore: 1234,
    })
  })

  it('tracks retry lifecycle and failure divider', () => {
    let state = run([
      {
        type: 'auto_retry_start',
        attempt: 2,
        maxAttempts: 3,
        delayMs: 4000,
        errorMessage: 'overloaded',
      },
    ])
    expect(state.retry).toMatchObject({ attempt: 2, maxAttempts: 3 })
    state = reduceChatEvent(state, { type: 'auto_retry_end', success: false, attempt: 3, finalError: 'still down' })
    expect(state.retry).toBeNull()
    expect(state.items.at(-1)).toMatchObject({ kind: 'divider', variant: 'error' })
  })
})

describe('chat reducer — user echo dedup', () => {
  it('marks the optimistic user item instead of duplicating on echo', () => {
    const withOptimistic: ChatSessionState = {
      ...emptyChatSession(),
      items: [{ id: 'u1', kind: 'user', text: 'hi there', optimistic: true }],
    }
    const state = reduceChatEvent(withOptimistic, {
      type: 'message_end',
      message: { role: 'user', content: 'hi there' },
    })
    expect(state.items).toHaveLength(1)
    expect(state.items[0]).toMatchObject({ kind: 'user', text: 'hi there', optimistic: false })
  })

  it('appends steering user messages that were not local', () => {
    const state = reduceChatEvent(emptyChatSession(), {
      type: 'message_end',
      message: { role: 'user', content: 'steered instruction' },
    })
    expect(state.items).toHaveLength(1)
    expect(state.items[0]).toMatchObject({ kind: 'user', text: 'steered instruction' })
  })
})

describe('chat reducer — hydration', () => {
  it('rebuilds items and tools from get_messages history', () => {
    const state = hydrateFromMessages([
      { role: 'user', content: 'read the file' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'let me look' },
          { type: 'text', text: 'Reading now.' },
          { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: 'a.ts' } },
        ],
        stopReason: 'toolUse',
      },
      {
        role: 'toolResult',
        toolCallId: 'c1',
        toolName: 'read',
        content: [{ type: 'text', text: 'const x = 1' }],
        isError: false,
      },
      { role: 'bashExecution', command: 'ls', output: 'a.ts', exitCode: 0, cancelled: false, truncated: false },
      { role: 'compactionSummary', summary: 'earlier stuff', tokensBefore: 999 },
    ])
    expect(state.items.map((i) => i.kind)).toEqual(['user', 'assistant', 'bash', 'divider'])
    const assistant = state.items[1] as AssistantItem
    expect(assistant.blocks.map((b) => b.type)).toEqual(['thinking', 'text', 'tool'])
    expect(state.tools['c1']).toMatchObject({ toolName: 'read', status: 'done' })
  })
})
