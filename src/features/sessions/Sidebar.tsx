import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import type { SessionMeta } from '@shared/models'
import { useSessionsStore } from '@/stores/sessions'
import { useWorkspacesStore } from '@/stores/workspaces'
import { useChatStore } from '@/stores/chat'
import { showContextMenu } from '@/components/ContextMenu'
import { relativeTimeShort as relativeTime } from '@/lib/time'

export { relativeTimeShort as relativeTime } from '@/lib/time'
import { PopupMenu, MenuRow } from '@/components/PopupMenu'
import { Spinner } from '@/features/chat/tools/ToolCard'
import { TreeViewModal } from './TreeViewModal'
import { useSettingsUiStore } from '@/features/settings/SettingsModal'

export function Sidebar({ workspacePath }: { workspacePath: string }): React.JSX.Element {
  const disk = useSessionsStore((s) => s.disk[workspacePath]) ?? []
  const live = useSessionsStore((s) => s.live)
  const unread = useSessionsStore((s) => s.unread)
  const pinned = useSessionsStore((s) => s.pinned)
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  const [treeFor, setTreeFor] = useState<SessionMeta | null>(null)

  // Initial scan + live chokidar updates.
  useEffect(() => {
    const store = useSessionsStore.getState()
    void store.refreshDisk(workspacePath)
    void store.hydratePinned()
    void window.pidex.invoke('sessions:watch', workspacePath)
    const unsubscribe = window.pidex.onSessionsChanged((payload) => {
      if (payload.workspacePath === workspacePath) {
        void useSessionsStore.getState().refreshDisk(workspacePath)
      }
    })
    return unsubscribe
  }, [workspacePath])

  const liveByDisk = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of Object.values(live)) {
      if (entry.diskPath) map.set(entry.diskPath, entry.pidexId)
    }
    return map
  }, [live])

  const { pinnedMetas, recentMetas } = useMemo(() => {
    const pinnedSet = new Set(pinned)
    return {
      pinnedMetas: disk.filter((m) => pinnedSet.has(m.path)),
      recentMetas: disk.filter((m) => !pinnedSet.has(m.path)),
    }
  }, [disk, pinned])

  return (
    <aside className="border-border bg-bg-secondary/50 flex h-full w-64 shrink-0 flex-col border-r">
      <div className="titlebar-drag h-11 shrink-0" />
      <WorkspaceSwitcher />

      <div className="px-3 pb-2">
        <button
          onClick={() => useSessionsStore.getState().activate(null)}
          className="border-border bg-surface hover:border-border-strong text-text flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium shadow-sm transition-colors"
        >
          <span className="text-accent text-base leading-none">+</span> New session
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {pinnedMetas.length > 0 && (
          <>
            <SectionLabel>Pinned</SectionLabel>
            {pinnedMetas.map((meta) => (
              <SessionRow
                key={meta.path}
                meta={meta}
                workspacePath={workspacePath}
                livePidexId={liveByDisk.get(meta.path)}
                active={liveByDisk.get(meta.path) === activeSessionId && activeSessionId !== null}
                unreadCount={unread[liveByDisk.get(meta.path) ?? ''] ?? 0}
                isPinned
                onOpenTree={() => setTreeFor(meta)}
              />
            ))}
          </>
        )}
        <SectionLabel>Recent</SectionLabel>
        {recentMetas.length === 0 && (
          <div className="text-text-tertiary px-2 py-3 text-center text-[12px]">
            Sessions you start will show up here
          </div>
        )}
        {recentMetas.map((meta) => (
          <SessionRow
            key={meta.path}
            meta={meta}
            workspacePath={workspacePath}
            livePidexId={liveByDisk.get(meta.path)}
            active={liveByDisk.get(meta.path) === activeSessionId && activeSessionId !== null}
            unreadCount={unread[liveByDisk.get(meta.path) ?? ''] ?? 0}
            isPinned={false}
            onOpenTree={() => setTreeFor(meta)}
          />
        ))}
      </div>

      <div className="border-border border-t px-3 py-2.5">
        <button
          onClick={() => useSettingsUiStore.getState().setOpen(true)}
          className="text-text-secondary hover:text-text hover:bg-bg-secondary -mx-1 flex w-[calc(100%+8px)] items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] transition-colors"
          title="Settings (⌘,)"
        >
          <GearIcon /> Settings
        </button>
      </div>

      {treeFor && (
        <TreeViewModal
          meta={treeFor}
          workspacePath={workspacePath}
          onClose={() => setTreeFor(null)}
        />
      )}
    </aside>
  )
}

function WorkspaceSwitcher(): React.JSX.Element {
  const currentPath = useWorkspacesStore((s) => s.currentPath)
  const recents = useWorkspacesStore((s) => s.recents)
  const [open, setOpen] = useState(false)
  const name = currentPath?.split(/[/\\]/).filter(Boolean).pop() ?? 'Workspace'

  return (
    <div className="relative px-3 pb-2 pt-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="hover:bg-bg-secondary flex w-full items-center gap-2 rounded-lg px-2 py-1.5 transition-colors"
      >
        <span className="bg-accent-soft text-accent flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[12px] font-bold uppercase">
          {name.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold">{name}</span>
        <ChevronDown />
      </button>

      {open && (
        <PopupMenu
          onClose={() => setOpen(false)}
          className="absolute left-3 right-3 top-full z-40 mt-1 py-1.5"
        >
          <div className="text-text-tertiary px-3 pb-1 pt-1 text-[10.5px] font-medium uppercase tracking-wide">
            Workspaces
          </div>
          {recents.map((ws) => (
            <MenuRow
              key={ws.path}
              active={false}
              onClick={() => {
                setOpen(false)
                useWorkspacesStore.getState().openWorkspace(ws.path)
                useSessionsStore.getState().activate(null)
              }}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{ws.name}</span>
                <span className="text-text-tertiary block truncate text-[11px]">{ws.path}</span>
              </span>
              {ws.path === currentPath && <span className="bg-accent h-1.5 w-1.5 rounded-full" />}
            </MenuRow>
          ))}
          <div className="border-border my-1 border-t" />
          <MenuRow
            active={false}
            onClick={() => {
              setOpen(false)
              void useWorkspacesStore.getState().pickAndOpen()
            }}
          >
            <span className="text-[13px]">Open Folder…</span>
          </MenuRow>
        </PopupMenu>
      )}
    </div>
  )
}

function SessionRow({
  meta,
  workspacePath,
  livePidexId,
  active,
  unreadCount,
  isPinned,
  onOpenTree,
}: {
  meta: SessionMeta
  workspacePath: string
  livePidexId?: string
  active: boolean
  unreadCount: number
  isPinned: boolean
  onOpenTree: () => void
}): React.JSX.Element {
  const isStreaming = useChatStore((s) =>
    livePidexId ? (s.sessions[livePidexId]?.isStreaming ?? false) : false,
  )
  const title = meta.name || meta.firstUserText || 'Untitled session'

  const open = (): void => {
    void useSessionsStore.getState().openDiskSession(workspacePath, meta)
  }

  const contextMenu = (event: React.MouseEvent): void => {
    const store = useSessionsStore.getState()
    showContextMenu(event, [
      { label: 'Open', onClick: open },
      { label: 'Session tree…', onClick: onOpenTree },
      {
        label: isPinned ? 'Unpin' : 'Pin',
        onClick: () => store.togglePin(meta.path),
      },
      {
        label: 'Rename…',
        separatorAbove: true,
        onClick: () => void renameSession(workspacePath, meta, livePidexId),
      },
      {
        label: 'Fork (new branch session)',
        onClick: () => void store.createSession(workspacePath, { forkFrom: meta.path }),
      },
      {
        label: 'Clone',
        onClick: () => void cloneSession(workspacePath, meta, livePidexId),
      },
      {
        label: 'Export HTML…',
        onClick: () => void exportSession(workspacePath, meta, livePidexId),
      },
      {
        label: 'Delete (move to trash)',
        danger: true,
        separatorAbove: true,
        onClick: () => void store.deleteDiskSession(workspacePath, meta),
      },
    ])
  }

  return (
    <button
      onClick={open}
      onContextMenu={contextMenu}
      className={clsx(
        'group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
        active ? 'bg-bg-secondary' : 'hover:bg-bg-secondary/70',
      )}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {isStreaming ? (
          <Spinner />
        ) : livePidexId ? (
          <span className="bg-success h-2 w-2 rounded-full" title="Live session" />
        ) : (
          <span className="border-border-strong h-2 w-2 rounded-full border" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-text block truncate text-[12.5px]">{title}</span>
        <span className="text-text-tertiary block truncate text-[10.5px]">
          {relativeTime(meta.mtimeMs)}
          {meta.branchCount > 0 && ` · ${meta.branchCount + 1} branches`}
        </span>
      </span>
      {unreadCount > 0 && !active && (
        <span className="bg-accent text-accent-text flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9.5px] font-bold">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
      {isPinned && <PinIcon />}
    </button>
  )
}

async function renameSession(
  workspacePath: string,
  meta: SessionMeta,
  livePidexId?: string,
): Promise<void> {
  const name = window.prompt('Session name', meta.name ?? '')
  if (!name) return
  const store = useSessionsStore.getState()
  const pidexId = livePidexId ?? (await store.openDiskSession(workspacePath, meta))
  const response = await window.pidex.piCommand(pidexId, { type: 'set_session_name', name })
  if (response.success) {
    useChatStore.getState().patchMeta(pidexId, { sessionName: name })
    void store.refreshDisk(workspacePath)
  }
}

async function cloneSession(
  workspacePath: string,
  meta: SessionMeta,
  livePidexId?: string,
): Promise<void> {
  if (livePidexId) {
    const response = await window.pidex.piCommand(livePidexId, { type: 'clone' })
    if (response.success && response.data?.cancelled) {
      useChatStore.getState().setError(livePidexId, 'Clone was cancelled by an extension.')
      return
    }
    void useSessionsStore.getState().refreshDisk(workspacePath)
  } else {
    await useSessionsStore.getState().createSession(workspacePath, { forkFrom: meta.path })
  }
}

async function exportSession(
  workspacePath: string,
  meta: SessionMeta,
  livePidexId?: string,
): Promise<void> {
  const outputPath = await window.pidex.invoke('app:saveDialog', {
    title: 'Export session as HTML',
    defaultPath: `${meta.name ?? 'session'}.html`,
    filters: [{ name: 'HTML', extensions: ['html'] }],
  })
  if (!outputPath) return
  const store = useSessionsStore.getState()
  const pidexId = livePidexId ?? (await store.openDiskSession(workspacePath, meta))
  const response = await window.pidex.piCommand(pidexId, { type: 'export_html', outputPath })
  if (response.success && response.data) {
    await window.pidex.invoke('app:revealPath', response.data.path)
  }
}

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="text-text-tertiary px-2 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wider">
      {children}
    </div>
  )
}

function ChevronDown(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      className="text-text-tertiary shrink-0"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function PinIcon(): React.JSX.Element {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="text-text-tertiary shrink-0"
    >
      <path d="M16 3a1 1 0 0 1 .97 1.24l-1.09 4.34 3.83 3.83a1 1 0 0 1-.7 1.71H13.5v6.38a1 1 0 0 1-2 0v-6.38H6a1 1 0 0 1-.71-1.71l3.83-3.83L8.03 4.24A1 1 0 0 1 9 3h7z" />
    </svg>
  )
}

function GearIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}
