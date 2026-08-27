import clsx from 'clsx'
import { showContextMenu } from '@/components/ContextMenu'
import { PiSpark } from '@/components/PiSpark'
import { OrchestratorIcon } from '@/components/icons'
import { useChatStore } from '@/stores/chat'
import { useFleetStore } from '@/stores/fleet'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsUiStore } from '@/features/settings/settingsUiStore'

/**
 * The orchestrator, as a fixed control in a workspace's header.
 *
 * It used to render as a row inside the group's session list, which put the
 * one thread that *manages* work in the same column as the threads that *are*
 * work — and only while the group was expanded. Here it sits beside the
 * workspace's other permanent controls (settings, new session), always
 * reachable, and never mistakable for a session.
 *
 * The badge is unread orchestrator messages, not digest items: "has it said
 * anything since you looked?" is the question a sidebar badge has to answer.
 * Attention items are a different question and live in the digest UI.
 */
export function OrchestratorHeaderButton({
  workspacePath,
  projectName,
}: {
  workspacePath: string
  projectName: string
}): React.JSX.Element {
  const liveId = useFleetStore((s) => s.liveOrchestrators[workspacePath])
  const enabled = useFleetStore((s) => s.prefs[workspacePath]?.enabled ?? false)
  const unread = useFleetStore((s) => s.unread[workspacePath] ?? 0)
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  const isStreaming = useChatStore((s) =>
    liveId ? (s.sessions[liveId]?.isStreaming ?? false) : false,
  )

  const active = Boolean(liveId) && liveId === activeSessionId

  const open = async (): Promise<void> => {
    const sessionId = await useFleetStore.getState().openOrchestrator(workspacePath)
    useSessionsStore.getState().activate(sessionId)
  }

  const menu = (event: React.MouseEvent): void => {
    const fleet = useFleetStore.getState()
    showContextMenu(event, [
      { label: 'Open', onClick: () => void open() },
      {
        label: 'Brief me',
        hint: 'spends tokens',
        disabled: fleet.sweeping.includes(workspacePath),
        onClick: () => void fleet.sweep(workspacePath, 'brief'),
      },
      {
        label: 'Review sessions',
        hint: 'spends tokens',
        disabled: fleet.sweeping.includes(workspacePath),
        onClick: () => void fleet.sweep(workspacePath, 'review'),
      },
      {
        label: 'Settings…',
        separatorAbove: true,
        onClick: () => {
          useSettingsUiStore.getState().setTab('orchestration')
          useSettingsUiStore.getState().setOpen(true)
        },
      },
      {
        // Picks up spawn-time changes (edited rules, a different model)
        // without losing the conversation.
        label: 'Restart process',
        hint: 'keeps the thread',
        disabled: !liveId,
        onClick: () => void useFleetStore.getState().restart(workspacePath),
      },
      {
        // The escape hatch. A thread can reach a state where it cannot take
        // another turn at all — a malformed tool call persisted into its
        // session file is replayed on every turn and rejected by the provider.
        label: 'Reset thread',
        hint: 'starts fresh',
        separatorAbove: true,
        danger: true,
        onClick: () => {
          void (async () => {
            const sessionId = await useFleetStore.getState().reset(workspacePath)
            useSessionsStore.getState().activate(sessionId)
          })()
        },
      },
    ])
  }

  const title = enabled
    ? `Orchestrator for ${projectName}${unread > 0 ? ` · ${unread} new` : ''} — right-click for options`
    : `Start an orchestrator for ${projectName}. It watches this project's sessions; it only spends tokens when you ask it to.`

  return (
    <button
      onClick={() => void open()}
      onContextMenu={menu}
      data-testid="orchestrator-header-button"
      data-workspace={projectName}
      aria-label={`Orchestrator for ${projectName}`}
      title={title}
      className={clsx(
        'relative flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors',
        active ? 'bg-bg-secondary text-accent' : 'hover:bg-bg-secondary',
        enabled ? 'text-accent' : 'text-text-tertiary hover:text-text',
      )}
    >
      {/*
        The spark is the "working" state and nothing else. Using ✳ for the
        idle state too made the orchestrator's identity and every session's
        busy indicator the same mark.
      */}
      {isStreaming ? <PiSpark size={12} /> : <OrchestratorIcon size={13} />}
      {unread > 0 && !active && (
        <span
          data-testid="orchestrator-unread"
          className="bg-accent absolute -right-0.5 -top-0.5 min-w-3 rounded-full px-0.5 text-center text-[9px] font-semibold leading-3 text-white"
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  )
}
