// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectorsStore } from './connectors'

const invoke = vi.fn(async (..._args: unknown[]) => undefined)
const piCommand = vi.fn(async () => ({ success: true, data: undefined }))

beforeEach(() => {
  invoke.mockClear()
  piCommand.mockClear()
  useConnectorsStore.setState({ flows: {} })
  // @ts-expect-error partial preload surface, only what the store touches
  window.pidex = { invoke, piCommand }
})

const responses = (): unknown[] =>
  invoke.mock.calls.filter((call) => call[0] === 'pi:extensionUiResponse').map((call) => call[2])

describe('connector connect flow', () => {
  it('signs in with the adapter command, which runs no model', async () => {
    await useConnectorsStore.getState().connect('s1', 'linear')
    expect(piCommand).toHaveBeenCalledWith('s1', { type: 'prompt', message: '/mcp-auth linear' })
    expect(useConnectorsStore.getState().flows.linear).toEqual({
      phase: 'starting',
      sessionId: 's1',
    })
  })

  it('opens the browser and NEVER answers the adapter prompt on its own', () => {
    useConnectorsStore.getState().promptReceived({
      sessionId: 's1',
      serverName: 'linear',
      authorizationUrl: 'https://linear.app/oauth/authorize',
      requestId: 'req-1',
    })
    expect(invoke).toHaveBeenCalledWith('app:openExternal', 'https://linear.app/oauth/authorize')
    // The load-bearing rule: pi's RPC has no cancel, and an empty answer wins
    // the race against the loopback callback and kills a successful flow.
    expect(responses()).toEqual([])
    expect(useConnectorsStore.getState().flows.linear).toMatchObject({
      phase: 'awaiting-browser',
      requestId: 'req-1',
    })
  })

  it('settles on the adapter verdict, keeping its message on failure', () => {
    useConnectorsStore.getState().settle('linear', 'success')
    expect(useConnectorsStore.getState().flows.linear).toEqual({ phase: 'connected' })
    useConnectorsStore.getState().settle('slack', 'failure', 'redirect_uri mismatch')
    expect(useConnectorsStore.getState().flows.slack).toEqual({
      phase: 'failed',
      message: 'redirect_uri mismatch',
    })
  })

  it('answers the pending prompt when the user pastes a callback URL', () => {
    useConnectorsStore.getState().promptReceived({
      sessionId: 's1',
      serverName: 'linear',
      authorizationUrl: 'https://linear.app/oauth/authorize',
      requestId: 'req-1',
    })
    useConnectorsStore.getState().submitCallbackUrl('linear', '  http://localhost:19876/cb?code=1 ')
    expect(responses()).toEqual([
      {
        type: 'extension_ui_response',
        id: 'req-1',
        value: 'http://localhost:19876/cb?code=1',
      },
    ])
  })

  it('ignores a paste when no prompt is pending', () => {
    useConnectorsStore.getState().submitCallbackUrl('linear', 'http://localhost:19876/cb')
    expect(responses()).toEqual([])
  })

  it('cancels explicitly — the only case where pidex answers', () => {
    useConnectorsStore.getState().promptReceived({
      sessionId: 's1',
      serverName: 'linear',
      authorizationUrl: 'https://linear.app/oauth/authorize',
      requestId: 'req-1',
    })
    useConnectorsStore.getState().cancel('linear')
    expect(responses()).toEqual([{ type: 'extension_ui_response', id: 'req-1', cancelled: true }])
    expect(useConnectorsStore.getState().flows.linear).toBeUndefined()
  })

  it('disconnects through the adapter so it clears its own stored credentials', async () => {
    await useConnectorsStore.getState().disconnect('s1', 'slack')
    expect(piCommand).toHaveBeenCalledWith('s1', {
      type: 'prompt',
      message: '/mcp logout slack',
    })
  })
})
