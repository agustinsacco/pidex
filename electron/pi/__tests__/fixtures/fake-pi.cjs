#!/usr/bin/env node
/**
 * Fake pi RPC server for PiRpcClient tests.
 * Speaks just enough of the protocol: correlated responses, streamed events,
 * deliberate protocol quirks (U+2028 in deltas, chunked writes, out-of-order
 * responses), and crash-on-command.
 */
'use strict'

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let idx
  while ((idx = buffer.indexOf('\n')) !== -1) {
    let line = buffer.slice(0, idx)
    buffer = buffer.slice(idx + 1)
    if (line.endsWith('\r')) line = line.slice(0, -1)
    if (line.length > 0) handle(JSON.parse(line))
  }
})

const out = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')

/** Write a record split across two chunks with a delay, to exercise buffering. */
function outChunked(obj) {
  const raw = JSON.stringify(obj) + '\n'
  const mid = Math.floor(raw.length / 2)
  process.stdout.write(raw.slice(0, mid))
  setTimeout(() => process.stdout.write(raw.slice(mid)), 5)
}

let delayedResponse = null

function handle(cmd) {
  switch (cmd.type) {
    case 'get_state':
      out({
        id: cmd.id,
        type: 'response',
        command: 'get_state',
        success: true,
        data: {
          thinkingLevel: 'off',
          isStreaming: false,
          isCompacting: false,
          steeringMode: 'all',
          followUpMode: 'one-at-a-time',
          sessionId: 'fake-session',
          autoCompactionEnabled: true,
          messageCount: 0,
          pendingMessageCount: 0,
        },
      })
      break

    case 'prompt': {
      out({ id: cmd.id, type: 'response', command: 'prompt', success: true })
      out({ type: 'agent_start' })
      out({ type: 'message_start', message: { role: 'assistant', content: [] } })
      // Delta containing U+2028 — must arrive inside one record.
      outChunked({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hello world' }] },
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello world' },
      })
      setTimeout(() => {
        out({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Hello world' }],
            stopReason: 'stop',
          },
        })
        out({
          type: 'agent_end',
          messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Hello world' }] }],
        })
      }, 20)
      break
    }

    // Test hook: hold this response until the next command arrives.
    case 'compact':
      delayedResponse = {
        id: cmd.id,
        type: 'response',
        command: 'compact',
        success: true,
        data: { summary: 'S', firstKeptEntryId: 'x', tokensBefore: 1 },
      }
      break

    case 'abort': {
      // Answer the held command AFTER this one → out-of-order correlation.
      out({ id: cmd.id, type: 'response', command: 'abort', success: true })
      if (delayedResponse) {
        out(delayedResponse)
        delayedResponse = null
      }
      break
    }

    case 'set_model':
      out({
        id: cmd.id,
        type: 'response',
        command: 'set_model',
        success: false,
        error: 'Model not found: ' + cmd.modelId,
      })
      break

    case 'bash':
      if (cmd.command === 'CRASH') {
        process.exit(3)
      }
      out({
        id: cmd.id,
        type: 'response',
        command: 'bash',
        success: true,
        data: { output: 'ok', exitCode: 0, cancelled: false, truncated: false },
      })
      break

    default:
      out({
        id: cmd.id,
        type: 'response',
        command: cmd.type,
        success: false,
        error: 'unsupported in fake',
      })
  }
}

process.on('SIGTERM', () => process.exit(0))
