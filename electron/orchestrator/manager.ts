import { basename } from 'node:path'
import { existsSync } from 'node:fs'
import {
  DEFAULT_ORCHESTRATOR_PREFS,
  type OrchestratorDigest,
  type OrchestratorWorkspacePrefs,
  type SweepKind,
} from '@shared/models'
import { orchestratorSessionName } from '@shared/orchestratorIdentity'
import type { SessionRegistry } from '../pi/session-registry'
import {
  getPrefs,
  setOrchestratorDigest,
  setOrchestratorPrefs,
  setOrchestratorSession,
} from '../store'
import type { FleetHub } from './fleet'
import { broadcast } from './broadcast'
import { readMemory, readRules, writeMemory, writeRules, DEFAULT_RULES } from './files'
import { systemPreamble, sweepPrompt } from './prompt'
import { notifyDigest } from './notifier'
import { handleFleetCommand, type BridgeDeps } from './bridge'
import { encodeResult, parseRequestTitle, type FleetCommandName } from './protocol'
import type { ExtensionUIRequest } from '@shared/rpc'

/**
 * Owns each project's orchestrator session and answers its control calls.
 *
 * The only thing here that spends tokens is `sweep()`, and it is always
 * user-initiated or explicitly opted into — see specs/13-orchestration.md.
 */

/** Sweeps closer together than this are refused rather than queued. */
const SWEEP_MIN_INTERVAL_MS = 60_000

export interface OrchestratorSpawnDeps {
  /** Create a live session the same way `pi:createSession` does. */
  spawn: (options: {
    workspacePath: string
    sessionPath?: string
    name?: string
    model?: string
    appendSystemPrompt: string
    extraExtension: string
  }) => Promise<{ sessionId: string }>
  /** Start an ordinary work session (used by autopilot / accepted proposals). */
  startWork: (workspacePath: string, prompt: string, name: string) => Promise<{ sessionId: string }>
  gitStatus: (workspacePath: string) => Promise<unknown>
}

export class OrchestratorManager {
  /** workspacePath → live orchestrator session id. */
  private readonly live = new Map<string, string>()
  private readonly lastSweep = new Map<string, number>()
  private readonly sweeping = new Set<string>()

  constructor(
    private readonly registry: SessionRegistry,
    private readonly hub: FleetHub,
    private readonly deps: OrchestratorSpawnDeps,
  ) {
    // A crashed or disposed orchestrator must not leave a stale id behind, or
    // `ensure()` would keep handing out a session that no longer exists.
    this.registry.on('disposed', ({ sessionId }) => {
      for (const [workspace, id] of this.live) {
        if (id === sessionId) this.live.delete(workspace)
      }
    })
  }

  prefsFor(workspacePath: string): OrchestratorWorkspacePrefs {
    return { ...DEFAULT_ORCHESTRATOR_PREFS, ...getPrefs().orchestrator[workspacePath] }
  }

  setPrefs(workspacePath: string, value: OrchestratorWorkspacePrefs): void {
    setOrchestratorPrefs(workspacePath, value)
  }

  /** Live orchestrator session id for a project, if one is running. */
  sessionFor(workspacePath: string): string | undefined {
    return this.live.get(workspacePath)
  }

  /**
   * Spawn or resume this project's orchestrator. Idempotent.
   *
   * Resuming by session **file path** (rather than a fixed session id) reuses
   * the resume path every reopened session already takes, and keeps the same
   * thread across restarts.
   */
  async ensure(workspacePath: string): Promise<{ sessionId: string }> {
    const existing = this.live.get(workspacePath)
    if (existing && this.registry.get(existing)) return { sessionId: existing }

    const prefs = this.prefsFor(workspacePath)
    if (!prefs.enabled) {
      this.setPrefs(workspacePath, { ...prefs, enabled: true })
    }
    // Seed the rules file on first use so it is discoverable and editable.
    const rules = await readRules(workspacePath)
    if (!rules.exists) await writeRules(workspacePath, DEFAULT_RULES)
    const effectiveRules = rules.exists ? rules.content : DEFAULT_RULES

    const projectName = basename(workspacePath)
    const known = getPrefs().orchestratorSessions[workspacePath]
    const resumePath = known && existsSync(known) ? known : undefined

    const { sessionId } = await this.deps.spawn({
      workspacePath,
      sessionPath: resumePath,
      // Naming only applies to a fresh session; a resumed one keeps its name.
      ...(resumePath ? {} : { name: orchestratorSessionName(projectName) }),
      ...(prefs.model ? { model: prefs.model } : {}),
      appendSystemPrompt: `${systemPreamble(projectName, prefs.autopilot)}\n\n${effectiveRules}`,
      extraExtension: 'orchestrator.ts',
    })

    this.live.set(workspacePath, sessionId)
    this.hub.markOrchestrator(sessionId)
    void this.rememberSessionPath(workspacePath, sessionId)
    return { sessionId }
  }

  /**
   * Record the orchestrator's session file once pi reports it.
   *
   * The hub learns the path asynchronously (`get_state` resolves after spawn),
   * so this polls the hub briefly rather than racing it. Without the stored
   * path the next launch would start a brand-new thread instead of resuming.
   */
  private async rememberSessionPath(workspacePath: string, sessionId: string): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const path = this.hub.get(sessionId)?.diskPath
      if (path) {
        setOrchestratorSession(workspacePath, path)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }

  /**
   * Run a sweep. The one token-spending path in this file.
   *
   * Refused rather than queued when one is already running: sweeps are
   * expensive and a queued second one would report on the same state.
   */
  async sweep(workspacePath: string, kind: SweepKind): Promise<void> {
    if (this.sweeping.has(workspacePath)) {
      throw new Error('A sweep is already running for this project.')
    }
    const last = this.lastSweep.get(workspacePath) ?? 0
    if (Date.now() - last < SWEEP_MIN_INTERVAL_MS) {
      throw new Error('That sweep just ran. Give it a minute.')
    }

    const { sessionId } = await this.ensure(workspacePath)
    const session = this.registry.get(sessionId)
    if (!session) throw new Error('The orchestrator session is not running.')

    this.sweeping.add(workspacePath)
    this.lastSweep.set(workspacePath, Date.now())
    try {
      const fleet = this.hub.forWorkspace(workspacePath).filter((s) => !s.isOrchestrator)
      const message = sweepPrompt(kind, fleet)
      // The sweep prompt is an ordinary user message, so it shows in the
      // orchestrator's own transcript — what it was asked is never hidden.
      broadcast(`pi:event:${sessionId}`, {
        kind: 'injected',
        text: message,
        source: 'orchestrator',
      })
      const response = await session.client.request({ type: 'prompt', message })
      if (!response.success) throw new Error(response.error ?? 'sweep failed')
    } finally {
      this.sweeping.delete(workspacePath)
    }
  }

  /**
   * Start work the user accepted from the inbox.
   *
   * Deliberately not subject to the autopilot cap: that cap governs what the
   * agent starts unattended, and this is the user pressing a button.
   */
  async startProposedWork(workspacePath: string, prompt: string): Promise<{ sessionId: string }> {
    return this.deps.startWork(workspacePath, prompt, prompt.slice(0, 60))
  }

  /** Called for every extension-UI request; returns true when it was ours. */
  handleControlRequest(sessionId: string, request: ExtensionUIRequest): boolean {
    if (request.method !== 'input') return false
    const command = parseRequestTitle(request.title)
    if (!command) return false
    // Authorization: only a session this manager spawned may drive the fleet.
    // A sentinel from anywhere else falls through and renders as an ordinary
    // dialog, so it can never be a covert channel into main.
    if (!this.hub.isOrchestrator(sessionId)) return false

    void this.dispatch(sessionId, command, request)
    return true
  }

  private async dispatch(
    sessionId: string,
    command: FleetCommandName,
    request: Extract<ExtensionUIRequest, { method: 'input' }>,
  ): Promise<void> {
    // Arguments ride in `placeholder` as JSON. Garbage degrades to "no
    // arguments" so the command still answers with a real validation error.
    let args: Record<string, unknown>
    try {
      args = request.placeholder ? (JSON.parse(request.placeholder) as Record<string, unknown>) : {}
    } catch {
      args = {}
    }

    let payload: string
    try {
      // Which project this orchestrator speaks for — the key it was spawned
      // under, not its cwd, so worktree sessions resolve into the same scope.
      const workspace =
        [...this.live.entries()].find(([, id]) => id === sessionId)?.[0] ??
        this.hub.get(sessionId)?.workspacePath ??
        ''
      payload = encodeResult(
        await handleFleetCommand(this.bridgeDeps(workspace), sessionId, command, args),
      )
    } catch (error) {
      payload = encodeResult({ ok: false, error: (error as Error).message })
    }
    // Always answer: an unanswered request would hang the tool until its
    // timeout, which reads to the model as pidex being broken.
    this.registry.get(sessionId)?.client.respondToExtensionUI({
      type: 'extension_ui_response',
      id: request.id,
      value: payload,
    })
  }

  private bridgeDeps(callerWorkspace: string): BridgeDeps {
    return {
      // Scoped to this orchestrator's own project — its main tree plus every
      // worktree under it. That is both a correctness fix (most chats run in
      // a worktree, so an exact-path filter saw nothing) and the read boundary
      // the spec declares: an orchestrator sees its project, not the machine.
      // Its own session stays in the list so the bridge can recognise the
      // caller; `fleet_status` filters orchestrators out separately.
      snapshot: () => this.hub.forWorkspace(callerWorkspace),
      isOrchestrator: (id) => this.hub.isOrchestrator(id),
      requestOn: async (sessionId, command) => {
        const session = this.registry.get(sessionId)
        if (!session) return { success: false, error: `no live session ${sessionId}` }
        return session.client.request(command as never)
      },
      answerQuestion: (sessionId, requestId, answer) => {
        const session = this.registry.get(sessionId)
        if (!session) return
        session.client.respondToExtensionUI(
          answer.confirmed !== undefined
            ? { type: 'extension_ui_response', id: requestId, confirmed: answer.confirmed }
            : { type: 'extension_ui_response', id: requestId, value: answer.value ?? '' },
        )
        this.hub.noteQuestionAnswered(sessionId, requestId)
      },
      announceInjection: (sessionId, text) => {
        broadcast(`pi:event:${sessionId}`, { kind: 'injected', text, source: 'orchestrator' })
      },
      gitStatus: (workspacePath) => this.deps.gitStatus(workspacePath),
      readMemory: (workspacePath) => readMemory(workspacePath),
      writeMemory: (workspacePath, content) => writeMemory(workspacePath, content),
      publishDigest: (digest: OrchestratorDigest) => {
        setOrchestratorDigest(digest)
        broadcast('orchestrator:digest', digest)
        notifyDigest(digest)
      },
      proposeWork: async (workspacePath, title, prompt) => {
        const prefs = this.prefsFor(workspacePath)
        if (!prefs.autopilot) {
          return { started: false, reason: 'autopilot is off; this was suggested to the user' }
        }
        const running = this.hub
          .forWorkspace(workspacePath)
          .filter((s) => !s.isOrchestrator && s.phase !== 'exited').length
        if (running >= prefs.maxConcurrent) {
          return { started: false, reason: `at the ${prefs.maxConcurrent}-session cap` }
        }
        await this.deps.startWork(workspacePath, prompt, title)
        return { started: true }
      },
    }
  }
}
