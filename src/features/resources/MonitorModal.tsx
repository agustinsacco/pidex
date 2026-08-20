import { ModalOverlay } from '@/components/Modal'
import { MonitorPanel, useResourceSubscription } from './MonitorPanel'
import { useMonitorUiStore } from './monitorUiStore'

/**
 * In-app resource monitor.
 *
 * Mounting is what starts sampling (see `useResourceSubscription`), so the
 * `ps` tick only runs while this or the floating window is open.
 */
export function MonitorModal(): React.JSX.Element | null {
  const open = useMonitorUiStore((s) => s.open)
  if (!open) return null
  return <MonitorModalBody />
}

function MonitorModalBody(): React.JSX.Element {
  useResourceSubscription()
  const floating = useMonitorUiStore((s) => s.floating)
  const onClose = (): void => useMonitorUiStore.getState().setOpen(false)

  return (
    <ModalOverlay onClose={onClose}>
      <div className="border-border bg-surface flex h-[70vh] w-[560px] max-w-[94vw] flex-col overflow-hidden rounded-xl border shadow-2xl">
        <div className="border-border flex shrink-0 items-center justify-between border-b px-5 py-3.5">
          <div>
            <div className="text-lg font-semibold">Resources</div>
            <div className="text-text-tertiary text-sm">
              Live CPU and memory per session, sampled every 2s
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => useMonitorUiStore.getState().toggleFloating()}
              data-testid="monitor-float-toggle"
              className="text-text-secondary hover:text-text hover:bg-bg-secondary rounded-md px-2 py-1 text-base transition-colors"
              title="Keep a small always-on-top window visible while you work"
            >
              {floating ? 'Close float' : 'Float'}
            </button>
            <button
              onClick={onClose}
              className="text-text-tertiary hover:text-text rounded-md px-2 py-1 text-base transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        <MonitorPanel />
      </div>
    </ModalOverlay>
  )
}

/** Body of the floating always-on-top window (its own BrowserWindow). */
export function MonitorWindowView(): React.JSX.Element {
  useResourceSubscription()
  return (
    <div className="bg-bg text-text flex h-screen flex-col overflow-hidden">
      <div className="titlebar-drag border-border flex h-9 shrink-0 items-center justify-center border-b">
        <span className="text-text-tertiary font-mono text-xs uppercase tracking-wider">
          Resources
        </span>
      </div>
      <MonitorPanel compact />
    </div>
  )
}
