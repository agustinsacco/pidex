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

const MOCK_DISK_SESSIONS = [
  {
    path: '/mock/sessions/a.jsonl',
    sessionId: 'a',
    cwd: '/Users/dev/projects/pidex',
    createdAt: '2026-08-01T10:00:00.000Z',
    name: 'Refactor auth module',
    firstUserText: 'Refactor the auth module to use the new token service',
    userMessages: 14,
    assistantMessages: 18,
    toolCalls: 42,
    totalTokens: 812_000,
    cost: 1.24,
    entryCount: 96,
    branchCount: 2,
    mtimeMs: Date.now() - 3600_000,
    lastActivityAt: '2026-08-03T09:00:00.000Z',
  },
  {
    path: '/mock/sessions/b.jsonl',
    sessionId: 'b',
    cwd: '/Users/dev/projects/pidex',
    createdAt: '2026-07-28T15:00:00.000Z',
    firstUserText: 'Why is the vite build slow?',
    userMessages: 3,
    assistantMessages: 4,
    toolCalls: 9,
    totalTokens: 120_500,
    cost: 0.31,
    entryCount: 18,
    branchCount: 0,
    mtimeMs: Date.now() - 86_400_000 * 2,
    lastActivityAt: '2026-08-01T12:00:00.000Z',
  },
]

function mockStats(): Record<string, unknown> {
  const activityByDay: Record<string, number> = {}
  for (let i = 0; i < 120; i++) {
    if (Math.sin(i * 1.7) > 0.2) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      activityByDay[d.toISOString().slice(0, 10)] = Math.ceil(Math.abs(Math.sin(i)) * 30)
    }
  }
  return {
    sessionCount: 212,
    messages: 77_813,
    tokens: 33_100_000,
    cost: 148.2,
    activeDays: 46,
    activityByDay,
  }
}

function mockTree(): Record<string, unknown> {
  return {
    sessionId: 'a',
    cwd: '/Users/dev/projects/pidex',
    leafId: 'u4',
    entries: [
      { id: 'u1', parentId: null, type: 'message', role: 'user', preview: 'Refactor the auth module to use the new token service', timestamp: '2026-08-01T10:00:00Z' },
      { id: 'a1', parentId: 'u1', type: 'message', role: 'assistant', preview: 'Starting with the token service…', toolName: 'read, edit', timestamp: '2026-08-01T10:01:00Z' },
      { id: 't1', parentId: 'a1', type: 'message', role: 'toolResult', toolName: 'edit', timestamp: '2026-08-01T10:01:30Z' },
      { id: 'u2', parentId: 't1', type: 'message', role: 'user', preview: 'Actually use JWT rotation instead', timestamp: '2026-08-01T10:05:00Z' },
      { id: 'a2', parentId: 'u2', type: 'message', role: 'assistant', preview: 'Switching to JWT rotation…', timestamp: '2026-08-01T10:06:00Z' },
      { id: 'u3', parentId: 't1', type: 'message', role: 'user', preview: 'Add refresh-token support too', timestamp: '2026-08-01T11:00:00Z' },
      { id: 'a3', parentId: 'u3', type: 'message', role: 'assistant', preview: 'Adding refresh tokens…', toolName: 'edit, bash', timestamp: '2026-08-01T11:02:00Z' },
      { id: 'bs1', parentId: 'a3', type: 'branch_summary', summary: 'Explored JWT rotation on the abandoned branch.', timestamp: '2026-08-01T11:10:00Z' },
      { id: 'u4', parentId: 'bs1', type: 'message', role: 'user', preview: 'Now write the tests', timestamp: '2026-08-01T11:15:00Z' },
      { id: 'l1', parentId: 'u4', type: 'label', targetId: 'u2', label: 'jwt-experiment', timestamp: '2026-08-01T11:20:00Z' },
    ],
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
        case 'app:userInfo':
          return Promise.resolve({ username: 'dev' })
        case 'sessions:list':
          return Promise.resolve(MOCK_DISK_SESSIONS)
        case 'sessions:stats':
          return Promise.resolve(mockStats())
        case 'git:info':
          return Promise.resolve({ isRepo: true, branch: 'main', dirtyCount: 3, ahead: 1, behind: 0 })
        case 'sessions:readTree':
          return Promise.resolve(mockTree())
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

    onSessionsChanged: () => () => {},
    piCommand: (sessionId, command) =>
      (api.invoke as (c: string, ...a: unknown[]) => Promise<never>)('pi:command', sessionId, command),
  } as PidexApi

  window.pidex = api
  console.info('[pidex] mock preload API installed (browser dev mode)')
}
