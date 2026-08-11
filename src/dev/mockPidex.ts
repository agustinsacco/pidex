/**
 * Dev-only mock of the preload API so the renderer can run in a plain
 * browser (vite dev server without Electron). Replays the captured real
 * pi event stream with realistic pacing. Never bundled in production:
 * loaded lazily behind `import.meta.env.DEV && !window.pidex`.
 */
import type { PidexApi } from '@shared/ipc'
import type { SessionPush } from '@shared/models'
import { DEFAULT_APP_PREFS, MIN_PI_VERSION } from '@shared/models'
import type { PiEvent, RpcCommand, RpcResponse } from '@shared/rpc'
import fixtureRaw from '../features/chat/__fixtures__/real-session-events.jsonl?raw'

const fixtureEvents: PiEvent[] = fixtureRaw
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as { type: string })
  .filter((record) => record.type !== 'response') as PiEvent[]

const listeners = new Map<string, Set<(push: SessionPush) => void>>()
const ptyListeners = new Map<string, Set<(data: string) => void>>()
let replaying = false

function push(sessionId: string, payload: SessionPush): void {
  for (const listener of listeners.get(sessionId) ?? []) listener(payload)
}

function replayFixture(sessionId: string): void {
  if (replaying) return
  replaying = true
  let index = 0
  // Interval-based pumping: survives aggressive background-timer throttling
  // better than chained awaits, and can't strand the `replaying` guard.
  const timer = setInterval(() => {
    try {
      const batch = 4
      for (let i = 0; i < batch && index < fixtureEvents.length; i++, index++) {
        push(sessionId, { kind: 'event', event: fixtureEvents[index]! })
      }
      if (index >= fixtureEvents.length) {
        clearInterval(timer)
        replaying = false
      }
    } catch (error) {
      console.error('[pidex mock] replay failed:', error)
      clearInterval(timer)
      replaying = false
    }
  }, 40)
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
            {
              name: 'session-name',
              description: 'Set or clear the session name',
              source: 'extension',
            },
            { name: 'fix-tests', description: 'Fix failing tests', source: 'prompt' },
            { name: 'skill:web-search', description: 'Search the web', source: 'skill' },
          ],
        },
      } as RpcResponse
    case 'get_available_thinking_levels':
      return {
        type: 'response',
        command: 'get_available_thinking_levels',
        success: true,
        data: { levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
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
    inputTokens: 96_000,
    outputTokens: 41_000,
    cacheReadTokens: 640_000,
    cacheWriteTokens: 35_000,
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
    inputTokens: 22_000,
    outputTokens: 8_500,
    cacheReadTokens: 88_000,
    cacheWriteTokens: 2_000,
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

function mockDir(dir: string): Array<Record<string, unknown>> {
  const ws = '/Users/dev/projects/pidex'
  if (dir === ws) {
    return [
      { name: 'src', path: `${ws}/src`, relativePath: 'src', isDirectory: true },
      { name: 'electron', path: `${ws}/electron`, relativePath: 'electron', isDirectory: true },
      {
        name: 'package.json',
        path: `${ws}/package.json`,
        relativePath: 'package.json',
        isDirectory: false,
      },
      { name: 'README.md', path: `${ws}/README.md`, relativePath: 'README.md', isDirectory: false },
    ]
  }
  if (dir.endsWith('/src')) {
    return [
      {
        name: 'main.tsx',
        path: `${ws}/src/main.tsx`,
        relativePath: 'src/main.tsx',
        isDirectory: false,
      },
      {
        name: 'App.tsx',
        path: `${ws}/src/App.tsx`,
        relativePath: 'src/App.tsx',
        isDirectory: false,
      },
    ]
  }
  return [
    {
      name: 'main.ts',
      path: `${dir}/main.ts`,
      relativePath: 'electron/main.ts',
      isDirectory: false,
    },
  ]
}

function mockTree(): Record<string, unknown> {
  return {
    sessionId: 'a',
    cwd: '/Users/dev/projects/pidex',
    leafId: 'u4',
    entries: [
      {
        id: 'u1',
        parentId: null,
        type: 'message',
        role: 'user',
        preview: 'Refactor the auth module to use the new token service',
        timestamp: '2026-08-01T10:00:00Z',
      },
      {
        id: 'a1',
        parentId: 'u1',
        type: 'message',
        role: 'assistant',
        preview: 'Starting with the token service…',
        toolName: 'read, edit',
        timestamp: '2026-08-01T10:01:00Z',
      },
      {
        id: 't1',
        parentId: 'a1',
        type: 'message',
        role: 'toolResult',
        toolName: 'edit',
        timestamp: '2026-08-01T10:01:30Z',
      },
      {
        id: 'u2',
        parentId: 't1',
        type: 'message',
        role: 'user',
        preview: 'Actually use JWT rotation instead',
        timestamp: '2026-08-01T10:05:00Z',
      },
      {
        id: 'a2',
        parentId: 'u2',
        type: 'message',
        role: 'assistant',
        preview: 'Switching to JWT rotation…',
        timestamp: '2026-08-01T10:06:00Z',
      },
      {
        id: 'u3',
        parentId: 't1',
        type: 'message',
        role: 'user',
        preview: 'Add refresh-token support too',
        timestamp: '2026-08-01T11:00:00Z',
      },
      {
        id: 'a3',
        parentId: 'u3',
        type: 'message',
        role: 'assistant',
        preview: 'Adding refresh tokens…',
        toolName: 'edit, bash',
        timestamp: '2026-08-01T11:02:00Z',
      },
      {
        id: 'bs1',
        parentId: 'a3',
        type: 'branch_summary',
        summary: 'Explored JWT rotation on the abandoned branch.',
        timestamp: '2026-08-01T11:10:00Z',
      },
      {
        id: 'u4',
        parentId: 'bs1',
        type: 'message',
        role: 'user',
        preview: 'Now write the tests',
        timestamp: '2026-08-01T11:15:00Z',
      },
      {
        id: 'l1',
        parentId: 'u4',
        type: 'label',
        targetId: 'u2',
        label: 'jwt-experiment',
        timestamp: '2026-08-01T11:20:00Z',
      },
    ],
  }
}

export function installMockPidex(): void {
  const api: PidexApi = {
    invoke: (channel: string, ...args: unknown[]) => {
      switch (channel) {
        case 'pi:health':
          return Promise.resolve({
            ok: true,
            version: MIN_PI_VERSION,
            binaryPath: '/mock/pi',
            minVersion: MIN_PI_VERSION,
          })
        case 'app:getPrefs':
          return Promise.resolve({
            theme: DEFAULT_APP_PREFS.theme,
            recentWorkspaces: [
              { path: '/Users/dev/projects/pidex', name: 'pidex', lastOpenedAt: Date.now() },
              {
                path: '/Users/dev/projects/other',
                name: 'other',
                lastOpenedAt: Date.now() - 8.64e7,
              },
            ],
            pinnedSessions: [],
            collapsedWorkspaces: [],
            // Session "b" has activity newer than its marker → unseen pill.
            seenSessions: { '/mock/sessions/b.jsonl': Date.parse('2026-08-01T00:00:00.000Z') },
            fonts: {
              uiScale: 1,
              chatFontSize: 14.5,
              editorFontSize: 12.5,
              terminalFontSize: 12.5,
              monoFont: 'JetBrains Mono',
            },
          })
        case 'app:selectFolder':
          return Promise.resolve('/Users/dev/projects/pidex')
        case 'pi:createSession':
          return Promise.resolve({
            sessionId: 'mock-session-id',
            workspacePath: '/Users/dev/projects/pidex',
            pid: 1234,
          })
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
          return Promise.resolve({
            defaultProvider: 'anthropic',
            defaultModel: 'claude-opus-5',
            defaultThinkingLevel: 'medium',
            packages: ['npm:pi-web-access', 'npm:pi-mcp-adapter'],
          })
        case 'mcp:readConfigs':
          return Promise.resolve({
            servers: [
              {
                name: 'linear',
                config: {
                  url: 'https://mcp.linear.app/sse',
                  directTools: ['get_issue', 'save_issue'],
                },
                scope: 'pi-global',
                shadows: [],
              },
              {
                name: 'snowflake',
                config: { command: 'npx', args: ['snowflake-mcp'], disabled: true },
                scope: 'pi-project',
                shadows: ['pi-global'],
              },
            ],
            files: [
              {
                scope: 'xdg',
                path: '/Users/dev/.config/mcp/mcp.json',
                exists: false,
                malformed: false,
                serverNames: [],
              },
              {
                scope: 'agents',
                path: '/Users/dev/.agents/mcp.json',
                exists: false,
                malformed: false,
                serverNames: [],
              },
              {
                scope: 'agents-dir',
                path: '/Users/dev/.agents/mcp/mcp.json',
                exists: false,
                malformed: false,
                serverNames: [],
              },
              {
                scope: 'pi-global',
                path: '/Users/dev/.pi/agent/mcp.json',
                exists: true,
                malformed: false,
                serverNames: ['linear', 'snowflake'],
              },
              {
                scope: 'project',
                path: '/Users/dev/projects/pidex/.mcp.json',
                exists: false,
                malformed: false,
                serverNames: [],
              },
              {
                scope: 'pi-project',
                path: '/Users/dev/projects/pidex/.pi/mcp.json',
                exists: true,
                malformed: false,
                serverNames: ['snowflake'],
              },
            ],
          })
        case 'mcp:readCache':
          return Promise.resolve([
            { name: 'linear', tools: ['get_issue', 'save_issue', 'list_issues'] },
          ])
        case 'mcp:upsertServer':
        case 'mcp:removeServer':
        case 'mcp:setDisabled':
        case 'mcp:writeFile':
          return Promise.resolve(undefined)
        case 'mcp:readFile':
          return Promise.resolve({
            path: '/Users/dev/.pi/agent/mcp.json',
            content: '{\n  "mcpServers": {}\n}\n',
          })
        case 'pi:catalogueModels':
          return Promise.resolve([
            {
              id: 'claude-opus-5',
              name: 'Opus 5',
              api: 'anthropic',
              provider: 'anthropic',
              reasoning: true,
              thinkingLevelMap: { xhigh: 'high-boost', max: null },
            },
            {
              id: 'claude-sonnet-5',
              name: 'Sonnet 5',
              api: 'anthropic',
              provider: 'anthropic',
              reasoning: true,
              thinkingLevelMap: null,
            },
            {
              id: 'Qwen 3.5 122b',
              name: 'Qwen 3.5 122b',
              provider: 'local-stark',
              reasoning: false,
            },
            // Bedrock's real shape: a bare foundation id that cannot be invoked
            // on-demand, alongside the region-prefixed inference profiles that
            // can. Present so the harness exercises the disabled-row path in
            // ModelMenu (see lib/modelAvailability).
            {
              id: 'anthropic.claude-fable-5',
              name: 'Claude Fable 5',
              provider: 'amazon-bedrock',
              reasoning: true,
              thinkingLevelMap: { off: null, xhigh: 'xhigh', max: 'max' },
            },
            {
              id: 'us.anthropic.claude-fable-5',
              name: 'Claude Fable 5 (US)',
              provider: 'amazon-bedrock',
              reasoning: true,
              thinkingLevelMap: { off: null, xhigh: 'xhigh', max: 'max' },
            },
            {
              id: 'global.anthropic.claude-fable-5',
              name: 'Claude Fable 5 (Global)',
              provider: 'amazon-bedrock',
              reasoning: true,
              thinkingLevelMap: { off: null, xhigh: 'xhigh', max: 'max' },
            },
            {
              id: 'amazon.nova-pro-v1:0',
              name: 'Nova Pro',
              provider: 'amazon-bedrock',
              reasoning: false,
            },
          ])
        case 'app:userInfo':
          return Promise.resolve({ username: 'dev', awsProfile: 'dev' })
        case 'app:setLastSession':
          return Promise.resolve(undefined)
        case 'app:resumeTarget':
          // Browser harness always starts at the picker.
          return Promise.resolve({ kind: 'none' })
        case 'sessions:list':
          return Promise.resolve(MOCK_DISK_SESSIONS)
        case 'sessions:usage': {
          const totals = (sessions: typeof MOCK_DISK_SESSIONS) => ({
            cost: sessions.reduce((sum, s) => sum + s.cost, 0),
            inputTokens: sessions.reduce((sum, s) => sum + s.inputTokens, 0),
            outputTokens: sessions.reduce((sum, s) => sum + s.outputTokens, 0),
            cacheReadTokens: sessions.reduce((sum, s) => sum + s.cacheReadTokens, 0),
            cacheWriteTokens: sessions.reduce((sum, s) => sum + s.cacheWriteTokens, 0),
            totalTokens: sessions.reduce((sum, s) => sum + s.totalTokens, 0),
            messages: sessions.reduce((sum, s) => sum + s.userMessages + s.assistantMessages, 0),
            toolCalls: sessions.reduce((sum, s) => sum + s.toolCalls, 0),
            sessionCount: sessions.length,
          })
          return Promise.resolve({
            workspaces: [
              {
                workspacePath: '/Users/dev/projects/pidex',
                sessions: MOCK_DISK_SESSIONS,
                totals: totals(MOCK_DISK_SESSIONS),
              },
            ],
            totals: totals(MOCK_DISK_SESSIONS),
          })
        }
        case 'sessions:stats':
          return Promise.resolve(mockStats())
        case 'app:openExternal':
          return Promise.resolve(undefined)
        case 'gh:available':
          return Promise.resolve(true)
        case 'gh:prForBranch':
          return Promise.resolve({
            number: 42,
            title: 'Composer attachments and worktree controls',
            state: 'OPEN',
            url: 'https://github.com/agustinsacco/pidex/pull/42',
            mergeable: 'MERGEABLE',
            mergeStateStatus: 'CLEAN',
            checks: { passed: 3, failed: 0, pending: 1, total: 4 },
          })
        case 'git:info':
          return Promise.resolve({
            isRepo: true,
            branch: 'main',
            dirtyCount: 3,
            ahead: 1,
            behind: 0,
            isWorktree: false,
          })
        case 'git:infoBatch': {
          const cwds = args[0] as string[]
          return Promise.resolve(
            Object.fromEntries(
              cwds.map((cwd, i) => [
                cwd,
                i === 0
                  ? {
                      isRepo: true,
                      branch: 'fix/phase0-chat-ux',
                      dirtyCount: 2,
                      isWorktree: true,
                      // Worktree folders are commonly named after their branch
                      // (".../worktrees/main") — mainRepoPath exercises the
                      // "repo (branch)" sidebar label instead of that folder name.
                      mainRepoPath: '/Users/dev/projects/pidex',
                    }
                  : { isRepo: true, branch: 'main', dirtyCount: 0, isWorktree: false },
              ]),
            ),
          )
        }
        case 'app:markSessionSeen':
          return Promise.resolve(undefined)
        case 'git:listWorktrees':
          return Promise.resolve([
            {
              path: '/Users/dev/projects/pidex',
              realPath: '/Users/dev/projects/pidex',
              branch: 'main',
              head: 'abcdef1234567890',
              isMain: true,
              locked: false,
              prunable: false,
              dirtyCount: 3,
            },
            {
              path: '/Users/dev/projects/pidex/.pidex/worktrees/fix-auth',
              realPath: '/Users/dev/projects/pidex/.pidex/worktrees/fix-auth',
              branch: 'fix-auth',
              head: '123456abcdef7890',
              isMain: false,
              locked: false,
              prunable: false,
              dirtyCount: 0,
            },
          ])
        case 'git:listBranches':
          return Promise.resolve({
            branches: [
              // `main` is deliberately NOT isCurrent: that is the state in which
              // the default branch looks "free" and used to be offered as a
              // worktree, which is what permanently locked the main tree out of
              // it. The menu must exclude it on defaultBranch alone.
              { name: 'main', isCurrent: false, lastCommitSubject: 'latest work' },
              {
                name: 'fix-auth',
                isCurrent: false,
                worktreePath: '/Users/dev/projects/pidex/.pidex/worktrees/fix-auth',
                lastCommitSubject: 'wip',
              },
              { name: 'feature/usage-view', isCurrent: true, lastCommitSubject: 'usage modal' },
              { name: 'chore/deps', isCurrent: false, lastCommitSubject: 'bump vite' },
            ],
            defaultBranch: 'main',
          })
        case 'git:addWorktree':
          return Promise.resolve({
            path: `/Users/dev/projects/pidex/.pidex/worktrees/${args[1] as string}`,
            realPath: `/Users/dev/projects/pidex/.pidex/worktrees/${args[1] as string}`,
            branch: args[1] as string,
            head: 'abcdef1234567890',
            isMain: false,
            locked: false,
            prunable: false,
            dirtyCount: 0,
          })
        case 'git:removeWorktree':
          return Promise.resolve({ removed: true, branchDeleted: false })
        case 'git:pruneWorktrees':
          return Promise.resolve({ pruned: [] })
        case 'git:commitAll':
          return Promise.resolve({ sha: 'abcdef1234567890' })
        case 'git:mergeBranch':
          return Promise.resolve({ merged: true, sha: 'abcdef1234567890' })
        case 'sessions:readTree':
          return Promise.resolve(mockTree())
        case 'fs:readDir': {
          const dir = args[1] as string
          return Promise.resolve(mockDir(dir))
        }
        case 'fs:readFile': {
          const path = args[0] as string
          return Promise.resolve({
            path,
            content: `// ${path}\nexport function hello(): string {\n  return 'from mock'\n}\n`,
            size: 64,
            mtimeMs: Date.now(),
          })
        }
        case 'fs:writeFile':
          return Promise.resolve({ mtimeMs: Date.now() })
        case 'git:statusMap':
          return Promise.resolve({ 'src/main.tsx': ' M', 'README.md': '??' })
        case 'git:sessionBaseline':
          return Promise.resolve(null)
        case 'git:showFileAt':
          return Promise.resolve('// baseline content\n')
        case 'fs:watchWorkspace':
        case 'sessions:watch':
        case 'sessions:unwatch':
          return Promise.resolve(undefined)
        case 'pty:create': {
          const ptyId = 'mock-pty-' + Math.random().toString(36).slice(2, 8)
          setTimeout(() => {
            for (const l of ptyListeners.get(ptyId) ?? []) l('mock shell — echo only\r\n$ ')
          }, 120)
          return Promise.resolve({ ptyId })
        }
        case 'pty:write': {
          const [ptyId, data] = args as [string, string]
          const echo = data.replace(/\r/g, '\r\n$ ')
          for (const l of ptyListeners.get(ptyId) ?? []) l(echo)
          return Promise.resolve(undefined)
        }
        case 'pty:resize':
        case 'pty:kill':
          return Promise.resolve(undefined)
        case 'pi:readConfigFile':
          return Promise.resolve({
            path: '/Users/dev/.pi/agent/settings.json',
            content: '{\n  "defaultThinkingLevel": "medium"\n}\n',
          })
        case 'pi:listResources':
          return Promise.resolve({
            skills: ['brave-search', 'web-fetch'],
            extensions: ['session.ts', 'rpc-demo.ts'],
            prompts: ['fix-tests.md'],
          })
        case 'pi:patchAgentSettings':
        case 'pi:writeConfigFile':
        case 'app:setFontPrefs':
        case 'app:setRecentWorkspaces':
        case 'app:setCollapsedWorkspaces':
        case 'app:recordWorkspace':
          return Promise.resolve(undefined)
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
    onFsChanged: () => () => {},
    onPtyData: (ptyId: string, listener: (data: string) => void) => {
      const set = ptyListeners.get(ptyId) ?? new Set()
      set.add(listener)
      ptyListeners.set(ptyId, set)
      return () => set.delete(listener)
    },
    onPtyExit: () => () => {},
    onPtyStatus: () => () => {},
    // The browser harness has no Electron, so there is no real path — files
    // dropped here are rejected by toAttachment rather than half-attached.
    pathForFile: () => '',
    piCommand: (sessionId, command) =>
      (api.invoke as (c: string, ...a: unknown[]) => Promise<never>)(
        'pi:command',
        sessionId,
        command,
      ),
  } as PidexApi

  window.pidex = api
  console.info('[pidex] mock preload API installed (browser dev mode)')
}
