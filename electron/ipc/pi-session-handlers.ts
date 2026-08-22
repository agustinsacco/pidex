import { app } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, join as joinPath } from 'node:path'
import { registry } from '../registry'
import { handle } from './handle'
import { checkPiHealth } from '../pi/health'
import { piProcessEnv } from '../pi/shell-env'
import { dedupeTitle, sanitizeTitle, titlePrompt } from '../pi/session-naming'
import { sessionEventChannel } from '@shared/ipc'
import { recordWorkspace } from '../store'
import {
  MIN_PI_VERSION,
  type CreateSessionOptions,
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

/** pi subprocess lifecycle: health, session create/dispose, RPC passthrough. */
export function registerPiSessionHandlers(): void {
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

  handle('pi:createSession', async (event, options: CreateSessionOptions) => {
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
    const spawnEnv = stub ? { ELECTRON_RUN_AS_NODE: '1' } : await piProcessEnv()

    const session = registry.create(options.workspacePath, {
      binaryPath,
      prefixArgs,
      sessionPath: options.sessionPath,
      forkFrom: options.forkFrom,
      name: options.name,
      model: options.model,
      provider: options.provider,
      thinkingLevel: options.thinkingLevel,
      // The bundled artifacts extension rides along in every session.
      ...(stub ? {} : { extensions: bundledExtensions() }),
      env: spawnEnv,
    })

    const contents = event.sender
    const channel = sessionEventChannel(session.sessionId)
    const push = (payload: SessionPush): void => {
      if (!contents.isDestroyed()) contents.send(channel, payload)
    }

    session.client.on('event', (ev) => push({ kind: 'event', event: ev }))
    session.client.on('extension-ui', (request) => push({ kind: 'extension-ui', request }))
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
  })

  handle('pi:command', async (_event, sessionId: string, command: RpcCommand) => {
    const session = registry.get(sessionId)
    if (!session) throw new Error(`Unknown session: ${sessionId}`)
    return session.client.request(command)
  })

  handle('pi:extensionUiResponse', (_event, sessionId: string, response: ExtensionUIResponse) => {
    const session = registry.get(sessionId)
    if (!session) throw new Error(`Unknown session: ${sessionId}`)
    session.client.respondToExtensionUI(response)
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
