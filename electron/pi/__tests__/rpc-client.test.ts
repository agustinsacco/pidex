import { afterEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PiRpcClient } from '../rpc-client'
import type { PiEvent } from '@shared/rpc'

const fixtureDir = dirname(fileURLToPath(import.meta.url))
const fakePi = join(fixtureDir, 'fixtures', 'fake-pi.cjs')

function makeClient(): PiRpcClient {
  return new PiRpcClient({
    cwd: fixtureDir,
    binaryPath: process.execPath,
    prefixArgs: [fakePi],
  })
}

let clients: PiRpcClient[] = []
const track = (c: PiRpcClient): PiRpcClient => {
  clients.push(c)
  return c
}

afterEach(async () => {
  await Promise.allSettled(clients.map((c) => c.dispose()))
  clients = []
})

describe('PiRpcClient', () => {
  it('correlates request and response by id', async () => {
    const client = track(makeClient())
    client.spawn()
    const response = await client.request({ type: 'get_state' })
    expect(response.success).toBe(true)
    if (response.success) {
      expect(response.data?.sessionId).toBe('fake-session')
    }
  })

  it('resolves out-of-order responses to the right waiters', async () => {
    const client = track(makeClient())
    client.spawn()
    // fake-pi holds the compact response until abort arrives, then answers
    // abort first — both promises must still resolve correctly.
    const compactPromise = client.request({ type: 'compact' })
    await new Promise((r) => setTimeout(r, 30))
    const abortResponse = await client.request({ type: 'abort' })
    const compactResponse = await compactPromise
    expect(abortResponse.command).toBe('abort')
    expect(compactResponse.command).toBe('compact')
    if (compactResponse.success) {
      expect((compactResponse.data as { summary: string }).summary).toBe('S')
    }
  })

  it('resolves success:false responses (protocol errors are data)', async () => {
    const client = track(makeClient())
    client.spawn()
    const response = await client.request({ type: 'set_model', provider: 'x', modelId: 'nope' })
    expect(response.success).toBe(false)
    if (!response.success) {
      expect(response.error).toContain('nope')
    }
  })

  it('streams events (including records chunked mid-write)', async () => {
    const client = track(makeClient())
    client.spawn()
    const events: PiEvent[] = []
    const done = new Promise<void>((resolve) => {
      client.on('event', (event) => {
        events.push(event)
        if (event.type === 'agent_end') resolve()
      })
    })
    const response = await client.request({ type: 'prompt', message: 'hi' })
    expect(response.success).toBe(true)
    await done

    const types = events.map((e) => e.type)
    expect(types).toEqual([
      'agent_start',
      'message_start',
      'message_update',
      'message_end',
      'agent_end',
    ])
    const update = events.find((e) => e.type === 'message_update')
    expect(update && 'assistantMessageEvent' in update).toBe(true)
    if (
      update &&
      update.type === 'message_update' &&
      update.assistantMessageEvent.type === 'text_delta'
    ) {
      expect(update.assistantMessageEvent.delta).toBe('Hello world')
    }
  })

  it('detects unexpected exit (crash) and rejects pending requests', async () => {
    const client = track(makeClient())
    client.spawn()
    const exitPromise = new Promise<{ expected: boolean; code: number | null }>((resolve) => {
      client.on('exit', ({ code, expected }) => resolve({ code, expected }))
    })
    // The fake exits with code 3 on this command without responding.
    const pending = client.request({ type: 'bash', command: 'CRASH' })
    const exit = await exitPromise
    expect(exit.expected).toBe(false)
    expect(exit.code).toBe(3)
    await expect(pending).rejects.toThrow(/exited/)
    expect(client.alive).toBe(false)
  })

  it('dispose() shuts down cleanly and marks exit as expected', async () => {
    const client = track(makeClient())
    client.spawn()
    await client.request({ type: 'get_state' })
    const exitPromise = new Promise<boolean>((resolve) => {
      client.on('exit', ({ expected }) => resolve(expected))
    })
    await client.dispose()
    expect(await exitPromise).toBe(true)
    expect(client.alive).toBe(false)
  })

  it('rejects requests when the process is not running', async () => {
    const client = track(makeClient())
    client.spawn()
    await client.dispose()
    await expect(client.request({ type: 'get_state' })).rejects.toThrow(/not running/)
  })
})
