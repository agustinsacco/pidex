import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import type { SessionMeta } from '@shared/models'
import { useSessionsStore } from '@/stores/sessions'
import { useActiveWorkspace, useWorkspacesStore } from '@/stores/workspaces'
import { useChatStore } from '@/stores/chat'
import { showContextMenu } from '@/components/ContextMenu'
import { relativeTimeShort as relativeTime } from '@/lib/time'

export { relativeTimeShort as relativeTime } from '@/lib/time'
import { PopupMenu, MenuRow } from '@/components/PopupMenu'
import { ChevronIcon, Spinner } from '@/components/icons'
import { TreeViewModal } from './TreeViewModal'
import { useSettingsUiStore } from '@/features/settings/SettingsModal'
import { useLayoutStore } from '@/stores/layout'
import { workspaceName } from '@/lib/path'

interface GroupedSessions {
  workspacePath: string
  name: string
  metas: SessionMeta[]
  liveCount: number
}

export function Sidebar({ workspacePath }: { workspacePath: string }): React.JSX.Element {
  const disk = useSessionsStore((s) => s.disk)
  const live = useSessionsStore((s) => s.live)
  const unread = useSessionsStore((s) => s.unread)
  const pinned = useSessionsStore((s) => s.pinned)
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  const recents = useWorkspacesStore((s) => s.recents)
  const [treeFor, setTreeFor] = useState<SessionMeta | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  /**
   * Every workspace worth listing: the known recents plus the active one and
   * any folder that currently has a live session (a session can outlive its
   * entry in recents).
   */
  const knownWorkspaces = useMemo(() => {
    const paths = new Set<string>([workspacePath])
    for (const entry of Object.values(live)) paths.add(entry.workspacePath)
    for (const ws of recents) paths.add(ws.path)
    return [...paths].filter(Boolean)
  }, [workspacePath, live, recents])

  // Scan and watch every known workspace, not just the active one.
  useEffect(() => {
    const store = useSessionsStore.getState()
    void store.refreshAllDisk(knownWorkspaces)
    void store.hydratePinned()
    store.watchWorkspaces(knownWorkspaces)

    const unsubscribe = window.pidex.onSessionsChanged((payload) => {
      // Re-scan only the workspace that actually changed.
      void useSessionsStore.getState().refreshDisk(payload.workspacePath)
    })
    return unsubscribe
  }, [knownWorkspaces])

  const liveByDisk = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of Object.values(live)) {
      if (entry.diskPath) map.set(entry.diskPath, entry.pidexId)
    }
    return map
  }, [live])

  const pinnedSet = useMemo(() => new Set(pinned), [pinned])

  /** Pinned sessions across every workspace — this group deliberately mixes. */
  const pinnedMetas = useMemo(
    () =>
      Object.values(disk)
        .flat()
        .filter((m) => pinnedSet.has(m.path))
        .sort((a, b) => b.mtimeMs - a.mtimeMs),
    [disk, pinnedSet],
  )

  /** Remaining sessions grouped by workspace, live projects first. */
  const groups = useMemo<GroupedSessions[]>(() => {
    return knownWorkspaces
      .map((path) => {
        const metas = (disk[path] ?? []).filter((m) => !pinnedSet.has(m.path))
        const liveCount = metas.filter((m) => liveByDisk.has(m.path)).length
        return {
          workspacePath: path,
          name: workspaceName(path),
          metas,
          liveCount,
        }
      })
      .filter((g) => g.metas.length > 0 || g.workspacePath === workspacePath)
      .sort((a, b) => {
        if (a.liveCount !== b.liveCount) return b.liveCount - a.liveCount
        if (a.workspacePath === workspacePath) return -1
        if (b.workspacePath === workspacePath) return 1
        return (b.metas[0]?.mtimeMs ?? 0) - (a.metas[0]?.mtimeMs ?? 0)
      })
  }, [knownWorkspaces, disk, pinnedSet, liveByDisk, workspacePath])

  const rowProps = (meta: SessionMeta) => ({
    meta,
    workspacePath: meta.cwd || workspacePath,
    livePidexId: liveByDisk.get(meta.path),
    active: liveByDisk.get(meta.path) === activeSessionId && activeSessionId !== null,
    unreadCount: unread[liveByDisk.get(meta.path) ?? ''] ?? 0,
    onOpenTree: () => setTreeFor(meta),
  })

  return (
    <aside className="border-border bg-bg-secondary/50 flex h-full w-64 shrink-0 flex-col border-r">
      <div className="titlebar-drag h-11 shrink-0" />
      <WorkspaceSwitcher />

      {/* Flat nav rows, matching the reference: icon + label, no border or
          shadow. New routes to the home screen; the folder is chosen there
          via the composer's workspace chip. */}
      <nav className="px-2 pb-2">
        <NavRow
          label="New"
          badge
          onClick={() => useSessionsStore.getState().activate(null)}
          icon={
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          }
        />
        <NavRow
          label="Artifacts"
          onClick={() => useLayoutStore.getState().toggleRightPane('artifacts')}
          icon={
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="3" width="18" height="14" rx="2" />
              <path d="M3 9h18M9 21h6" />
            </svg>
          }
        />
      </nav>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {pinnedMetas.length > 0 && (
          <>
            <SectionLabel>Pinned</SectionLabel>
            {pinnedMetas.map((meta) => (
              <SessionRow key={meta.path} {...rowProps(meta)} isPinned showWorkspace />
            ))}
          </>
        )}

        {groups.map((group) => {
          const isCollapsed = collapsed[group.workspacePath] ?? false
          return (
            <div key={group.workspacePath}>
              <button
                onClick={() => setCollapsed((c) => ({ ...c, [group.workspacePath]: !isCollapsed }))}
                data-testid="workspace-group"
                className="text-text-tertiary hover:text-text flex w-full items-center gap-1 px-2 pb-1 pt-3 text-left text-[10.5px] font-semibold uppercase tracking-wider transition-colors"
                title={group.workspacePath}
              >
                <ChevronIcon size={8} strokeWidth={3} expanded={!isCollapsed} />
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                {group.liveCount > 0 && (
                  <span
                    className="bg-success h-1.5 w-1.5 shrink-0 rounded-full"
                    title={`${group.liveCount} live`}
                  />
                )}
              </button>
              {!isCollapsed &&
                group.metas.map((meta) => (
                  <SessionRow key={meta.path} {...rowProps(meta)} isPinned={false} />
                ))}
              {!isCollapsed && group.metas.length === 0 && (
                <div className="text-text-tertiary px-2 py-2 text-[11.5px]">
                  Sessions you start will show up here
                </div>
              )}
            </div>
          )
        })}
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
          workspacePath={treeFor.cwd || workspacePath}
          onClose={() => setTreeFor(null)}
        />
      )}
    </aside>
  )
}

function WorkspaceSwitcher(): React.JSX.Element {
  const currentPath = useActiveWorkspace()
  const recents = useWorkspacesStore((s) => s.recents)
  const [open, setOpen] = useState(false)
  const name = currentPath ? workspaceName(currentPath) : 'Workspace'

  return (
    <div className="relative px-3 pb-2 pt-1">
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid="workspace-switcher"
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
              void useWorkspacesStore
                .getState()
                .pickAndOpen()
                .then((path) => {
                  // Leave the active session, or the derived workspace keeps
                  // returning that session's folder and the newly opened one
                  // never appears.
                  if (path) useSessionsStore.getState().activate(null)
                })
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
  showWorkspace = false,
  onOpenTree,
}: {
  meta: SessionMeta
  workspacePath: string
  livePidexId?: string
  active: boolean
  unreadCount: number
  isPinned: boolean
  /**
   * Show the workspace badge. Set for groups that mix projects (Pinned),
   * where the group header cannot tell you which app a thread belongs to.
   */
  showWorkspace?: boolean
  onOpenTree: () => void
}): React.JSX.Element {
  const isStreaming = useChatStore((s) =>
    livePidexId ? (s.sessions[livePidexId]?.isStreaming ?? false) : false,
  )
  const title = meta.name || meta.firstUserText || 'Untitled session'
  // Badge reads the session's own cwd, so a Pinned row shows the project it
  // actually belongs to rather than whatever is on screen.
  const rowWorkspaceName = workspaceName(meta.cwd || workspacePath)

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
      data-testid="session-row"
      data-workspace={rowWorkspaceName}
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
      {showWorkspace && rowWorkspaceName && (
        <span
          data-testid="session-workspace-badge"
          title={meta.cwd || workspacePath}
          className="bg-bg-secondary text-text-tertiary shrink-0 rounded px-1.5 py-px text-[9.5px] font-medium"
        >
          {rowWorkspaceName}
        </span>
      )}
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

/**
 * Flat sidebar nav row, matching the reference: a bordered circular icon
 * badge, then the label at full text weight. No row border or background at
 * rest — the badge is the only chrome, and hover tints the whole row.
 */
function NavRow({
  label,
  icon,
  badge = false,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  /** Draw the icon in a bordered circle (the reference does this for New only). */
  badge?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="text-text hover:bg-bg-secondary group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[14px] transition-colors"
    >
      <span
        className={clsx(
          'text-text-secondary group-hover:text-text flex h-[22px] w-[22px] shrink-0 items-center justify-center transition-colors',
          badge && 'border-border group-hover:border-border-strong rounded-full border',
        )}
      >
        {icon}
      </span>
      {label}
    </button>
  )
}
