/**
 * Dev-only mock of the preload API so the renderer can run in a plain
 * browser (vite dev server without Electron). Replays the captured real
 * pi event stream with realistic pacing. Never bundled in production:
 * loaded lazily behind `import.meta.env.DEV && !window.pidex`.
 */
import type { PidexApi } from '@shared/ipc'
import type { SessionPush } from '@shared/models'
import type { PiEvent, RpcCommand, RpcResponse } from '@shared/rpc'
import fixtureRaw from '../features/chat/__fixtures__/real-session-events.jsonl?raw'

const fixtureEvents: PiEvent[] = fixtureRaw
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as { type: string })
  .filter((record) => record.type !== 'response') as PiEvent[]

const listeners = new Map<string, Set<(push: SessionPush) => void>>()
let replaying = false

function push(sessionId: string, payload: SessionPush): void {
  for (const listener of listeners.get(sessionId) ?? []) listener(payload)
}

async function replayFixture(sessionId: string): Promise<void> {
  if (replaying) return
  replaying = true
  for (const event of fixtureEvents) {
    const delay =
      event.type === 'message_update' ? 12 : event.type.startsWith('tool_') ? 220 : 120
    await new Promise((resolve) => setTimeout(resolve, delay))
    push(sessionId, { kind: 'event', event })
  }
  replaying = false
}

const MOCK_MODELS = [
  {
    id: 'qwen-3.5-122b',
    name: 'Qwen 3.5 122b',
    api: 'openai-completions',
    provider: 'local-stark',
    reasoning: true,
    input: ['text'],
    contextWindow: 262144,
    maxTokens: 32768,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    id: 'claude-fable-5',
    name: 'Fable 5',
    api: 'anthropic-messages',
    provider: 'anthropic',
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 200000,
    maxTokens: 64000,
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  },
]

function respond(command: RpcCommand): RpcResponse {
  switch (command.type) {
    case 'get_state':
      return {
        type: 'response',
        command: 'get_state',
        success: true,
        data: {
          model: MOCK_MODELS[0],
          thinkingLevel: 'medium',
          isStreaming: false,
          isCompacting: false,
          steeringMode: 'one-at-a-time',
          followUpMode: 'one-at-a-time',
          sessionId: 'mock-session',
          sessionName: 'Mock replay session',
          autoCompactionEnabled: true,
          messageCount: 0,
          pendingMessageCount: 0,
        },
      } as RpcResponse
    case 'get_available_models':
      return {
        type: 'response',
        command: 'get_available_models',
        success: true,
        data: { models: MOCK_MODELS },
      } as RpcResponse
    case 'get_commands':
      return {
        type: 'response',
        command: 'get_commands',
        success: true,
        data: {
          commands: [
            { name: 'session-name', description: 'Set or clear the session name', source: 'extension' },
            { name: 'fix-tests', description: 'Fix failing tests', source: 'prompt' },
            { name: 'skill:web-search', description: 'Search the web', source: 'skill' },
          ],
        },
      } as RpcResponse
    case 'get_session_stats':
      return {
        type: 'response',
        command: 'get_session_stats',
        success: true,
        data: {
          sessionId: 'mock-session',
          userMessages: 2,
          assistantMessages: 4,
          toolCalls: 3,
          toolResults: 3,
          totalMessages: 9,
          tokens: { input: 48200, output: 3150, cacheRead: 39000, cacheWrite: 4100, total: 94450 },
          cost: 0.0421,
          contextUsage: { tokens: 51350, contextWindow: 262144, percent: 20 },
        },
      } as RpcResponse
    case 'prompt':
      setTimeout(() => void replayFixture('mock-session-id'), 60)
      return { type: 'response', command: 'prompt', success: true } as RpcResponse
    case 'bash':
      return {
        type: 'response',
        command: 'bash',
        success: true,
        data: { output: 'mock output\n', exitCode: 0, cancelled: false, truncated: false },
      } as RpcResponse
    default:
      return { type: 'response', command: command.type, success: true } as RpcResponse
  }
}

export function installMockPidex(): void {
  const api: PidexApi = {
    invoke: (channel: string, ...args: unknown[]) => {
      switch (channel) {
        case 'pi:health':
          return Promise.resolve({ ok: true, version: '0.78.0', binaryPath: '/mock/pi', minVersion: '0.78.0' })
        case 'app:getPrefs':
          return Promise.resolve({
            theme: 'system',
            recentWorkspaces: [
              { path: '/Users/dev/projects/pidex', name: 'pidex', lastOpenedAt: Date.now() },
            ],
          })
        case 'app:selectFolder':
          return Promise.resolve('/Users/dev/projects/pidex')
        case 'pi:createSession':
          return Promise.resolve({ sessionId: 'mock-session-id', workspacePath: '/Users/dev/projects/pidex', pid: 1234 })
        case 'pi:command':
          return Promise.resolve(respond(args[1] as RpcCommand))
        case 'fs:listFiles':
          return Promise.resolve([
            'src/main.tsx',
            'src/app/App.tsx',
            'electron/main.ts',
            'electron/pi/rpc-client.ts',
            'package.json',
            'README.md',
          ])
        case 'pi:agentSettings':
          return Promise.resolve({})
        default:
          return Promise.resolve(undefined)
      }
    },
    onSessionPush: (sessionId, listener) => {
      const set = listeners.get(sessionId) ?? new Set()
      set.add(listener)
      listeners.set(sessionId, set)
      return () => set.delete(listener)
    },
    piCommand: (sessionId, command) =>
      (api.invoke as (c: string, ...a: unknown[]) => Promise<never>)('pi:command', sessionId, command),
  } as PidexApi

  window.pidex = api
  console.info('[pidex] mock preload API installed (browser dev mode)')
}
