import { useFleetStore } from '@/stores/fleet'
import { ChatView } from '@/features/chat/ChatView'
import { workspaceName } from '@/lib/path'

/**
 * The orchestrator's chat, wearing chrome that says what it is.
 *
 * An orchestration thread manages work; a session *is* work. In the sidebar
 * they are already different shapes, but once opened both were an identical
 * `ChatView` — so the one place you might tell an agent to go stop another
 * agent looked exactly like the place you tell an agent to write code. The
 * banner is the whole difference: what it manages, how many sessions are in
 * scope, and the reminder that talking to it costs tokens while watching does
 * not.
 */
export function OrchestratorChat({
  sessionId,
  workspacePath,
}: {
  sessionId: string
  workspacePath: string
}): React.JSX.Element {
  const sessions = useFleetStore((s) => s.sessions)
  const digest = useFleetStore((s) => s.digests[workspacePath])
  const inScope = sessions.filter(
    (s) =>
      !s.isOrchestrator && (s.projectRoot === workspacePath || s.workspacePath === workspacePath),
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        data-testid="orchestrator-banner"
        className="border-accent/40 bg-accent-soft/40 flex shrink-0 items-center gap-2 border-b px-4 py-1.5"
      >
        <span className="text-accent shrink-0 text-sm leading-none">✳</span>
        <span className="text-text shrink-0 text-sm font-medium">
          Orchestrator · {workspaceName(workspacePath)}
        </span>
        <span className="text-text-tertiary shrink-0 text-xs">
          {inScope.length === 0
            ? 'no sessions running'
            : `watching ${inScope.length} session${inScope.length === 1 ? '' : 's'}`}
        </span>
        {digest && (
          <span className="text-text-tertiary min-w-0 truncate text-xs" title={digest.headline}>
            · {digest.headline}
          </span>
        )}
        <span className="text-text-tertiary ml-auto shrink-0 text-xs">
          manages sessions · does not write code
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <ChatView sessionId={sessionId} workspacePath={workspacePath} />
      </div>
    </div>
  )
}

/** Is this live session a project's orchestrator? */
export function useIsOrchestrator(sessionId: string | null): string | null {
  const liveOrchestrators = useFleetStore((s) => s.liveOrchestrators)
  if (!sessionId) return null
  const entry = Object.entries(liveOrchestrators).find(([, id]) => id === sessionId)
  return entry ? entry[0] : null
}
