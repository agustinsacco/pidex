import clsx from 'clsx'
import { useFleetStore } from '@/stores/fleet'
import { useSessionsStore } from '@/stores/sessions'
import { useChatStore } from '@/stores/chat'
import { PiSpark } from '@/components/PiSpark'

/**
 * The orchestrator's row in a sidebar group.
 *
 * Deliberately NOT a `SessionRow`. An orchestration thread manages work; a
 * session *is* work, and the two must never be mistaken for each other. So it
 * renders above the group's session list, in its own shape: a spark instead of
 * a status dot, the fixed label "Orchestrator", no branch subtitle (it always
 * runs on the main repo), and an attention count from its digest.
 */
export function OrchestratorRow({
  workspacePath,
  projectName,
}: {
  workspacePath: string
  projectName: string
}): React.JSX.Element {
  const liveId = useFleetStore((s) => s.liveOrchestrators[workspacePath])
  const digest = useFleetStore((s) => s.digests[workspacePath])
  const enabled = useFleetStore((s) => s.prefs[workspacePath]?.enabled ?? false)
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  const isStreaming = useChatStore((s) =>
    liveId ? (s.sessions[liveId]?.isStreaming ?? false) : false,
  )

  const active = Boolean(liveId) && liveId === activeSessionId
  const attention = digest?.items.filter((item) => item.kind === 'attention').length ?? 0

  const open = async (): Promise<void> => {
    const sessionId = await useFleetStore.getState().openOrchestrator(workspacePath)
    useSessionsStore.getState().activate(sessionId)
  }

  return (
    <button
      onClick={() => void open()}
      data-testid="orchestrator-row"
      data-workspace={projectName}
      title={
        enabled
          ? `Orchestrator for ${projectName}`
          : `Start an orchestrator for ${projectName}. It watches this project's sessions; it only spends tokens when you ask it to.`
      }
      className={clsx(
        'group flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left transition-colors',
        active ? 'bg-bg-secondary' : 'hover:bg-bg-secondary/70',
      )}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {isStreaming ? (
          <PiSpark size={13} />
        ) : (
          <span
            className={clsx('text-sm leading-none', enabled ? 'text-accent' : 'text-text-tertiary')}
          >
            ✳
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={clsx(
            'block truncate text-base leading-4',
            enabled ? 'text-text' : 'text-text-tertiary',
          )}
        >
          Orchestrator
        </span>
        {digest && (
          <span className="text-text-tertiary block truncate text-xs leading-3.5">
            {digest.headline}
          </span>
        )}
      </span>
      {attention > 0 && (
        <span
          className="bg-warning/20 text-warning shrink-0 rounded px-1.5 py-px text-2xs font-medium"
          title={`${attention} item(s) need you`}
        >
          {attention}
        </span>
      )}
    </button>
  )
}
