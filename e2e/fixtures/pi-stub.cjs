#!/usr/bin/env node
/**
 * Deterministic pi RPC stub for the e2e smoke test — no API key, no network.
 * Speaks the subset of the protocol the app exercises on startup and for one
 * prompt: state/models/commands/stats, then a streamed answer with an `edit`
 * tool call (drives the Files Changed panel) and an artifact_create tool call
 * (drives the Artifacts pane).
 */
'use strict'

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) !== -1) {
    let line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (line.endsWith('\r')) line = line.slice(0, -1)
    if (line.trim()) {
      try {
        handle(JSON.parse(line))
      } catch {
        /* ignore malformed */
      }
    }
  }
})

const out = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')

const MODEL = {
  id: 'stub-model',
  name: 'Stub Model',
  api: 'stub',
  provider: 'stub',
  reasoning: false,
  input: ['text'],
  contextWindow: 200000,
  maxTokens: 8192,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
}

const DIFF = ' 1 export function hello() {\n-2   return "old"\n+2   return "new"\n 3 }'
const PATCH = `--- a/hello.ts\n+++ b/hello.ts\n@@ -1,3 +1,3 @@\n export function hello() {\n-  return "old"\n+  return "new"\n }`

function handle(cmd) {
  switch (cmd.type) {
    case 'get_state':
      out({
        id: cmd.id,
        type: 'response',
        command: 'get_state',
        success: true,
        data: {
          model: MODEL,
          thinkingLevel: 'off',
          isStreaming: false,
          isCompacting: false,
          steeringMode: 'all',
          followUpMode: 'one-at-a-time',
          sessionId: 'stub-session',
          sessionName: 'E2E stub session',
          autoCompactionEnabled: true,
          messageCount: 0,
          pendingMessageCount: 0,
        },
      })
      break

    case 'get_available_models':
      out({
        id: cmd.id,
        type: 'response',
        command: 'get_available_models',
        success: true,
        data: { models: [MODEL] },
      })
      break

    case 'get_commands':
      out({
        id: cmd.id,
        type: 'response',
        command: 'get_commands',
        success: true,
        data: {
          commands: [{ name: 'stub-command', description: 'A stub command', source: 'extension' }],
        },
      })
      break

    case 'get_session_stats':
      out({
        id: cmd.id,
        type: 'response',
        command: 'get_session_stats',
        success: true,
        data: {
          sessionId: 'stub-session',
          userMessages: 1,
          assistantMessages: 1,
          toolCalls: 2,
          toolResults: 2,
          totalMessages: 4,
          tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
          cost: 0,
          contextUsage: { tokens: 150, contextWindow: 200000, percent: 1 },
        },
      })
      break

    case 'get_messages':
      out({
        id: cmd.id,
        type: 'response',
        command: 'get_messages',
        success: true,
        data: { messages: [] },
      })
      break

    case 'prompt':
      out({ id: cmd.id, type: 'response', command: 'prompt', success: true })
      runTurn()
      break

    case 'abort':
      out({ id: cmd.id, type: 'response', command: 'abort', success: true })
      break

    default:
      out({ id: cmd.id, type: 'response', command: cmd.type, success: true })
  }
}

function runTurn() {
  const steps = []
  const push = (fn) => steps.push(fn)

  push(() => out({ type: 'agent_start' }))
  push(() => out({ type: 'turn_start' }))
  // Third consecutive call: makes this a 3-tool run (grouping) and stays
  // "running" for several ticks so the in-flight animation is observable.
  push(() =>
    out({
      type: 'tool_execution_start',
      toolCallId: 'call_bash',
      toolName: 'bash',
      args: { command: 'npm test' },
    }),
  )
  // Hold this tool in flight long enough for the in-flight animation to be
  // observable by the e2e assertion (and by a human watching).
  push(() => new Promise((resolve) => setTimeout(resolve, 900)))
  push(() =>
    out({
      type: 'tool_execution_end',
      toolCallId: 'call_bash',
      toolName: 'bash',
      isError: false,
      result: { content: [{ type: 'text', text: 'ok' }], details: {} },
    }),
  )

  push(() => out({ type: 'message_start', message: { role: 'assistant', content: [] } }))
  for (const delta of ['Editing ', 'the ', 'file ', 'now.']) {
    push(() =>
      out({
        type: 'message_update',
        message: { role: 'assistant', content: [] },
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta },
      }),
    )
  }
  push(() =>
    out({
      type: 'message_update',
      message: { role: 'assistant', content: [] },
      assistantMessageEvent: {
        type: 'toolcall_end',
        contentIndex: 1,
        toolCall: {
          type: 'toolCall',
          id: 'call_edit',
          name: 'edit',
          arguments: { path: 'hello.ts', edits: [] },
        },
      },
    }),
  )
  push(() =>
    out({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Editing the file now.' },
          {
            type: 'toolCall',
            id: 'call_edit',
            name: 'edit',
            arguments: { path: 'hello.ts', edits: [] },
          },
          {
            type: 'toolCall',
            id: 'call_art',
            name: 'artifact_create',
            arguments: { title: 'E2E Card' },
          },
          {
            type: 'toolCall',
            id: 'call_bash',
            name: 'bash',
            arguments: { command: 'npm test' },
          },
        ],
        stopReason: 'toolUse',
        timestamp: Date.now(),
      },
    }),
  )
  push(() =>
    out({
      type: 'tool_execution_start',
      toolCallId: 'call_edit',
      toolName: 'edit',
      args: { path: 'hello.ts' },
    }),
  )
  push(() =>
    out({
      type: 'tool_execution_end',
      toolCallId: 'call_edit',
      toolName: 'edit',
      isError: false,
      result: {
        content: [{ type: 'text', text: 'Edited hello.ts' }],
        details: { diff: DIFF, patch: PATCH, firstChangedLine: 2 },
      },
    }),
  )
  // Artifact tool call → drives the artifacts pane.
  push(() =>
    out({
      type: 'tool_execution_start',
      toolCallId: 'call_art',
      toolName: 'artifact_create',
      args: { title: 'E2E Card' },
    }),
  )
  push(() =>
    out({
      type: 'tool_execution_end',
      toolCallId: 'call_art',
      toolName: 'artifact_create',
      isError: false,
      result: {
        content: [{ type: 'text', text: 'Created artifact' }],
        details: {
          id: 'e2e-card',
          title: 'E2E Card',
          type: 'html',
          content: '<h1>E2E artifact</h1>',
          version: 1,
        },
      },
    }),
  )
  push(() => out({ type: 'message_start', message: { role: 'assistant', content: [] } }))
  push(() =>
    out({
      type: 'message_update',
      message: { role: 'assistant', content: [] },
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'Done: **hello.ts',
      },
    }),
  )
  push(() =>
    out({
      type: 'message_update',
      message: { role: 'assistant', content: [] },
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: '** updated.',
      },
    }),
  )
  push(() =>
    out({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Done: **hello.ts** updated.' }],
        stopReason: 'stop',
        timestamp: Date.now(),
      },
    }),
  )
  push(() => out({ type: 'agent_end', messages: [] }))

  // Sequential so a step may await (used to hold a tool "running").
  void (async () => {
    for (const step of steps) {
      await step()
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
  })()
}

process.on('SIGTERM', () => process.exit(0))
