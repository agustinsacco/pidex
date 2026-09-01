import type { FleetSession, SessionReaperPrefs } from '@shared/models'
import { sessionEventChannel } from '@shared/ipc'
import type { SessionRegistry } from './session-registry'
import type { FleetHub } from '../orchestrator/fleet'
import { broadcast } from '../orchestrator/broadcast'
import { log } from '../debug-log'

/**
 * The idle-session reaper: the policy on top of the suspend mechanism.
 *
 * Every `pi --mode rpc` subprocess costs ~200 MB RSS whether it is doing
 * anything or not (MEASURED: 602 MB for three idle sessions), and before this
 * nothing ever reclaimed one — `registry.dispose` was reached only by explicit
 * user action or by quitting. Ten open lanes was ~2 GB, forever.
 *
 * It lives in MAIN, not the renderer, on purpose. A renderer-side policy dies
 * with the renderer, and the renderer dying is itself one of the leaks this
 * exists to fix: a reload (HMR, crash, re-navigation) used to orphan every
 * live pi until quit. Main-side, the same sweep that enforces the budget also
 * reclaims sessions no renderer remembers.
 *
 * The state it reads is the fleet hub's — phase, lastActivityAt,
 * pendingQuestion — which is derived from events pidex already receives, so
 * the reaper adds zero RPC and zero inference.
 */

/** How often the policy is evaluated. Reaping tolerance is minutes, not ms. */
const SWEEP_INTERVAL_MS = 60_000

export interface ReapDecisionInput {
  sessions: readonly FleetSession[]
  prefs: SessionReaperPrefs
  /** The session on screen; never reaped. Null when no renderer has said. */
  activeSessionId: string | null
  hasLivePtys: (sessionId: string) => boolean
  now: number
}

/**
 * Which sessions to reclaim right now. Pure, so the whole policy is testable
 * without a registry, a window, or a clock.
 *
 * Both conditions must hold — over the cap AND idle past the grace — and the
 * eligibility list errs on keeping sessions alive. Reaping something the user
 * still needs destroys work to save memory, which is a bad trade at any size:
 *
 * - `streaming` / `awaiting-input` are doing something or blocking on the
 *   user; `exited` is left for the crash banner's resume flow.
 * - A pending question is work the user has not answered yet.
 * - The orchestrator is main's own long-lived manager thread.
 * - A live PTY may be running a build; disposal kills it (`pty:kill`).
 * - No diskPath means resume is impossible, so reaping would lose the thread.
 * - The grace applies to BOTH `idleSince` and `lastActivityAt`. Phase is
 *   derived state and could in principle be wrong; lastActivityAt moves on
 *   every event a session emits, so a genuinely streaming session can never
 *   look idle-past-grace even if its phase somehow did.
 */
export function pickReapable(input: ReapDecisionInput): FleetSession[] {
  const { sessions, prefs, activeSessionId, hasLivePtys, now } = input
  if (!prefs.enabled) return []
  const overBudget = sessions.length - prefs.maxLiveSessions
  if (overBudget <= 0) return []

  const graceMs = prefs.idleGraceMinutes * 60_000
  const eligible = sessions.filter(
    (s) =>
      s.phase === 'idle' &&
      !s.isOrchestrator &&
      !s.pendingQuestion &&
      s.sessionId !== activeSessionId &&
      typeof s.diskPath === 'string' &&
      s.diskPath.length > 0 &&
      now - s.lastActivityAt > graceMs &&
      now - (s.idleSince ?? s.lastActivityAt) > graceMs &&
      !hasLivePtys(s.sessionId),
  )

  return eligible
    .sort((a, b) => a.lastActivityAt - b.lastActivityAt)
    .slice(0, Math.min(overBudget, eligible.length))
}

export class SessionReaper {
  private timer: NodeJS.Timeout | null = null
  private activeSessionId: string | null = null
  private sweeping = false

  constructor(
    private readonly registry: SessionRegistry,
    private readonly fleet: FleetHub,
    private readonly deps: {
      prefs: () => SessionReaperPrefs
      hasLivePtys: (sessionId: string) => boolean
      now?: () => number
    },
  ) {}

  /** The renderer reports which session is on screen; that one is immune. */
  setActiveSession(sessionId: string | null): void {
    this.activeSessionId = sessionId
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS)
    // The reaper must never be the thing keeping the app alive.
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** One policy evaluation. Public for tests; the timer calls it. */
  async sweep(): Promise<void> {
    // Re-entrancy guard: disposal awaits process exit (up to a 3 s SIGKILL
    // escalation), and a slow batch must not overlap the next tick's view of
    // who is still alive.
    if (this.sweeping) return
    this.sweeping = true
    try {
      const targets = pickReapable({
        sessions: this.fleet.snapshot().sessions,
        prefs: this.deps.prefs(),
        activeSessionId: this.activeSessionId,
        hasLivePtys: this.deps.hasLivePtys,
        now: this.deps.now?.() ?? Date.now(),
      })
      for (const target of targets) {
        // The registry entry can have died between snapshot and now.
        if (!this.registry.get(target.sessionId)) continue
        log('pi', 'reaped idle session', {
          sessionId: target.sessionId,
          diskPath: target.diskPath,
          idleMs: Date.now() - target.lastActivityAt,
        })
        await this.registry.dispose(target.sessionId)
        // After dispose, so a renderer acting on the push cannot race a
        // still-dying process. Sent on the session's own channel: every
        // renderer that knows the session already listens there, and one that
        // does not (a pre-reload orphan) has nothing to clean up anyway.
        broadcast(sessionEventChannel(target.sessionId), {
          kind: 'reaped',
          diskPath: target.diskPath,
          workspacePath: target.workspacePath,
        })
      }
    } catch (error) {
      // A failed sweep must never take main down; the next tick retries.
      log('pi', 'reaper sweep failed', { message: (error as Error).message })
    } finally {
      this.sweeping = false
    }
  }
}
