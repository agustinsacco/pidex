import { useRef, useState } from 'react'
import clsx from 'clsx'
import { ORCHESTRATOR_MODES, ORCHESTRATOR_MODE_INFO } from '@shared/models'
import { PopupMenu, MenuRow } from '@/components/PopupMenu'
import { useFleetStore } from '@/stores/fleet'

/**
 * How much the orchestrator may do on its own, switchable from its banner.
 *
 * Modes used to be a single `autopilot` toggle buried in per-project settings,
 * baked into the system prompt when the session spawned — so changing it did
 * nothing to a running orchestrator, and nothing told you which posture the
 * thread was actually running under.
 *
 * It briefly sat in the composer next to the model picker, which framed it as
 * a per-message choice. It is not: it is per-project, persisted, and governs
 * what this thread may do to *other* sessions, so it belongs with the
 * orchestrator's own controls. Main enforces the mode per tool call, so a
 * switch binds on the very next action — no restart, no stale posture.
 */
export function OrchestratorModePicker({
  workspacePath,
}: {
  workspacePath: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  // PopupMenu contributes no positioning of its own and treats its trigger as
  // "outside" for dismissal, so a click-toggled caller must supply both.
  const triggerRef = useRef<HTMLButtonElement>(null)
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
        ref={triggerRef}
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
        {/* No icon: this sits inside the orchestrator's own banner, a few
            centimetres from the identical mark on its title. The label is the
            information here. */}
        <span>{info.label}</span>
      </button>
      {open && (
        <PopupMenu
          onClose={() => setOpen(false)}
          triggerRef={triggerRef}
          // `absolute` is load-bearing: PopupMenu positions nothing itself, so
          // without it the menu lays out in normal flow and shoves the banner
          // around instead of floating over the transcript. Opens downward —
          // the banner is at the top of the pane, so there is no room above.
          className="absolute right-0 top-full mt-1.5 w-72 py-1.5"
        >
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
