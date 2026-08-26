import { useState } from 'react'
import clsx from 'clsx'
import { ORCHESTRATOR_MODES, ORCHESTRATOR_MODE_INFO } from '@shared/models'
import { PopupMenu, MenuRow } from '@/components/PopupMenu'
import { useFleetStore } from '@/stores/fleet'

/**
 * How much the orchestrator may do on its own, switchable from its composer.
 *
 * Modes used to be a single `autopilot` toggle buried in per-project settings,
 * baked into the system prompt when the session spawned — so changing it did
 * nothing to a running orchestrator, and nothing told you which posture the
 * thread was actually running under.
 *
 * This sits next to the model picker because it is the same kind of decision:
 * what this thread is allowed to do, changed in the place you are talking to
 * it. Main enforces the mode per tool call, so a switch binds on the
 * orchestrator's very next action — no restart, no stale posture.
 */
export function OrchestratorModePicker({
  workspacePath,
}: {
  workspacePath: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const mode = useFleetStore((s) => {
    const prefs = s.prefs[workspacePath]
    if (prefs?.mode) return prefs.mode
    // Migrate the pre-modes boolean for a project whose prefs predate it.
    return (prefs as { autopilot?: boolean } | undefined)?.autopilot === true
      ? 'autopilot'
      : 'supervise'
  })
  const info = ORCHESTRATOR_MODE_INFO[mode]

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        data-testid="orchestrator-mode-picker"
        title={`Orchestrator mode — ${info.summary}`}
        aria-label={`Orchestrator mode: ${info.label}`}
        className={clsx(
          'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm transition-colors',
          mode === 'autopilot'
            ? 'text-warning hover:bg-bg-secondary'
            : 'text-text-tertiary hover:text-text hover:bg-bg-secondary',
        )}
      >
        <span className="text-xs leading-none">✳</span>
        <span>{info.label}</span>
      </button>
      {open && (
        <PopupMenu onClose={() => setOpen(false)} className="bottom-full right-0 mb-1 w-64">
          {ORCHESTRATOR_MODES.map((option) => (
            <MenuRow
              key={option}
              active={option === mode}
              onClick={() => {
                void useFleetStore.getState().setMode(workspacePath, option)
                setOpen(false)
              }}
            >
              <span className="flex flex-col items-start">
                <span>{ORCHESTRATOR_MODE_INFO[option].label}</span>
                <span className="text-text-tertiary text-xs">
                  {ORCHESTRATOR_MODE_INFO[option].summary}
                </span>
              </span>
            </MenuRow>
          ))}
        </PopupMenu>
      )}
    </div>
  )
}
