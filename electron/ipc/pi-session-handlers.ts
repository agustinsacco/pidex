import { app } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, join as joinPath } from 'node:path'
import { fleetHub, registry } from '../registry'
import { handle } from './handle'
import { checkPiHealth } from '../pi/health'
import { piProcessEnv } from '../pi/shell-env'
import { dedupeTitle, sanitizeTitle, titlePrompt } from '../pi/session-naming'
import { sessionEventChannel } from '@shared/ipc'
import { getPrefs, recordWorkspace } from '../store'
import { broadcast } from '../orchestrator/broadcast'
import { configureOrchestrator, orchestrator } from '../orchestrator/instance'
import { startNotifier } from '../orchestrator/notifier'
import { gitInfo } from '../fs/git-info'
import {
  MIN_PI_VERSION,
  type CreateSessionOptions,
  type LiveSessionInfo,
  type PiHealth,
  type SessionPush,
} from '@shared/models'
import type { ExtensionUIResponse, RpcCommand } from '@shared/rpc'

let cachedHealth: PiHealth | null = null

/** Bundled pidex pi extension (dev: repo path; packaged: resources). */
function bundledExtensionPath(file: string): string {
  if (app.isPackaged) {
    return joinPath(process.resourcesPath, 'pi-ext', file)
  }
  return joinPath(app.getAppPath(), 'pi-ext', file)
}

/**
 * Extensions pidex loads into EVERY session, regardless of provider:
 * artifacts (tools the model can call) and context-breakdown (passive
 * reporting of what is filling the context window, which only pi can see).
 */
function bundledExtensions(): string[] {
  return [bundledExtensionPath('artifacts.ts'), bundledExtensionPath('context-breakdown.ts')]
}

/**
 * E2E hook: PIDEX_PI_STUB points at a script that speaks the RPC protocol in
 * place of the real pi binary, so CI can smoke-test without an API key.
 *
 * Gated on `!app.isPackaged`. The hook makes the main process execute an
 * arbitrary script as Node (`ELECTRON_RUN_AS_NODE`) while reporting pi as
 * healthy, so honoring it in a shipped app would turn an environment variable
 * into local code execution. Playwright drives an unpackaged build, so the
 * tests are unaffected.
 */
function piStubPath(): string | undefined {
  if (app.isPackaged) return undefined
  return process.env.PIDEX_PI_STUB || undefined
}

/**
 * Spawn a live session and wire its push channels.
 *
 * Extracted from the `pi:createSession` handler because the orchestrator
 * needs the exact same spawn path (login-shell env, bundled extensions, stub
 * handling) without going through the renderer. `target` decides where pushes
 * go: a renderer-initiated session pushes to its own window, while a
 * main-initiated one broadcasts, since no window owns it.
 */
async function spawnSession(
  options: CreateSessionOptions & { appendSystemPrompt?: string; extraExtensions?: string[] },
  target: Electron.WebContents | 'broadcast',
): Promise<LiveSessionInfo> {
  const stub = piStubPath()
  let binaryPath: string | undefined
  let prefixArgs: string[] | undefined

  if (stub) {
    binaryPath = process.execPath
    prefixArgs = [stub]
  } else {
    const health = cachedHealth?.ok ? cachedHealth : (cachedHealth = await checkPiHealth())
    if (!health.ok) throw new Error(health.message ?? 'pi is not available')
    binaryPath = health.binaryPath
  }

  // pi is a `#!/usr/bin/env node` script: it needs the login shell's PATH
  // to find node under a version manager, not the GUI-inherited one.
  const spawnEnv: Record<string, string> = stub
    ? { ELECTRON_RUN_AS_NODE: '1' }
    : {
        ...(await piProcessEnv()),
        // Read by pi-claude-cli when it spawns `claude`. Passed per session
        // rather than set once, so changing the setting applies to the next
        // session started without restarting pidex.
        PI_CLAUDE_CLI_SYSTEM_PROMPT: getPrefs().claudeSystemPrompt,
      }

  const extensions = [
    ...bundledExtensions(),
    ...(options.extraExtensions ?? []).map(bundledExtensionPath),
  ]

  const session = registry.create(options.workspacePath, {
    binaryPath,
    prefixArgs,
    sessionPath: options.sessionPath,
    forkFrom: options.forkFrom,
    name: options.name,
    model: options.model,
    provider: options.provider,
    thinkingLevel: options.thinkingLevel,
    ...(options.appendSystemPrompt ? { appendSystemPrompt: options.appendSystemPrompt } : {}),
    // The bundled artifacts extension rides along in every session.
    ...(stub ? {} : { extensions }),
    env: spawnEnv,
  })

  const channel = sessionEventChannel(session.sessionId)
  const push = (payload: SessionPush): void => {
    if (target === 'broadcast') {
      broadcast(channel, payload)
    } else if (!target.isDestroyed()) {
      target.send(channel, payload)
    }
  }

  session.client.on('event', (ev) => push({ kind: 'event', event: ev }))
  session.client.on('extension-ui', (request) => {
    // The orchestrator's tools reach main by riding this channel. Intercepted
    // requests are answered in main and must NOT reach the renderer, or every
    // fleet call would also pop a dialog. Authorization lives in the manager:
    // a sentinel from any other session falls through and stays a dialog.
    if (orchestrator()?.handleControlRequest(session.sessionId, request)) return
    push({ kind: 'extension-ui', request })
  })
  session.client.on('stderr', (text) => push({ kind: 'stderr', text }))
  session.client.on('exit', ({ code, signal, expected }) =>
    push({ kind: 'exit', code, signal: signal ?? null, expected }),
  )

  recordWorkspace(options.workspacePath, basename(options.workspacePath))
  return {
    sessionId: session.sessionId,
    workspacePath: session.workspacePath,
    pid: session.client.pid,
  }
}

/** pi subprocess lifecycle: health, session create/dispose, RPC passthrough. */
export function registerPiSessionHandlers(): void {
  // Teach the hub how a session's folder maps to the project that owns it,
  // BEFORE it starts observing. pidex runs most chats in a worktree, so
  // without this a project's own sessions look like they belong elsewhere.
  fleetHub.setProjectResolver(async (cwd) => {
    const info = await gitInfo(cwd)
    return info.mainRepoPath ?? cwd
  })
  fleetHub.start()
  // Tell the user when something blocks while they are elsewhere — the whole
  // premise of orchestration is that work continues when they are not looking.
  startNotifier(fleetHub)

  // Teach the orchestrator how to spawn, so it never reimplements the spawn
  // path (and so a change to env or bundled extensions reaches it for free).
  configureOrchestrator({
    spawn: async ({
      workspacePath,
      sessionPath,
      name,
      model,
      appendSystemPrompt,
      extraExtension,
    }) =>
      spawnSession(
        {
          workspacePath,
          ...(sessionPath ? { sessionPath } : {}),
          ...(name ? { name } : {}),
          ...(model ? { model } : {}),
          appendSystemPrompt,
          extraExtensions: [extraExtension],
        },
        'broadcast',
      ),
    startWork: async (workspacePath, prompt, name) => {
      const info = await spawnSession({ workspacePath, name }, 'broadcast')
      const session = registry.get(info.sessionId)
      await session?.client.request({ type: 'prompt', message: prompt })
      return { sessionId: info.sessionId }
    },
    gitStatus: async (workspacePath) => gitInfo(workspacePath),
  })

  handle('pi:health', async () => {
    if (piStubPath()) {
      return {
        ok: true,
        binaryPath: piStubPath(),
        version: MIN_PI_VERSION,
        minVersion: MIN_PI_VERSION,
      }
    }
    if (!cachedHealth || !cachedHealth.ok) cachedHealth = await checkPiHealth()
    return cachedHealth
  })

  handle('pi:createSession', (event, options: CreateSessionOptions) =>
    spawnSession(options, event.sender),
  )

  handle('pi:command', async (_event, sessionId: string, command: RpcCommand) => {
    const session = registry.get(sessionId)
    if (!session) throw new Error(`Unknown session: ${sessionId}`)
    const response = await session.client.request(command)
    // A session is auto-named AFTER its first reply, which for a one-shot
    // question is after it has already settled for the last time — so the hub
    // would keep reporting "untitled" forever, to the home screen and to the
    // orchestrator alike. This is the one place the name ever changes.
    if (command.type === 'set_session_name' && response.success) {
      fleetHub.noteRenamed(sessionId)
    }
    return response
  })

  handle('pi:extensionUiResponse', (_event, sessionId: string, response: ExtensionUIResponse) => {
    const session = registry.get(sessionId)
    if (!session) throw new Error(`Unknown session: ${sessionId}`)
    session.client.respondToExtensionUI(response)
    // The reply goes straight to pi's stdin and produces no event, so the hub
    // is told directly — otherwise an answered session would sit in the
    // "needs you" inbox forever.
    fleetHub.noteQuestionAnswered(sessionId, response.id)
  })

  handle('pi:disposeSession', async (_event, sessionId: string) => {
    await registry.dispose(sessionId)
  })

  handle('pi:listLiveSessions', () => registry.list())

  // Best-effort: naming is a nicety, so every failure path returns null and
  // the session keeps its first-message-derived title.
  handle(
    'pi:generateTitle',
    async (_event, workspacePath: string, message: string, existingNames: string[]) => {
      const stub = piStubPath()
      let binaryPath: string
      let prefixArgs: string[] = []
      let env: NodeJS.ProcessEnv
      if (stub) {
        binaryPath = process.execPath
        prefixArgs = [stub]
        env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      } else {
        const health = cachedHealth?.ok ? cachedHealth : (cachedHealth = await checkPiHealth())
        if (!health.ok || !health.binaryPath) return null
        binaryPath = health.binaryPath
        env = { ...process.env, ...(await piProcessEnv()) }
      }

      try {
        // `--no-session` keeps this run out of the sidebar; `--no-tools`
        // keeps a title request from being able to touch anything.
        const { stdout } = await promisify(execFile)(
          binaryPath,
          [...prefixArgs, '-p', '--no-session', '--no-tools', titlePrompt(message, existingNames)],
          { cwd: workspacePath, env, timeout: 30_000, maxBuffer: 1024 * 1024 },
        )
        const title = sanitizeTitle(stdout)
        return title ? dedupeTitle(title, existingNames) : null
      } catch {
        return null
      }
    },
  )
}
