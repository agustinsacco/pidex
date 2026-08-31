import { ORCHESTRATOR_NAME_PREFIX, type SessionMeta } from './models'

/**
 * Is this on-disk session an orchestrator's own thread?
 *
 * **The single choke point.** An orchestrator session lives in the project's
 * own cwd, so without this it is indistinguishable from work: it would sort
 * into the sidebar as an ordinary chat, inflate the home screen's session and
 * message counts, and quietly pad that project's usage rollup. Every consumer
 * asks here — see docs/orchestration.md, "Differentiation".
 *
 * Two independent signals, because either alone can go missing:
 *
 * - the **prefs pointer** (`orchestratorSessions`), authoritative while prefs
 *   survive, and
 * - the **name sentinel**, which rides in the session file itself and so
 *   survives a prefs reset or a session file copied to another machine.
 *
 * Lives in `shared/` because both the main process (scanner, usage rollup)
 * and the renderer (sidebar, home) need the same answer.
 */
export function isOrchestratorSession(
  meta: Pick<SessionMeta, 'path' | 'name'>,
  orchestratorSessionPaths: Iterable<string> = [],
): boolean {
  for (const path of orchestratorSessionPaths) {
    if (path === meta.path) return true
  }
  return Boolean(meta.name?.startsWith(ORCHESTRATOR_NAME_PREFIX))
}

/** Display name for a project's orchestrator thread. */
export function orchestratorSessionName(projectName: string): string {
  return `${ORCHESTRATOR_NAME_PREFIX} · ${projectName}`
}
