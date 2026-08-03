import { useState } from 'react'
import { useChatStore } from '@/stores/chat'
import { PopupMenu, MenuRow } from '@/components/PopupMenu'
import type { QueueMode } from '@shared/rpc'

/**
 * Auto-retry state isn't reported by get_state, so pidex tracks the last
 * value it set per session (pi defaults to enabled).
 */
const autoRetryLocal = new Map<string, boolean>()

/** Kebab menu in the session header: compaction, retry, queue modes, export. */
export function SessionMenu({ sessionId }: { sessionId: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [autoRetry, setAutoRetryState] = useState(autoRetryLocal.get(sessionId) ?? true)
  const meta = useChatStore((s) => s.sessions[sessionId]?.meta)

  const toggleAutoRetry = (): Promise<unknown> =>
    window.pidex
      .piCommand(sessionId, { type: 'set_auto_retry', enabled: !autoRetry })
      .then((r) => {
        if (r.success) {
          autoRetryLocal.set(sessionId, !autoRetry)
          setAutoRetryState(!autoRetry)
        }
      })

  const command = async (run: () => Promise<unknown>): Promise<void> => {
    setOpen(false)
    await run()
  }

  const toggleAutoCompaction = (): Promise<unknown> =>
    window.pidex
      .piCommand(sessionId, {
        type: 'set_auto_compaction',
        enabled: !(meta?.autoCompactionEnabled ?? true),
      })
      .then((r) => {
        if (r.success)
          useChatStore
            .getState()
            .patchMeta(sessionId, { autoCompactionEnabled: !(meta?.autoCompactionEnabled ?? true) })
      })

  const setSteeringMode = (mode: QueueMode): Promise<unknown> =>
    window.pidex.piCommand(sessionId, { type: 'set_steering_mode', mode }).then((r) => {
      if (r.success) useChatStore.getState().patchMeta(sessionId, { steeringMode: mode })
    })

  const setFollowUpMode = (mode: QueueMode): Promise<unknown> =>
    window.pidex.piCommand(sessionId, { type: 'set_follow_up_mode', mode }).then((r) => {
      if (r.success) useChatStore.getState().patchMeta(sessionId, { followUpMode: mode })
    })

  const compactNow = async (): Promise<void> => {
    const instructions = window.prompt(
      'Optional: custom instructions for the compaction summary (leave blank for default)',
    )
    if (instructions === null) return
    const response = await window.pidex.piCommand(sessionId, {
      type: 'compact',
      ...(instructions ? { customInstructions: instructions } : {}),
    })
    if (!response.success) useChatStore.getState().setError(sessionId, response.error)
  }

  const exportHtml = async (): Promise<void> => {
    const outputPath = await window.pidex.invoke('app:saveDialog', {
      title: 'Export session as HTML',
      defaultPath: `${meta?.sessionName ?? 'session'}.html`,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    })
    if (!outputPath) return
    const response = await window.pidex.piCommand(sessionId, { type: 'export_html', outputPath })
    if (response.success && response.data) {
      await window.pidex.invoke('app:revealPath', response.data.path)
    }
  }

  const rename = async (): Promise<void> => {
    const name = window.prompt('Session name', meta?.sessionName ?? '')
    if (!name) return
    const response = await window.pidex.piCommand(sessionId, { type: 'set_session_name', name })
    if (response.success) useChatStore.getState().patchMeta(sessionId, { sessionName: name })
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-text-tertiary hover:text-text hover:bg-bg-secondary flex h-7 w-7 items-center justify-center rounded-md transition-colors"
        title="Session options"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>

      {open && (
        <PopupMenu onClose={() => setOpen(false)} className="absolute right-0 top-full mt-1.5 w-72 py-1.5">
          <MenuRow active={false} onClick={() => void command(rename)}>
            <span className="flex-1">Rename session…</span>
          </MenuRow>
          <MenuRow active={false} onClick={() => void command(exportHtml)}>
            <span className="flex-1">Export as HTML…</span>
          </MenuRow>
          <Separator />
          <MenuRow active={false} onClick={() => void command(compactNow)}>
            <span className="flex-1">Compact context now…</span>
          </MenuRow>
          <MenuRow active={false} onClick={() => void command(toggleAutoCompaction)}>
            <span className="flex-1">Auto-compaction</span>
            <ToggleDot on={meta?.autoCompactionEnabled ?? true} />
          </MenuRow>
          <MenuRow active={false} onClick={() => void command(toggleAutoRetry)}>
            <span className="flex-1">Auto-retry on transient errors</span>
            <ToggleDot on={autoRetry} />
          </MenuRow>
          <Separator />
          <div className="text-text-tertiary px-3 pb-0.5 pt-1.5 text-[10.5px] font-medium uppercase tracking-wide">
            Steering delivery
          </div>
          <MenuRow active={false} onClick={() => void command(() => setSteeringMode('all'))}>
            <span className="flex-1">All at once</span>
            {meta?.steeringMode === 'all' && <Dot />}
          </MenuRow>
          <MenuRow active={false} onClick={() => void command(() => setSteeringMode('one-at-a-time'))}>
            <span className="flex-1">One at a time</span>
            {meta?.steeringMode === 'one-at-a-time' && <Dot />}
          </MenuRow>
          <div className="text-text-tertiary px-3 pb-0.5 pt-1.5 text-[10.5px] font-medium uppercase tracking-wide">
            Follow-up delivery
          </div>
          <MenuRow active={false} onClick={() => void command(() => setFollowUpMode('all'))}>
            <span className="flex-1">All at once</span>
            {meta?.followUpMode === 'all' && <Dot />}
          </MenuRow>
          <MenuRow active={false} onClick={() => void command(() => setFollowUpMode('one-at-a-time'))}>
            <span className="flex-1">One at a time</span>
            {meta?.followUpMode === 'one-at-a-time' && <Dot />}
          </MenuRow>
        </PopupMenu>
      )}
    </div>
  )
}

function Separator(): React.JSX.Element {
  return <div className="border-border my-1 border-t" />
}

function Dot(): React.JSX.Element {
  return <span className="bg-accent h-1.5 w-1.5 rounded-full" />
}

function ToggleDot({ on }: { on: boolean }): React.JSX.Element {
  return (
    <span
      className={`relative h-4 w-7 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-border-strong'}`}
    >
      <span
        className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${on ? 'left-3.5' : 'left-0.5'}`}
      />
    </span>
  )
}
