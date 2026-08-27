import clsx from 'clsx'
import { showContextMenu } from '@/components/ContextMenu'
import { MoreIcon, OrchestratorIcon } from '@/components/icons'
import { useChatStore } from '@/stores/chat'
import { useFleetStore } from '@/stores/fleet'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsUiStore } from '@/features/settings/settingsUiStore'
import { ChatView } from '@/features/chat/ChatView'
import { formatCost } from '@/lib/format'
import { workspaceName } from '@/lib/path'
import { OrchestratorModePicker } from './OrchestratorModePicker'
import { isPoisonedThreadError, modelRisksMalformedToolNames } from './threadHealth'

/**
 * The orchestrator's chat, wearing chrome that says what it is and lets you
 * drive it.
 *
 * An orchestration thread manages work; a session *is* work. The banner is the
 * difference: what it manages, how many sessions are in scope, what it has
 * cost, and the reminder that talking to it costs tokens while watching does
 * not.
 *
 * It also carries the controls. They previously existed only behind a
 * right-click on a 20px icon in the sidebar, which meant that when a thread
 * bricked itself the screen you were actually looking at offered nothing at
 * all — several identical fatal errors and no way out. Mode, sweeps, and the
 * recovery actions now live where the thread does.
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
  const sweeping = useFleetStore((s) => s.sweeping.includes(workspacePath))
  const cost = useChatStore((s) => s.sessions[sessionId]?.stats?.cost ?? 0)
  const error = useChatStore((s) => s.sessions[sessionId]?.error)
  // The id, not the object: both the denylist check and the warning text
  // want the thing the user recognises in the model picker.
  const modelId = useChatStore((s) => s.sessions[sessionId]?.meta?.model?.id ?? null)

  const inScope = sessions.filter(
    (s) =>
      !s.isOrchestrator && (s.projectRoot === workspacePath || s.workspacePath === workspacePath),
  )

  const openSettings = (): void => {
    useSettingsUiStore.getState().setTab('orchestration')
    useSettingsUiStore.getState().setOpen(true)
  }

  const reset = (): void => {
    void (async () => {
      const next = await useFleetStore.getState().reset(workspacePath)
      useSessionsStore.getState().activate(next)
    })()
  }

  const menu = (event: React.MouseEvent): void => {
    const fleet = useFleetStore.getState()
    showContextMenu(event, [
      {
        label: 'Review sessions',
        hint: 'spends tokens',
        disabled: sweeping,
        onClick: () => void fleet.sweep(workspacePath, 'review'),
      },
      { label: 'Rules and settings…', separatorAbove: true, onClick: openSettings },
      {
        // Picks up spawn-time changes (edited rules, a different model)
        // without losing the conversation.
        label: 'Restart process',
        hint: 'keeps the thread',
        onClick: () => void fleet.restart(workspacePath),
      },
      {
        label: 'Reset thread',
        hint: 'starts fresh',
        separatorAbove: true,
        danger: true,
        onClick: reset,
      },
    ])
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        data-testid="orchestrator-banner"
        className="border-accent/40 bg-accent-soft/40 flex shrink-0 items-center gap-2 border-b px-4 py-1.5"
      >
        <OrchestratorIcon size={13} className="text-accent shrink-0" />
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

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {cost > 0 && (
            <span
              className="text-text-tertiary font-mono text-xs tabular-nums"
              title="What this orchestration thread has cost"
            >
              {formatCost(cost)}
            </span>
          )}
          <OrchestratorModePicker workspacePath={workspacePath} />
          <button
            onClick={() => void useFleetStore.getState().sweep(workspacePath, 'brief')}
            disabled={sweeping}
            title="Ask for a briefing on this project's sessions. Spends tokens."
            className="text-text-secondary hover:text-text hover:bg-bg-secondary rounded-md px-1.5 py-0.5 text-xs transition-colors disabled:opacity-50"
          >
            {sweeping ? 'Briefing…' : 'Brief me'}
          </button>
          <button
            onClick={menu}
            data-testid="orchestrator-menu"
            aria-label="Orchestrator actions"
            title="More actions"
            className="text-text-tertiary hover:text-text hover:bg-bg-secondary flex h-5 w-5 items-center justify-center rounded-md transition-colors"
          >
            <MoreIcon size={14} />
          </button>
        </div>
      </div>

      {isPoisonedThreadError(error) && <StuckBar modelId={modelId} onReset={reset} />}

      <div className="min-h-0 flex-1">
        <ChatView sessionId={sessionId} workspacePath={workspacePath} />
      </div>
    </div>
  )
}

/**
 * Shown when the thread cannot take another turn no matter what is typed.
 *
 * Deliberately loud and deliberately specific. The failure looks like the app
 * being broken — the same error however you retry — so this names the actual
 * cause and puts the only fix one click away.
 */
function StuckBar({
  modelId,
  onReset,
}: {
  modelId: string | null
  onReset: () => void
}): React.JSX.Element {
  return (
    <div
      data-testid="orchestrator-stuck"
      className="border-danger/40 bg-danger/10 flex shrink-0 items-start gap-3 border-b px-4 py-2"
    >
      <div className="min-w-0 flex-1">
        <p className="text-danger text-sm font-medium">
          This thread can’t continue. Resetting is the only fix.
        </p>
        <p className="text-text-secondary mt-0.5 text-xs leading-snug">
          A malformed tool call is saved in the session file, so the provider rejects every turn
          before the model runs — retrying and starting a new message both hit the same error.
          Resetting starts a fresh thread; the old session file is kept on disk.
          {modelRisksMalformedToolNames(modelId) && (
            <>
              {' '}
              <span className="text-warning">
                {modelId} is known to cause this. Consider a different model for the orchestrator
                under Rules and settings.
              </span>
            </>
          )}
        </p>
      </div>
      <button
        onClick={onReset}
        className={clsx(
          'bg-danger shrink-0 rounded-md px-2.5 py-1 text-xs font-medium text-white',
          'transition-opacity hover:opacity-90',
        )}
      >
        Reset thread
      </button>
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
