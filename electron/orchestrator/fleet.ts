import type { FleetSession, FleetSnapshot } from '@shared/models'
import type { ExtensionUIRequest, PiEvent } from '@shared/rpc'
import type { SessionRegistry, LiveSession } from '../pi/session-registry'
import { broadcast } from './broadcast'
import { emptySession, fleetReducer, type FleetInput } from './fleetReducer'

/**
 * The fleet hub: one normalized record per live session, derived entirely
 * from events pidex already receives.
 *
 * **It never runs inference and never spawns anything.** That is the whole
 * point of the layer — the home screen's picture of "what is everything
 * doing" costs nothing, so it can be always-on. See docs/orchestration.md.
 */

/**
 * Coalesce bursts before telling the renderer. A streaming session emits
 * events per token batch; the home screen re-rendering at that rate is how a
 * status view becomes its own performance problem.
 */
const BROADCAST_DEBOUNCE_MS = 150

export class FleetHub {
  private readonly sessions = new Map<string, FleetSession>()
  /** Detachers for the per-client listeners, so dispose leaves nothing behind. */
  private readonly detachers = new Map<string, () => void>()
  private readonly orchestrators = new Set<string>()
  private readonly listeners = new Set<(snapshot: FleetSnapshot) => void>()
  private timer: NodeJS.Timeout | null = null
  private started = false
  /** Overridden via `setProjectResolver`; the identity is the safe default. */
  private resolveProject: (cwd: string) => Promise<string> = (cwd) => Promise.resolve(cwd)

  constructor(private readonly registry: SessionRegistry) {}

  start(): void {
    if (this.started) return
    this.started = true
    this.registry.on('created', (session) => this.attach(session))
    this.registry.on('disposed', ({ sessionId }) => this.detach(sessionId))
    // Anything already running (there should be nothing at boot, but this
    // keeps start() safe to call late).
    for (const info of this.registry.list()) {
      const session = this.registry.get(info.sessionId)
      if (session) this.attach(session)
    }
  }

  /** Mark a session as the orchestrator, before or after it is attached. */
  markOrchestrator(sessionId: string): void {
    this.orchestrators.add(sessionId)
    const existing = this.sessions.get(sessionId)
    if (existing && !existing.isOrchestrator) {
      this.sessions.set(sessionId, { ...existing, isOrchestrator: true })
      this.schedule()
    }
  }

  isOrchestrator(sessionId: string): boolean {
    return this.orchestrators.has(sessionId)
  }

  snapshot(): FleetSnapshot {
    return { sessions: [...this.sessions.values()], updatedAt: Date.now() }
  }

  get(sessionId: string): FleetSession | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * How a session's cwd maps to the project that owns it. Injected because
   * resolving it means asking git, which the hub must not import.
   */
  setProjectResolver(resolve: (cwd: string) => Promise<string>): void {
    this.resolveProject = resolve
  }

  /**
   * Sessions belonging to one project — its main working tree *and* every
   * worktree hanging off it, which is where most pidex chats actually run.
   */
  forWorkspace(projectPath: string): FleetSession[] {
    return [...this.sessions.values()].filter(
      (s) => s.projectRoot === projectPath || s.workspacePath === projectPath,
    )
  }

  /**
   * A reply was sent for an extension-UI request, so whichever session was
   * blocked on it is unblocked. Called from the IPC handler rather than
   * inferred, because the reply travels straight to pi's stdin and produces
   * no event of its own.
   */
  noteQuestionAnswered(sessionId: string, requestId: string): void {
    this.apply(sessionId, { kind: 'question-answered', requestId })
  }

  /** A session was renamed, so the cached title is stale. */
  noteRenamed(sessionId: string): void {
    const session = this.registry.get(sessionId)
    if (session) void this.learnMeta(session)
  }

  private attach(session: LiveSession): void {
    const { sessionId, workspacePath, client } = session
    this.sessions.set(
      sessionId,
      emptySession(sessionId, workspacePath, { isOrchestrator: this.orchestrators.has(sessionId) }),
    )

    const onEvent = (event: PiEvent): void => this.apply(sessionId, { kind: 'event', event })
    const onExtensionUi = (request: ExtensionUIRequest): void =>
      this.apply(sessionId, { kind: 'extension-ui', request })
    const onExit = (): void => this.apply(sessionId, { kind: 'exit' })

    client.on('event', onEvent)
    client.on('extension-ui', onExtensionUi)
    client.on('exit', onExit)
    this.detachers.set(sessionId, () => {
      client.off('event', onEvent)
      client.off('extension-ui', onExtensionUi)
      client.off('exit', onExit)
    })

    void this.learnMeta(session)
    void this.learnProject(session)
    this.schedule()
  }

  /** Resolve which project owns this session's folder (git main worktree). */
  private async learnProject(session: LiveSession): Promise<void> {
    try {
      const projectRoot = await this.resolveProject(session.workspacePath)
      this.apply(session.sessionId, { kind: 'meta', projectRoot })
    } catch {
      // Not a repo, or git unavailable: the cwd is its own project.
      this.apply(session.sessionId, { kind: 'meta', projectRoot: session.workspacePath })
    }
  }

  /**
   * Ask pi for the session's file path and name.
   *
   * The hub cannot wait for the renderer to do this — main must not depend on
   * a window being open — and `get_state` reads pi's in-memory state with no
   * disk I/O, so it is cheap enough to repeat for sessions we still know
   * nothing about. Failures are ignored: a session whose path we never learn
   * simply shows without one.
   */
  private async learnMeta(session: LiveSession): Promise<void> {
    try {
      const response = await session.client.request({ type: 'get_state' })
      if (!response.success || !response.data) return
      this.apply(session.sessionId, {
        kind: 'meta',
        diskPath: response.data.sessionFile,
        title: response.data.sessionName,
      })
    } catch {
      // Session died before answering; nothing to record.
    }
  }

  private detach(sessionId: string): void {
    this.detachers.get(sessionId)?.()
    this.detachers.delete(sessionId)
    this.sessions.delete(sessionId)
    this.orchestrators.delete(sessionId)
    this.schedule()
  }

  private apply(sessionId: string, input: FleetInput): void {
    const current = this.sessions.get(sessionId)
    if (!current) return
    const next = fleetReducer(current, input)
    // Reference equality is the reducer's contract for "nothing changed",
    // which is what keeps per-token events off the broadcast path.
    if (next === current) return
    this.sessions.set(sessionId, next)

    // Re-ask once a session is at rest if we still lack its path or its name.
    // Both arrive late: pi answers `get_state` before it has flushed the file,
    // and pidex names a new session with `set_session_name` only after its
    // first message. Without this the fleet reports "untitled" forever — to
    // the home screen AND to the orchestrator's own `fleet_status`, which is
    // why its report referred to sessions by id instead of by name.
    if ((!next.diskPath || !next.title) && (next.phase === 'idle' || next.phase === 'error')) {
      const session = this.registry.get(sessionId)
      if (session) void this.learnMeta(session)
    }
    this.schedule()
  }

  /** Called with each debounced snapshot; used by the notifier. */
  onChange(listener: (snapshot: FleetSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      const snapshot = this.snapshot()
      broadcast('fleet:changed', snapshot)
      for (const listener of this.listeners) listener(snapshot)
    }, BROADCAST_DEBOUNCE_MS)
    this.timer.unref()
  }
}
