import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { GitInfo, SessionMeta, WorktreeInfo } from '@shared/models'
import { useSessionsStore } from '@/stores/sessions'
import { useActiveWorkspace, useWorkspacesStore } from '@/stores/workspaces'
import { useChatStore } from '@/stores/chat'
import { showContextMenu } from '@/components/ContextMenu'
import { isUnseen } from './unseen'
import { sessionSubtitle } from './sessionSubtitle'

export { relativeTimeShort as relativeTime } from '@/lib/time'
import { PopupMenu, MenuRow } from '@/components/PopupMenu'
import { ChevronIcon } from '@/components/icons'
import { PiSpark } from '@/components/PiSpark'
import { TreeViewModal } from './TreeViewModal'
import { useSettingsUiStore } from '@/features/settings/settingsUiStore'
import { useUsageUiStore } from '@/features/usage/usageUiStore'
import { useMonitorUiStore } from '@/features/resources/monitorUiStore'
import { UpdatePill } from '@/features/updates/UpdatePill'
import { useLayoutStore } from '@/stores/layout'
import { worktreeAwareName } from '@/lib/path'
import { sessionTitle } from '@/lib/sessionTitle'
import { cloneSession, exportSidebarSession, renameSidebarSession } from './sidebarActions'
import { RemoveWorktreeModal } from '@/features/worktrees/RemoveWorktreeModal'
import { MergeWorktreeModal } from '@/features/worktrees/MergeWorktreeModal'

interface GroupedSessions {
  workspacePath: string
  name: string
  metas: SessionMeta[]
  liveCount: number
  /** False until this workspace's session dir has been scanned. */
  scanned: boolean
}

export function Sidebar({ workspacePath }: { workspacePath: string }): React.JSX.Element {
  const disk = useSessionsStore((s) => s.disk)
  const live = useSessionsStore((s) => s.live)
  const unread = useSessionsStore((s) => s.unread)
  const pinned = useSessionsStore((s) => s.pinned)
  const seenSessions = useSessionsStore((s) => s.seenSessions)
  const gitByCwd = useSessionsStore((s) => s.gitByCwd)
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  const recents = useWorkspacesStore((s) => s.recents)
  const [treeFor, setTreeFor] = useState<SessionMeta | null>(null)
  const [worktreeModal, setWorktreeModal] = useState<{
    kind: 'remove' | 'merge'
    repoPath: string
    worktree: WorktreeInfo
  } | null>(null)
  /** Explicit collapse choices (prefs + this run); null until prefs load. */
  const [collapsed, setCollapsed] = useState<Record<string, boolean> | null>(null)

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

  // Scan every known workspace (capped; collapsed groups lazy-load on expand).
  useEffect(() => {
    const store = useSessionsStore.getState()
    void store.refreshAllDisk(knownWorkspaces)
    void store.hydratePinned()

    const unsubscribe = window.pidex.onSessionsChanged((payload) => {
      // Re-scan only the workspace that actually changed.
      void useSessionsStore.getState().refreshDisk(payload.workspacePath)
    })
    return unsubscribe
  }, [knownWorkspaces])

  useEffect(() => {
    void window.pidex.invoke('app:getPrefs').then((prefs) => {
      setCollapsed(Object.fromEntries(prefs.collapsedWorkspaces.map((p) => [p, true])))
    })
  }, [])

  // Git summaries for row subtitles: refresh (debounced) whenever the disk
  // listing changes, and again on window focus (branch switches happen in
  // terminals pidex can't observe).
  useEffect(() => {
    const cwds = Object.values(disk)
      .flat()
      .map((m) => m.cwd)
      .concat(knownWorkspaces)
    const timer = setTimeout(() => {
      void useSessionsStore.getState().refreshGitInfo(cwds)
    }, 300)
    const onFocus = (): void => void useSessionsStore.getState().refreshGitInfo(cwds)
    window.addEventListener('focus', onFocus)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [disk, knownWorkspaces])

  const liveByDisk = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of Object.values(live)) {
      if (entry.diskPath) map.set(entry.diskPath, entry.pidexId)
    }
    return map
  }, [live])

  /**
   * Live sessions with no session file yet, grouped by workspace.
   *
   * A freshly created session is spawned and prompted immediately, but its
   * `.jsonl` only appears once pi writes the header — and the watcher adds
   * `awaitWriteFinish` plus a debounce on top of that. Sidebar rows come from
   * `disk`, so without these placeholders a session you just started shows no
   * row at all until roughly its first tool call, which reads as a dropped
   * message. They drop out on their own once `diskPath` is known.
   */
  const pendingByWorkspace = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const entry of Object.values(live)) {
      if (entry.diskPath) continue
      const list = map.get(entry.workspacePath)
      if (list) list.push(entry.pidexId)
      else map.set(entry.workspacePath, [entry.pidexId])
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
    return (
      knownWorkspaces
        .map((path) => {
          const metas = (disk[path] ?? []).filter((m) => !pinnedSet.has(m.path))
          const liveCount = metas.filter((m) => liveByDisk.has(m.path)).length
          return {
            workspacePath: path,
            name: worktreeAwareName(path, gitByCwd[path]),
            metas,
            liveCount,
            scanned: path in disk,
          }
        })
        // Unscanned workspaces (beyond the boot-scan cap) still get a header —
        // hiding them would make their sessions unreachable until restart.
        .filter((g) => g.metas.length > 0 || !g.scanned || g.workspacePath === workspacePath)
        .sort((a, b) => {
          if (a.liveCount !== b.liveCount) return b.liveCount - a.liveCount
          if (a.workspacePath === workspacePath) return -1
          if (b.workspacePath === workspacePath) return 1
          return (b.metas[0]?.mtimeMs ?? 0) - (a.metas[0]?.mtimeMs ?? 0)
        })
    )
  }, [knownWorkspaces, disk, pinnedSet, liveByDisk, workspacePath, gitByCwd])

  /**
   * Collapse resolution: an explicit choice wins; otherwise scanned groups
   * are open and unscanned ones start closed. That default IS the lazy-load
   * path — workspaces beyond the boot-scan cap sit collapsed until expanded,
   * which is when their first scan happens. The active workspace is always
   * open by default, even before its scan lands.
   */
  const isGroupCollapsed = (group: GroupedSessions): boolean =>
    collapsed?.[group.workspacePath] ??
    (group.scanned ? false : group.workspacePath !== workspacePath)

  const toggleGroup = (group: GroupedSessions, wasCollapsed: boolean): void => {
    const next = { ...(collapsed ?? {}), [group.workspacePath]: !wasCollapsed }
    setCollapsed(next)
    void window.pidex.invoke(
      'app:setCollapsedWorkspaces',
      Object.keys(next).filter((p) => next[p]),
    )
    // Expanding catches up on anything missed while the group was unwatched.
    if (wasCollapsed) void useSessionsStore.getState().refreshDisk(group.workspacePath)
  }

  // Watch exactly the visible groups: expanded ⇒ watching, collapsed ⇒ not.
  // Idempotent both ways, so re-running on scan results is fine. Gated on
  // prefs hydration to avoid a watch-then-unwatch churn at mount.
  useEffect(() => {
    if (collapsed === null) return
    const store = useSessionsStore.getState()
    const expanded = groups.filter((g) => !isGroupCollapsed(g)).map((g) => g.workspacePath)
    const closed = groups.filter((g) => isGroupCollapsed(g)).map((g) => g.workspacePath)
    store.watchWorkspaces(expanded)
    store.unwatchWorkspaces(closed)
  }, [groups, collapsed])

  const groupContextMenu = (event: React.MouseEvent, group: GroupedSessions): void => {
    const git = gitByCwd[group.workspacePath]
    const openWorktreeModal = async (kind: 'remove' | 'merge'): Promise<void> => {
      const repoPath = git?.mainRepoPath
      if (!repoPath) return
      const worktrees = await window.pidex.invoke('git:listWorktrees', repoPath)
      const worktree = worktrees.find(
        (w) => w.path === group.workspacePath || w.realPath === group.workspacePath,
      )
      if (worktree) setWorktreeModal({ kind, repoPath, worktree })
    }
    showContextMenu(event, [
      {
        label: 'New session here',
        onClick: () => {
          useWorkspacesStore.getState().openWorkspace(group.workspacePath)
          useSessionsStore.getState().activate(null)
        },
      },
      ...(git?.isWorktree && git.mainRepoPath
        ? [
            {
              label: 'Merge into main repo…',
              separatorAbove: true,
              onClick: () => void openWorktreeModal('merge'),
            },
            {
              label: 'Remove worktree…',
              danger: true,
              onClick: () => void openWorktreeModal('remove'),
            },
          ]
        : []),
    ])
  }

  const rowProps = (meta: SessionMeta) => {
    const livePidexId = liveByDisk.get(meta.path)
    const active = livePidexId === activeSessionId && activeSessionId !== null
    return {
      meta,
      workspacePath: meta.cwd || workspacePath,
      livePidexId,
      active,
      unseen:
        !active &&
        ((unread[livePidexId ?? ''] ?? 0) > 0 ||
          isUnseen(seenSessions, meta.path, meta.lastActivityAt)),
      git: gitByCwd[meta.cwd || workspacePath],
      onOpenTree: () => setTreeFor(meta),
    }
  }

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
        <NavRow
          label="Usage"
          onClick={() => useUsageUiStore.getState().setOpen(true)}
          icon={
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M3 20h18M7 20V10M12 20V4M17 20v-8" />
            </svg>
          }
        />
        <NavRow
          label="Resources"
          onClick={() => useMonitorUiStore.getState().setOpen(true)}
          icon={
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 12h4l2 6 4-14 2 8h6" />
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
          const isCollapsed = isGroupCollapsed(group)
          return (
            <div key={group.workspacePath}>
              <button
                onClick={() => toggleGroup(group, isCollapsed)}
                onContextMenu={(event) => groupContextMenu(event, group)}
                data-testid="workspace-group"
                className="text-text-tertiary hover:text-text flex w-full items-center gap-1 px-2 pb-1 pt-3 text-left text-[10.5px] font-semibold font-mono uppercase tracking-wider transition-colors"
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
                (pendingByWorkspace.get(group.workspacePath) ?? []).map((pidexId) => (
                  <PendingSessionRow
                    key={pidexId}
                    pidexId={pidexId}
                    active={pidexId === activeSessionId}
                  />
                ))}
              {!isCollapsed &&
                group.metas.map((meta) => (
                  <SessionRow key={meta.path} {...rowProps(meta)} isPinned={false} />
                ))}
              {!isCollapsed && !group.scanned && (
                <div className="text-text-tertiary px-2 py-2 text-[11.5px]">Loading sessions…</div>
              )}
              {!isCollapsed &&
                group.scanned &&
                group.metas.length === 0 &&
                !pendingByWorkspace.has(group.workspacePath) && (
                  <div className="text-text-tertiary px-2 py-2 text-[11.5px]">
                    Sessions you start will show up here
                  </div>
                )}
            </div>
          )
        })}
      </div>

      <div className="border-border border-t px-3 py-2.5">
        <UpdatePill />
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
      {worktreeModal?.kind === 'remove' && (
        <RemoveWorktreeModal
          repoPath={worktreeModal.repoPath}
          worktree={worktreeModal.worktree}
          onClose={() => setWorktreeModal(null)}
        />
      )}
      {worktreeModal?.kind === 'merge' && (
        <MergeWorktreeModal
          repoPath={worktreeModal.repoPath}
          worktree={worktreeModal.worktree}
          onClose={() => setWorktreeModal(null)}
        />
      )}
    </aside>
  )
}

function WorkspaceSwitcher(): React.JSX.Element {
  const currentPath = useActiveWorkspace()
  const recents = useWorkspacesStore((s) => s.recents)
  const git = useSessionsStore((s) => (currentPath ? s.gitByCwd[currentPath] : undefined))
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const name = currentPath ? worktreeAwareName(currentPath, git) : 'Workspace'

  return (
    <div className="relative px-3 pb-2 pt-1">
      <button
        ref={triggerRef}
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
          triggerRef={triggerRef}
          className="absolute left-3 right-3 top-full z-40 mt-1 py-1.5"
        >
          <div className="text-text-tertiary px-3 pb-1 pt-1 text-[10.5px] font-medium font-mono uppercase tracking-wide">
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
  unseen,
  git,
  isPinned,
  showWorkspace = false,
  onOpenTree,
}: {
  meta: SessionMeta
  workspacePath: string
  livePidexId?: string
  active: boolean
  /** Activity the user hasn't viewed yet (persisted across restarts). */
  unseen: boolean
  git?: GitInfo
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
  const isSuspended = useSessionsStore((s) => s.suspendedPaths.includes(meta.path))
  const title =
    sessionTitle({ explicitName: meta.name, firstUserText: meta.firstUserText }) ??
    'Untitled session'
  // Badge reads the session's own cwd, so a Pinned row shows the project it
  // actually belongs to rather than whatever is on screen.
  const rowWorkspaceName = worktreeAwareName(meta.cwd || workspacePath, git)

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
      ...(livePidexId
        ? [
            {
              label: 'Suspend (free ~200 MB)',
              onClick: () => void store.suspendSession(livePidexId),
            },
          ]
        : []),
      {
        label: 'Rename…',
        separatorAbove: true,
        onClick: () => void renameSidebarSession(workspacePath, meta, livePidexId),
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
        onClick: () => void exportSidebarSession(workspacePath, meta, livePidexId),
      },
      {
        label: 'Delete (move to trash)',
        danger: true,
        separatorAbove: true,
        onClick: () => void store.deleteDiskSession(workspacePath, meta),
      },
    ])
  }

  const subtitle = sessionSubtitle(meta, git)
  const indicatorState = isStreaming
    ? 'streaming'
    : unseen
      ? 'unseen'
      : livePidexId
        ? 'live'
        : 'disk'

  return (
    <button
      onClick={open}
      onContextMenu={contextMenu}
      data-testid="session-row"
      data-workspace={rowWorkspaceName}
      title={meta.branchCount > 0 ? `${meta.branchCount + 1} branches` : undefined}
      className={clsx(
        'group flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left transition-colors',
        active ? 'bg-bg-secondary' : 'hover:bg-bg-secondary/70',
      )}
    >
      <span
        data-testid="session-indicator"
        data-state={indicatorState}
        className="flex h-4 w-4 shrink-0 items-center justify-center"
      >
        {indicatorState === 'streaming' ? (
          <PiSpark size={13} />
        ) : indicatorState === 'unseen' ? (
          <span className="bg-success h-2 w-2 rounded-full" title="New activity" />
        ) : indicatorState === 'live' ? (
          <span className="border-success h-2 w-2 rounded-full border" title="Live session" />
        ) : (
          <span className="border-border-strong h-2 w-2 rounded-full border" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-text block truncate text-[12px] leading-4">{title}</span>
        <span className="text-text-tertiary flex items-center gap-1 text-[10px] leading-3.5">
          {isSuspended && (
            <span
              className="bg-bg-secondary text-text-tertiary mr-0.5 shrink-0 rounded px-1 font-medium"
              title="Process released to save memory. Opening this session resumes it from disk."
            >
              suspended
            </span>
          )}
          {subtitle.map((segment, i) => (
            <span
              key={segment.key}
              className={clsx(
                'flex items-center',
                // The branch is the only segment allowed to give up space.
                // Both classes set flex-shrink, so they must be exclusive:
                // emitting `shrink-0 shrink` let source order decide and
                // `shrink-0` won, which is what pushed long branch names past
                // the sidebar edge and produced a horizontal scrollbar.
                segment.truncate ? 'min-w-0 shrink' : 'shrink-0',
              )}
            >
              {i > 0 && <span className="pr-1">·</span>}
              {segment.key === 'worktree' ? (
                <span
                  className="bg-bg-secondary text-text-tertiary rounded px-1 font-medium"
                  title="Runs in a git worktree"
                >
                  wt
                </span>
              ) : segment.key === 'branch' ? (
                <span className="truncate" title={segment.text}>
                  ⎇ {segment.text}
                </span>
              ) : (
                <span className={clsx(segment.key === 'dirty' && 'text-warning')}>
                  {segment.text}
                </span>
              )}
            </span>
          ))}
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
      {isPinned && <PinIcon />}
    </button>
  )
}

/**
 * Row for a live session that has no session file yet.
 *
 * Deliberately not a `SessionRow`: every action there is keyed on
 * `meta.path` (rename, fork, clone, export, delete, open-from-disk), and this
 * session has no path to act on. It only needs to say "this exists and it is
 * yours", and clicking it activates the already-live session.
 */
function PendingSessionRow({
  pidexId,
  active,
}: {
  pidexId: string
  active: boolean
}): React.JSX.Element {
  const isStreaming = useChatStore((s) => s.sessions[pidexId]?.isStreaming ?? false)
  const firstUserText = useChatStore(
    (s) => s.sessions[pidexId]?.items.find((item) => item.kind === 'user')?.text,
  )
  const explicitName = useChatStore((s) => s.sessions[pidexId]?.meta?.sessionName)
  const title = sessionTitle({ explicitName, firstUserText }) ?? 'New session'

  return (
    <button
      onClick={() => useSessionsStore.getState().activate(pidexId)}
      data-testid="session-row"
      data-pending="true"
      className={clsx(
        'group flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left transition-colors',
        active ? 'bg-bg-secondary' : 'hover:bg-bg-secondary/70',
      )}
    >
      <span
        data-testid="session-indicator"
        data-state={isStreaming ? 'streaming' : 'live'}
        className="flex h-4 w-4 shrink-0 items-center justify-center"
      >
        {isStreaming ? (
          <PiSpark size={13} />
        ) : (
          <span className="border-success h-2 w-2 rounded-full border" title="Live session" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-text block truncate text-[12px] leading-4">{title}</span>
        <span className="text-text-tertiary block text-[10px] leading-3.5">starting…</span>
      </span>
    </button>
  )
}

/** Rename a disk or live session, then refresh the sidebar listing. */
function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="text-text-tertiary px-2 pb-1 pt-3 text-[10.5px] font-semibold font-mono uppercase tracking-wider">
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
