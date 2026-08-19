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

// A real session file on disk in the workspace, so the app's existence
// check for the persisted resume target succeeds.
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
// pi stores sessions under ~/.pi/agent/sessions/--<cwd with / as ->--/, and
// pidex's sidebar scans exactly that path. Writing here (not into the
// workspace) is what makes the session discoverable, mirroring real pi.
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent')
const SESSION_DIR = path.join(
  process.env.PI_CODING_AGENT_SESSION_DIR || path.join(AGENT_DIR, 'sessions'),
  `--${fs.realpathSync.native(process.cwd()).split(path.sep).filter(Boolean).join('-')}--`,
)
const SESSION_FILE = path.join(SESSION_DIR, `2026-01-01T00-00-00-000Z_stub-${process.pid}.jsonl`)
try {
  fs.mkdirSync(SESSION_DIR, { recursive: true })
  fs.writeFileSync(
    SESSION_FILE,
    JSON.stringify({
      type: 'session',
      version: 3,
      id: `stub-${process.pid}`,
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
    }) +
      '\n' +
      JSON.stringify({
        type: 'message',
        id: 'aaaa0001',
        parentId: null,
        timestamp: new Date().toISOString(),
        message: { role: 'user', content: process.env.PIDEX_STUB_SESSION_TITLE || 'stub session' },
      }) +
      '\n',
  )
} catch {
  /* best effort */
}

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
          // Real pi always reports the file it persists to. The app stores
          // this as the session's disk path and reopens it on relaunch.
          sessionFile: SESSION_FILE,
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

    case 'prompt': {
      out({ id: cmd.id, type: 'response', command: 'prompt', success: true })
      // Scenario switch, keyed off the prompt text: the default turn is what
      // most tests assert on, so extra scenarios must not change it.
      const message = typeof cmd.message === 'string' ? cmd.message : ''
      if (message.includes('longartifact')) runLongArtifactTurn()
      else if (message.includes('manyitems')) runManyItemsTurn()
      else if (message.includes('longstream')) runLongStreamTurn()
      else runTurn()
      break
    }

    case 'abort':
      out({ id: cmd.id, type: 'response', command: 'abort', success: true })
      break

    default:
      out({ id: cmd.id, type: 'response', command: cmd.type, success: true })
  }
}

let entrySeq = 1
/** Persist a message entry to the session file, as real pi does — the
 * sidebar scanner and Usage view read usage/cost from disk, not RPC. */
function persist(message) {
  try {
    fs.appendFileSync(
      SESSION_FILE,
      JSON.stringify({
        type: 'message',
        id: `bbbb${String(entrySeq).padStart(4, '0')}`,
        parentId: entrySeq === 1 ? 'aaaa0001' : `bbbb${String(entrySeq - 1).padStart(4, '0')}`,
        timestamp: new Date().toISOString(),
        message,
      }) + '\n',
    )
    entrySeq++
  } catch {
    /* best effort */
  }
}

function runTurn() {
  const steps = []
  const push = (fn) => steps.push(fn)

  push(() => out({ type: 'agent_start' }))
  push(() => out({ type: 'turn_start' }))
  // Extension status line styled with ANSI SGR (as pi-mcp-adapter does):
  // the app must render clean text, never raw escape bytes.
  push(() =>
    out({
      type: 'extension_ui_request',
      id: 'ext-status-1',
      method: 'setStatus',
      statusKey: 'stub-mcp',
      statusText: '[38;2;138;190;183mMCP: 2 servers enabled[39m',
    }),
  )
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
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta },
      }),
    )
  }
  push(() =>
    out({
      type: 'message_update',
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
  push(() => {
    const message = {
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
    }
    persist(message)
    out({ type: 'message_end', message })
  })
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
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: '** updated.',
      },
    }),
  )
  push(() => {
    const message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Done: **hello.ts** updated.' }],
      stopReason: 'stop',
      timestamp: Date.now(),
      usage: {
        input: 1200,
        output: 300,
        cacheRead: 4000,
        cacheWrite: 150,
        totalTokens: 5650,
        cost: { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0.002, total: 0.033 },
      },
    }
    persist(message)
    out({ type: 'message_end', message })
  })
  push(() => out({ type: 'agent_end', messages: [] }))
  push(() => out({ type: 'agent_settled' }))

  // Sequential so a step may await (used to hold a tool "running").
  void (async () => {
    for (const step of steps) {
      await step()
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
  })()
}

process.on('SIGTERM', () => process.exit(0))

// ---------- extra scenarios ----------

/** Run a step list sequentially, 40ms apart, awaiting any step that returns. */
function play(steps, gapMs = 40) {
  void (async () => {
    for (const step of steps) {
      await step()
      await new Promise((resolve) => setTimeout(resolve, gapMs))
    }
  })()
}

/**
 * One markdown artifact far taller than the pane, to prove the artifact pane
 * scrolls (it used to clip: PaneShell's content slot wasn't a flex container,
 * so the viewer's `flex-1` scroller collapsed to auto height).
 */
function runLongArtifactTurn() {
  const body = Array.from(
    { length: 160 },
    (_, i) => `## Section ${i + 1}\n\nParagraph ${i + 1} of the long artifact body.`,
  ).join('\n\n')
  const content = `# E2E Long Doc\n\n${body}\n`

  play([
    () => out({ type: 'agent_start' }),
    () => out({ type: 'turn_start' }),
    () => out({ type: 'message_start', message: { role: 'assistant', content: [] } }),
    () =>
      out({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'call_long',
              name: 'artifact_create',
              arguments: { title: 'E2E Long Doc' },
            },
          ],
          stopReason: 'toolUse',
          timestamp: Date.now(),
        },
      }),
    () =>
      out({
        type: 'tool_execution_start',
        toolCallId: 'call_long',
        toolName: 'artifact_create',
        args: { title: 'E2E Long Doc' },
      }),
    () =>
      out({
        type: 'tool_execution_end',
        toolCallId: 'call_long',
        toolName: 'artifact_create',
        isError: false,
        result: {
          content: [{ type: 'text', text: 'Created artifact' }],
          details: {
            id: 'e2e-long-doc',
            title: 'E2E Long Doc',
            type: 'markdown',
            content,
            version: 1,
          },
        },
      }),
    () => out({ type: 'agent_end', messages: [] }),
    () => out({ type: 'agent_settled' }),
  ])
}

/**
 * A long, slow stream plus a tool call whose identity is withheld until
 * execution starts (the Bedrock shape). Exercises two things at once:
 * scrolling back while the transcript grows, and that an unidentified tool
 * never renders as "unknown".
 */
function runLongStreamTurn() {
  const steps = [
    () => out({ type: 'agent_start' }),
    () => out({ type: 'turn_start' }),
    () => out({ type: 'message_start', message: { role: 'assistant', content: [] } }),
  ]

  // Anonymous tool call: no id/name anywhere until tool_execution_start.
  steps.push(() =>
    out({
      type: 'message_update',
      message: { role: 'assistant', content: [] },
      assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1 },
    }),
  )
  for (const chunk of ['{"command"', ':"npm ', 'test"}']) {
    steps.push(() =>
      out({
        type: 'message_update',
        message: { role: 'assistant', content: [] },
        assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 1, delta: chunk },
      }),
    )
  }
  steps.push(() =>
    out({
      type: 'tool_execution_start',
      toolCallId: 'late_id',
      toolName: 'bash',
      args: { command: 'npm test' },
    }),
  )

  const lines = []
  for (let i = 0; i < 70; i++) {
    const delta = `Streamed line ${i + 1} of a long reply that overflows the viewport.\n\n`
    lines.push(delta)
    steps.push(() =>
      out({
        type: 'message_update',
        message: { role: 'assistant', content: [] },
        assistantMessageEvent: {
          type: 'text_delta',
          contentIndex: 0,
          delta,
        },
      }),
    )
  }

  steps.push(() =>
    out({
      type: 'tool_execution_end',
      toolCallId: 'late_id',
      toolName: 'bash',
      isError: false,
      result: { content: [{ type: 'text', text: 'ok' }], details: {} },
    }),
  )
  steps.push(() =>
    out({
      type: 'message_end',
      message: {
        role: 'assistant',
        // message_end is authoritative in the reducer, so it has to carry the
        // whole streamed body — echoing only a summary line here collapsed the
        // transcript back to one screen and made scroll assertions meaningless.
        content: [
          { type: 'text', text: `${lines.join('')}long stream complete` },
          {
            type: 'toolCall',
            id: 'late_id',
            name: 'bash',
            arguments: { command: 'npm test' },
          },
        ],
        stopReason: 'stop',
        timestamp: Date.now(),
      },
    }),
  )
  steps.push(() => out({ type: 'agent_end', messages: [] }))
  steps.push(() => out({ type: 'agent_settled' }))

  play(steps)
}

/**
 * Many short tool-only turns — the shape a long agent run actually takes (pi
 * emits a fresh message per tool round). This is the case where virtualization
 * matters: only a window of rows is in the DOM, so an over-large size estimate
 * for the rest shows up as dead space between rendered rows.
 */
function runManyItemsTurn() {
  const steps = [() => out({ type: 'agent_start' }), () => out({ type: 'turn_start' })]
  for (let i = 0; i < 40; i++) {
    const id = `many_${i}`
    steps.push(() => out({ type: 'message_start', message: { role: 'assistant', content: [] } }))
    steps.push(() =>
      out({
        type: 'message_update',
        message: { role: 'assistant', content: [] },
        assistantMessageEvent: { type: 'toolcall_start', contentIndex: 0 },
      }),
    )
    steps.push(() =>
      out({
        type: 'tool_execution_start',
        toolCallId: id,
        toolName: 'bash',
        args: { command: `echo step ${i}` },
      }),
    )
    steps.push(() =>
      out({
        type: 'tool_execution_end',
        toolCallId: id,
        toolName: 'bash',
        isError: false,
        result: { content: [{ type: 'text', text: 'ok' }], details: {} },
      }),
    )
    steps.push(() =>
      out({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [
            { type: 'toolCall', id, name: 'bash', arguments: { command: `echo step ${i}` } },
          ],
          stopReason: 'toolUse',
          timestamp: Date.now(),
        },
      }),
    )
  }
  steps.push(() => out({ type: 'message_start', message: { role: 'assistant', content: [] } }))
  steps.push(() =>
    out({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'many items complete' }],
        stopReason: 'stop',
        timestamp: Date.now(),
      },
    }),
  )
  steps.push(() => out({ type: 'agent_end', messages: [] }))
  steps.push(() => out({ type: 'agent_settled' }))
  play(steps, 4)
}
