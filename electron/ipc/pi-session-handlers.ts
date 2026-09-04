import { app } from 'electron'
import { basename, join as joinPath } from 'node:path'
import { registry } from '../registry'
import { handle } from './handle'
import { trimForRenderer } from './event-trim'
import { checkPiHealth } from '../pi/health'
import { piStubPath } from '../pi/stub'
import { runPrintMode } from '../pi/print-mode'
import { piProcessEnv } from '../pi/shell-env'
import { composeDirectives } from '../pi/directives'
import { dedupeTitle, sanitizeTitle, titleArgs, titlePrompt } from '../pi/session-naming'
import { claudeProviderSpawnEnv, usesClaudeCliProvider } from '../pi/provider-detect'
import { readAgentSettings } from '../pi/agent-settings'
import { sessionEventChannel } from '@shared/ipc'
import { getPrefs, recordWorkspace, getLanePrefs } from '../store'
import { gitInfoBatch } from '../fs/git-info'
import {
  MIN_PI_VERSION,
  type CreateSessionOptions,
  type LiveSessionInfo,
  type PiHealth,
  type SessionPush,
} from '@shared/models'
import type { ExtensionUIResponse, RpcCommand } from '@shared/rpc'
import { log } from '../debug-log'

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
 * artifacts (tools the model can call), context-breakdown (passive reporting
 * of what is filling the context window, which only pi can see),
 * worktree-paths (refuses a file read that has escaped into the main
 * checkout of a worktree session), tool-name-guard (keeps a malformed
 * tool call out of the session file, where it would brick every later turn),
 * and mcp-status (per-server MCP state for the connectors UI).
 */
function bundledExtensions(): string[] {
  return [
    bundledExtensionPath('artifacts.ts'),
    bundledExtensionPath('context-breakdown.ts'),
    bundledExtensionPath('worktree-paths.ts'),
    bundledExtensionPath('tool-name-guard.ts'),
    bundledExtensionPath('mcp-status.ts'),
  ]
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
  options: CreateSessionOptions & {
    appendSystemPrompt?: string
    extraExtensions?: string[]
  },
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
  //
  // No PI_CLAUDE_CLI_SYSTEM_PROMPT override here: real sessions always run
  // pi-claude-cli's own default (`claude` mode, appends pi's prompt to Claude
  // Code's own). This used to be a pidex setting; dropped because the only
  // upside of the alternative (`pi` mode, replacing Claude Code's prompt
  // outright) is ~12k tokens of context WINDOW, not cost — both modes are
  // cached — at the cost of losing Claude Code's own tuned guidance for the
  // native tools this provider actually runs. Not worth doubling the number
  // of system-prompt code paths that have to reach the model correctly; see
  // docs/log/2026-08-29-claude-cli-lifecycle-verification.md for how fragile
  // that one path already turned out to be. The naming call below keeps its
  // own internal `pi` override — a no-tools, no-guidance-needed case.
  // Claude Code auto-compact window (Settings → Claude Code → Context
  // window). Read per spawn so a change applies to the next session started
  // without restarting pidex; unset means the provider's own default (200k),
  // so the env var is only set when the user chose something.
  const claudeAutocompact = getPrefs().claudeAutocompact
  const spawnEnv: Record<string, string> = stub
    ? { ELECTRON_RUN_AS_NODE: '1' }
    : {
        ...(await piProcessEnv()),
        ...(claudeAutocompact ? { PI_CLAUDE_CLI_AUTOCOMPACT: claudeAutocompact } : {}),
      }

  const extensions = [
    ...bundledExtensions(),
    ...(options.extraExtensions ?? []).map(bundledExtensionPath),
  ]

  // Worktree sessions get an explicit working-directory block: pi's own
  // `Current working directory:` line is correct but has been observed to
  // lose against a model rebuilding an absolute path from what it thinks
  // the project root is. Skipped for the stub, which speaks a fixed script.
  // The batched form for one path on purpose: it is the cached one, and the
  // sidebar has almost always just resolved this cwd, so creating a session
  // usually costs no git at all.
  const gitByPath = stub ? {} : await gitInfoBatch([options.workspacePath])
  const git = gitByPath[options.workspacePath] ?? { isRepo: false }
  // Layer 2 of the directive stack. `directives.ts` owns the order and the
  // reasoning; this only resolves which prefs apply. Per-project overrides key
  // on the repo of record, so every worktree of a repo gets the same rules.
  const projectKey = git.mainRepoPath ?? options.workspacePath
  const prefs = getPrefs()
  const directivePrefs = prefs.agentDirectivesByProject[projectKey] ?? prefs.agentDirectives
  const appendSystemPrompt = composeDirectives({
    cwd: options.workspacePath,
    git,
    prefs: directivePrefs,
    // Present only for a lane on its own branch. A session opened in the main
    // checkout is not a lane and is not told it owes a PR.
    ...(git.isWorktree && git.branch ? { charter: { branch: git.branch } } : {}),
    // The orchestrator supplies its own preamble and is not a lane.
    ...(options.appendSystemPrompt ? { extra: options.appendSystemPrompt } : {}),
  })

  // Claude-provider sessions get `--no-context-files`: the Claude CLI loads
  // CLAUDE.md itself as memory, so pi's copy in the system prompt bills the
  // same file twice on EVERY request (~4,900 tokens measured on this repo).
  // Known trade-off: pi's prompt is fixed at spawn, so a session switched to
  // a non-Claude provider mid-conversation runs without pi's CLAUDE.md copy.
  // See docs/log/2026-08-29-claude-provider-token-overhead.md.
  const claudeProvider = stub
    ? false
    : usesClaudeCliProvider(
        options,
        (await readAgentSettings(options.workspacePath)).defaultProvider,
      )
  const noContextFiles = claudeProvider

  // Same verdict, second consequence: confine the Claude CLI to pi's own tool
  // registry so MCP reaches the model only through the adapter's gateway.
  // Rationale and the pi-claude-cli version floor live in provider-detect.ts.
  if (claudeProvider) Object.assign(spawnEnv, claudeProviderSpawnEnv())

  const session = registry.create(options.workspacePath, {
    binaryPath,
    prefixArgs,
    sessionPath: options.sessionPath,
    forkFrom: options.forkFrom,
    name: options.name,
    model: options.model,
    provider: options.provider,
    thinkingLevel: options.thinkingLevel,
    ...(noContextFiles ? { noContextFiles } : {}),
    ...(appendSystemPrompt ? { appendSystemPrompt } : {}),
    // The bundled artifacts extension rides along in every session.
    ...(stub ? {} : { extensions }),
    env: spawnEnv,
  })

  const channel = sessionEventChannel(session.sessionId)
  const push = (payload: SessionPush): void => {
    if (target === 'broadcast') {
      // Broadcast removed with orchestration feature; session events now
      // rely on renderer-initiated pushes only.
    } else if (!target.isDestroyed()) {
      target.send(channel, payload)
    }
  }

  // Trimmed, not forwarded whole: two of pi's events restate the entire run
  // after it has already streamed, and the renderer reads neither. The fleet
  // hub listens on the client directly, so it still sees them intact.
  session.client.on('event', (ev) => push({ kind: 'event', event: trimForRenderer(ev) }))
  session.client.on('extension-ui', (request) => {
    // Orchestration layer removed; all extension UI requests forwarded.
    push({ kind: 'extension-ui', request })
  })
  session.client.on('stderr', (text) => {
    // Persist as well as forward. pi's stderr is where a provider prints the
    // reason a turn failed, and forwarding it to the renderer alone means it
    // is gone the moment the view unmounts — which is exactly what made
    // `Error: Claude CLI returned success` so expensive to diagnose.
    log('pi', 'stderr', { sessionId: session.sessionId, text })
    push({ kind: 'stderr', text })
  })
  session.client.on('exit', ({ code, signal, expected }) => {
    // An unexpected exit is what the user sees as "pi crashed"; without this
    // the code and signal behind that banner are never written down.
    if (!expected) {
      log('pi', 'exited unexpectedly', { sessionId: session.sessionId, code, signal })
    }
    push({ kind: 'exit', code, signal: signal ?? null, expected })
  })

  recordWorkspace(options.workspacePath, basename(options.workspacePath))
  return {
    sessionId: session.sessionId,
    workspacePath: session.workspacePath,
    pid: session.client.pid,
  }
}

/** pi subprocess lifecycle: health, session create/dispose, RPC passthrough. */
export function registerPiSessionHandlers(): void {
  // Orchestration layer removed.
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
    // Orchestration layer removed; naming handled directly.
    if (command.type === 'set_session_name' && response.success) {
      // Name tracking removed with orchestration feature.
    }
    return response
  })

  handle('pi:extensionUiResponse', (_event, sessionId: string, response: ExtensionUIResponse) => {
    const session = registry.get(sessionId)
    if (!session) throw new Error(`Unknown session: ${sessionId}`)
    session.client.respondToExtensionUI(response)
    // The reply goes straight to pi's stdin; no orchestration inbox.
    // Orchestration layer removed.
  })

  handle('pi:disposeSession', async (_event, sessionId: string) => {
    await registry.dispose(sessionId)
  })

  handle('pi:listLiveSessions', () => registry.list())

  handle('pi:setActiveSession', (_event, _sessionId: string | null) => {
    // Session reaper removed with orchestration feature.
  })

  // Best-effort: naming is a nicety, so every failure path returns null and
  // the session keeps its first-message-derived title.
  handle(
    'pi:generateTitle',
    async (_event, workspacePath: string, message: string, existingNames: string[]) => {
      const lanePrefs = getLanePrefs()
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
        env = {
          ...process.env,
          ...(await piProcessEnv()),
          // Naming-only override: a title run through the Claude provider
          // should not load Claude Code's own prompt, skills, MCP servers or
          // settings — it never calls a tool, so there is no native-tool
          // guidance to lose by replacing the prompt outright. Real sessions
          // don't get this override; see the comment above spawnEnv. Harmless
          // env for every other provider. Measured saving: ~8,000 tokens per
          // run.
          PI_CLAUDE_CLI_HERMETIC: '1',
          PI_CLAUDE_CLI_SYSTEM_PROMPT: 'pi',
        }
      }

      // `--no-session` keeps this run out of the sidebar; `--no-tools`
      // keeps a title request from being able to touch anything; the rest of
      // `titleArgs` keeps a five-word title from paying for a full session's
      // context. Spawned through runPrintMode because `pi -p` blocks until
      // stdin hits EOF — see electron/pi/print-mode.ts, and never
      // reintroduce execFile here.
      const claudeCli = stub
        ? false
        : usesClaudeCliProvider({}, (await readAgentSettings(workspacePath)).defaultProvider)
      const started = Date.now()
      const { stdout, error } = await runPrintMode(
        binaryPath,
        [
          ...prefixArgs,
          ...titleArgs({ claudeCli }),
          titlePrompt(message, existingNames, {
            min: lanePrefs.nameMinWords,
            max: lanePrefs.nameMaxWords,
          }),
        ],
        { cwd: workspacePath, env },
      )
      const title = stdout ? sanitizeTitle(stdout, lanePrefs.nameMaxLength) : null
      // Logged either way: this failing produced no symptom at all for weeks
      // beyond "sessions are never named", which named no cause. One line per
      // new chat is a price worth paying for that never happening again.
      log('naming', title ? 'generated a session name' : 'no session name', {
        ms: Date.now() - started,
        title,
        ...(error ? { error } : {}),
      })
      return title ? dedupeTitle(title, existingNames) : null
    },
  )
}
