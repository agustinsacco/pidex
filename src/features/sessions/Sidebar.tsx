import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { GitInfo, SessionMeta, WorktreeInfo } from '@shared/models'
import { compareSessionsByCreation } from '@shared/session-order'
import { useSessionsStore } from '@/stores/sessions'
import { useActiveWorkspace, useWorkspacesStore } from '@/stores/workspaces'
import { useChatStore } from '@/stores/chat'
import { showContextMenu } from '@/components/ContextMenu'
import { isUnseen } from './unseen'
import { sessionSubtitle } from './sessionSubtitle'
import { PopupMenu, MenuRow } from '@/components/PopupMenu'
import {
  ArtifactsIcon,
  ChevronDownIcon,
  ChevronIcon,
  GearIcon,
  MoreIcon,
  PinIcon,
  PlusIcon,
  ResourcesIcon,
  UsageIcon,
} from '@/components/icons'
import { PiSpark } from '@/components/PiSpark'
import { TreeViewModal } from './TreeViewModal'
import { useSettingsUiStore } from '@/features/settings/settingsUiStore'
import { useUsageUiStore } from '@/features/usage/usageUiStore'
import { useMonitorUiStore } from '@/features/resources/monitorUiStore'
import { UpdatePill } from '@/features/updates/UpdatePill'
import { formatShortcut } from '@/lib/shortcuts'
import { useLayoutStore } from '@/stores/layout'
import { worktreeAwareName, isWorktreeFolder } from '@/lib/path'
import {
  groupSessionsByProject,
  pendingSessionsByGroup,
  type GroupedSessions,
} from './groupSessions'
import { sessionTitle } from '@/lib/sessionTitle'
import { useNameTransition } from './nameTransition'
import { cloneSession, exportSidebarSession, renameSidebarSession } from './sidebarActions'
import { copySessionDebugInfo } from './sessionActions'
import { RemoveWorktreeModal } from '@/features/worktrees/RemoveWorktreeModal'
import { MergeWorktreeModal } from '@/features/worktrees/MergeWorktreeModal'

const SIDEBAR_WIDTH_KEY = 'pidex:sidebarWidth'
const SIDEBAR_MIN = 208
const SIDEBAR_MAX = 420
const SIDEBAR_DEFAULT = 256

function loadSidebarWidth(): number {
  const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
  if (!Number.isFinite(stored) || stored === 0) return SIDEBAR_DEFAULT
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, stored))
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
  const [width, setWidth] = useState(loadSidebarWidth)
  const [resizing, setResizing] = useState(false)
  /** Worktree folders discovered under each known repo workspace. */
  const [worktreeDirs, setWorktreeDirs] = useState<string[]>([])
  const [workspaceMenuFor, setWorkspaceMenuFor] = useState<string | null>(null)
  const workspaceMenuTriggerRef = useRef<HTMLButtonElement>(null)
  /** Which roots we already listed worktrees for (avoids re-listing on toggle). */
  const worktreeListedKey = useRef<string | null>(null)

  const startResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    setResizing(true)
    const onMove = (move: PointerEvent): void => {
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + move.clientX - startX))
      setWidth(next)
    }
    const onUp = (up: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setResizing(false)
      const finalWidth = Math.min(
        SIDEBAR_MAX,
        Math.max(SIDEBAR_MIN, startWidth + up.clientX - startX),
      )
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(finalWidth))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /**
   * Persisted workspaces only — always user folders, never worktree nodes.
   */
  const cleanRecents = useMemo(() => recents.filter((ws) => !isWorktreeFolder(ws.path)), [recents])

  /**
   * Every workspace worth listing: the known recents plus the active one and
   * any folder that currently has a live session (a session can outlive its
   * entry in recents). Worktree folders are not workspaces — instead of
   * living in recents they are discovered under each known repo (see the
   * `git:listWorktrees` effect below) and fold back into that repo's group.
   */
  const knownWorkspaces = useMemo(() => {
    // The persisted recents list is the user's sidebar order. Runtime-only
    // paths are appended, so activating or creating a session cannot promote
    // any existing workspace.
    const paths = new Set(cleanRecents.map((workspace) => workspace.path))
    paths.add(workspacePath)
    for (const entry of Object.values(live)) paths.add(entry.workspacePath)
    for (const worktree of worktreeDirs) paths.add(worktree)
    return [...paths].filter(Boolean)
  }, [workspacePath, live, cleanRecents, worktreeDirs])

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

  /**
   * Discover the worktree folders under each known repo workspace.
   *
   * Worktrees are not persisted as workspaces (they are branches of one), so
   * the sidebar would otherwise never scan them and their sessions would
   * vanish from the project group they fold into. Listing each known working
   * tree restores them; the merge in `groupSessionsByProject` puts every one
   * back under its main repo's header.
   */
  useEffect(() => {
    // Wait for prefs hydration, and only list once per set of known roots —
    // expanding/collapsing a group must not re-run a full `git:listWorktrees`
    // per workspace.
    if (collapsed === null) return
    const roots = [...cleanRecents.map((ws) => ws.path), workspacePath].filter(
      (p) => Boolean(p) && !isWorktreeFolder(p!),
    )
    const key = roots.join('\u0000')
    if (worktreeListedKey.current === key) return
    worktreeListedKey.current = key
    let cancelled = false
    void (async () => {
      const found = new Set<string>()
      for (const root of roots) {
        if (cancelled) return
        try {
          const worktrees = (await window.pidex.invoke('git:listWorktrees', root)) as WorktreeInfo[]
          for (const wt of worktrees) {
            if (!wt.isMain) found.add(wt.realPath || wt.path)
          }
        } catch {
          // Not a repo, or git unavailable — nothing to discover there.
        }
      }
      if (!cancelled) setWorktreeDirs([...found])
    })()
    return () => {
      cancelled = true
    }
  }, [cleanRecents, workspacePath, collapsed])

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

  const pinnedSet = useMemo(() => new Set(pinned), [pinned])

  /** Pinned sessions across every workspace — this group deliberately mixes. */
  const pinnedMetas = useMemo(
    () =>
      Object.values(disk)
        .flat()
        .filter((m) => pinnedSet.has(m.path))
        .sort(compareSessionsByCreation),
    [disk, pinnedSet],
  )

  /**
   * Remaining sessions grouped by *project*, live projects first.
   *
   * A linked worktree is a different folder from its main repo, so without
   * this merge step every worktree got its own header ("pidex", "pidex
   * (test)", ...) even though they're all the same project — the sidebar
   * read as more projects than actually existed. Instead, a worktree's
   * sessions fold into its main repo's group (keyed by `mainRepoPath`, from
   * `git:info`); the worktree/branch a session actually runs on is shown per
   * row via the "wt" subtitle chip, not by splitting the group.
   */
  const groups = useMemo<GroupedSessions[]>(
    () =>
      groupSessionsByProject(
        knownWorkspaces,
        disk,
        gitByCwd,
        (m) => pinnedSet.has(m.path),
        (m) => liveByDisk.has(m.path),
        workspacePath,
      ),
    [knownWorkspaces, disk, pinnedSet, liveByDisk, workspacePath, gitByCwd],
  )

  /** Every session path currently visible in `disk`, across all workspaces. */
  const diskPaths = useMemo(() => {
    const set = new Set<string>()
    for (const metas of Object.values(disk)) {
      for (const meta of metas) set.add(meta.path)
    }
    return set
  }, [disk])

  /**
   * Live sessions with no row in `disk` yet, grouped by project.
   *
   * A freshly created session is spawned and prompted immediately, but its
   * `.jsonl` only appears once pi writes it — and the watcher adds
   * `awaitWriteFinish` plus a debounce on top of that. Without these
   * placeholders a session you just started shows no row at all until the
   * scan catches up, which reads as a dropped message.
   */
  const pendingByWorkspace = useMemo(
    () => pendingSessionsByGroup(Object.values(live), diskPaths, groups),
    [live, diskPaths, groups],
  )

  /**
   * Collapse resolution: an explicit choice wins; otherwise scanned groups
   * are open and unscanned ones start closed. That default IS the lazy-load
   * path — workspaces beyond the boot-scan cap sit collapsed until expanded,
   * which is when their first scan happens. The active workspace's project
   * is always open by default, even before its scan lands — checked via
   * `paths`, since the active folder may be a worktree merged into a group
   * whose primary `workspacePath` is the main repo.
   */
  const isGroupCollapsed = (group: GroupedSessions): boolean =>
    collapsed?.[group.workspacePath] ??
    (group.scanned ? false : !group.paths.includes(workspacePath))

  const toggleGroup = (group: GroupedSessions, wasCollapsed: boolean): void => {
    const next = { ...(collapsed ?? {}), [group.workspacePath]: !wasCollapsed }
    setCollapsed(next)
    void window.pidex.invoke(
      'app:setCollapsedWorkspaces',
      Object.keys(next).filter((p) => next[p]),
    )
    // Expanding catches up on anything missed while the group was unwatched,
    // across every folder merged into this project (main repo + worktrees).
    if (wasCollapsed) {
      const store = useSessionsStore.getState()
      for (const path of group.paths) void store.refreshDisk(path)
    }
  }

  // Watch exactly the visible groups: expanded ⇒ watching, collapsed ⇒ not.
  // Idempotent both ways, so re-running on scan results is fine. Gated on
  // prefs hydration to avoid a watch-then-unwatch churn at mount.
  useEffect(() => {
    if (collapsed === null) return
    const store = useSessionsStore.getState()
    const expanded = groups.filter((g) => !isGroupCollapsed(g)).flatMap((g) => g.paths)
    const closed = groups.filter((g) => isGroupCollapsed(g)).flatMap((g) => g.paths)
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
      // Only offered when the group's own representative folder is itself a
      // worktree — i.e. its main repo isn't a known workspace to fold into.
      // Once both are known and merged, this lives on the top bar's branch
      // control instead of the ambiguous, multi-folder group.
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

  const moveGroup = (group: GroupedSessions, direction: 'up' | 'down'): void => {
    // A merged worktree group is represented by its main-repo workspace path,
    // which is the entry the user sees and orders in the sidebar.
    useWorkspacesStore.getState().moveWorkspace(group.workspacePath, direction)
    setWorkspaceMenuFor(null)
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
    <aside
      className="border-border bg-bg-secondary/50 relative flex h-full shrink-0 flex-col border-r"
      style={{ width }}
    >
      {/* No drag strip here any more: the window's title bar is now a single
          full-width element above every column (src/app/TopBar.tsx), which is
          also where the macOS traffic-light inset lives. */}
      <WorkspaceSwitcher />

      {/* Flat nav rows, matching the reference: icon + label, no border or
          shadow. New routes to the home screen; the folder is chosen there
          via the composer's workspace chip. */}
      <nav className="px-2 pb-1.5">
        <NavRow
          label="New"
          badge
          onClick={() => useSessionsStore.getState().activate(null)}
          icon={<PlusIcon strokeWidth={2.5} />}
        />
        <NavRow
          label="Artifacts"
          onClick={() => useLayoutStore.getState().toggleRightPane('artifacts')}
          icon={<ArtifactsIcon />}
        />
        <NavRow
          label="Usage"
          onClick={() => useUsageUiStore.getState().setOpen(true)}
          icon={<UsageIcon />}
        />
        <NavRow
          label="Resources"
          onClick={() => useMonitorUiStore.getState().setOpen(true)}
          icon={<ResourcesIcon />}
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
              <div
                onContextMenu={(event) => groupContextMenu(event, group)}
                className="group/header relative flex w-full items-center gap-1 pb-0.5 pl-2 pr-1 pt-2.5"
              >
                <button
                  onClick={() => toggleGroup(group, isCollapsed)}
                  data-testid="workspace-group"
                  className="text-text-tertiary hover:text-text flex min-w-0 flex-1 items-center gap-1 py-0.5 text-left text-xs font-semibold font-mono uppercase tracking-wider transition-colors"
                  title={group.workspacePath}
                >
                  <span className="min-w-0 truncate">{group.name}</span>
                  <ChevronIcon
                    size={8}
                    strokeWidth={3}
                    expanded={!isCollapsed}
                    className={clsx(
                      'shrink-0 transition-opacity',
                      // Collapsed groups keep their caret as the "there's more
                      // here" cue; expanded ones reveal it on hover only.
                      !isCollapsed && 'opacity-0 group-hover/header:opacity-100',
                    )}
                  />
                  {group.liveCount > 0 && (
                    <span
                      className="bg-success h-1.5 w-1.5 shrink-0 rounded-full"
                      title={`${group.liveCount} live`}
                    />
                  )}
                </button>
                <button
                  ref={
                    workspaceMenuFor === group.workspacePath ? workspaceMenuTriggerRef : undefined
                  }
                  onClick={() =>
                    setWorkspaceMenuFor((current) =>
                      current === group.workspacePath ? null : group.workspacePath,
                    )
                  }
                  data-testid="workspace-group-menu"
                  title="Workspace options"
                  aria-label={`Workspace options for ${group.name}`}
                  className="text-text-tertiary hover:text-text hover:bg-bg-secondary flex h-5 w-5 shrink-0 items-center justify-center rounded-md opacity-0 transition-all duration-150 focus-visible:opacity-100 group-hover/header:opacity-100"
                >
                  <MoreIcon size={14} />
                </button>
                {workspaceMenuFor === group.workspacePath && (
                  <PopupMenu
                    onClose={() => setWorkspaceMenuFor(null)}
                    triggerRef={workspaceMenuTriggerRef}
                    className="absolute right-1 top-full z-40 mt-1 min-w-36 py-1"
                  >
                    <MenuRow
                      active={false}
                      disabled={groups.indexOf(group) === 0}
                      onClick={() => moveGroup(group, 'up')}
                    >
                      Move up
                    </MenuRow>
                    <MenuRow
                      active={false}
                      disabled={groups.indexOf(group) === groups.length - 1}
                      onClick={() => moveGroup(group, 'down')}
                    >
                      Move down
                    </MenuRow>
                  </PopupMenu>
                )}
                <button
                  onClick={() => {
                    useWorkspacesStore.getState().openWorkspace(group.workspacePath)
                    useSessionsStore.getState().activate(null)
                  }}
                  data-testid="workspace-group-new-session"
                  title="New session here"
                  className="text-text-tertiary hover:text-text hover:bg-bg-secondary flex h-5 w-5 shrink-0 items-center justify-center rounded-md opacity-0 transition-all duration-150 focus-visible:opacity-100 group-hover/header:opacity-100 active:scale-90"
                >
                  <PlusIcon size={12} strokeWidth={2.5} />
                </button>
              </div>
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
                <div className="text-text-tertiary px-2 py-2 text-sm">Loading sessions…</div>
              )}
              {!isCollapsed &&
                group.scanned &&
                group.metas.length === 0 &&
                !pendingByWorkspace.has(group.workspacePath) && (
                  <div className="text-text-tertiary px-2 py-2 text-sm">
                    Sessions you start will show up here
                  </div>
                )}
            </div>
          )
        })}
      </div>

      <div className="border-border border-t px-3 py-2">
        <UpdatePill />
        <button
          onClick={() => useSettingsUiStore.getState().setOpen(true)}
          className="text-text-secondary hover:text-text hover:bg-bg-secondary -mx-1 flex w-[calc(100%+8px)] items-center gap-2 rounded-md px-1.5 py-1 text-base transition-colors"
          title={`Settings (${formatShortcut('mod', ',')})`}
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

      {/* Width resize handle: an invisible strip over the right border. */}
      <div
        onPointerDown={startResize}
        className={clsx(
          'hover:bg-accent/40 absolute -right-0.5 top-0 z-30 h-full w-1 cursor-col-resize transition-colors',
          resizing && 'bg-accent/40',
        )}
      />
      {resizing && <div className="fixed inset-0 z-50 cursor-col-resize select-none" />}
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
    // Draggable: on Windows/Linux this row sits flush against the top of the
    // window (there is no traffic-light strip above it), so it is the only
    // grab handle the sidebar has. The trigger and the menu opt back out.
    <div className="titlebar-drag relative px-3 pb-1.5 pt-1">
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        data-testid="workspace-switcher"
        className="hover:bg-bg-secondary flex w-full items-center gap-2 rounded-lg px-2 py-1 transition-colors"
      >
        <span className="bg-accent-soft text-accent flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-base font-bold uppercase">
          {name.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1 truncate text-left text-lg font-semibold">{name}</span>
        <ChevronDownIcon className="text-text-tertiary shrink-0" />
      </button>

      {open && (
        <PopupMenu
          onClose={() => setOpen(false)}
          triggerRef={triggerRef}
          className="absolute left-3 right-3 top-full z-40 mt-1 py-1.5"
        >
          <div className="text-text-tertiary px-3 pb-1 pt-1 text-xs font-medium font-mono uppercase tracking-wide">
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
                <span className="block truncate text-lg font-medium">{ws.name}</span>
                <span className="text-text-tertiary block truncate text-sm">{ws.path}</span>
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
            <span className="text-lg">Open Folder…</span>
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
  const naming = useNameTransition(livePidexId)
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
        label: 'Copy debug info',
        onClick: () => void copySessionDebugInfo(meta, livePidexId),
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
        // Active = the row on screen. The full-tint background disappears at
        // a glance, so pair it with a 2px accent rail on the left edge: the
        // border is the "this is open" signal, the fill is the "and it has
        // visual weight". The hover wash is dropped to /40 so it doesn't
        // compete with the active fill on adjacent rows.
        active
          ? 'border-l-2 border-l-accent bg-bg-secondary pl-[calc(0.5rem-2px)]'
          : 'border-l-2 border-l-transparent hover:bg-bg-secondary/40',
      )}
    >
      <SessionIndicator state={indicatorState} />
      <span className="min-w-0 flex-1">
        <span
          // Re-keyed on the title so the arrival of a generated name replays
          // the entrance; without it React patches the text node in place and
          // the name simply pops.
          key={title}
          title={naming.pending ? 'Naming this chat…' : undefined}
          className={clsx(
            'text-text block truncate text-base leading-4',
            naming.pending && 'name-pending',
            naming.settled && 'name-enter',
          )}
        >
          {title}
        </span>
        <span className="text-text-tertiary flex items-center gap-1 text-xs leading-3.5">
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
          className="bg-bg-secondary text-text-tertiary shrink-0 rounded px-1.5 py-px text-2xs font-medium"
        >
          {rowWorkspaceName}
        </span>
      )}
      {isPinned && <PinIcon className="text-text-tertiary shrink-0" />}
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
  const naming = useNameTransition(pidexId)
  const title = sessionTitle({ explicitName, firstUserText }) ?? 'New session'

  return (
    <button
      onClick={() => useSessionsStore.getState().activate(pidexId)}
      data-testid="session-row"
      data-pending="true"
      className={clsx(
        'group flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left transition-colors',
        // Same active treatment as SessionRow — see comment there. Pending
        // sessions are short-lived (no disk file yet) so the rail matters
        // less, but it must still be visible while the row is on screen.
        active
          ? 'border-l-2 border-l-accent bg-bg-secondary pl-[calc(0.5rem-2px)]'
          : 'border-l-2 border-l-transparent hover:bg-bg-secondary/40',
      )}
    >
      <SessionIndicator state={isStreaming ? 'streaming' : 'live'} />
      <span className="min-w-0 flex-1">
        <span
          className={clsx(
            'text-text block truncate text-base leading-4',
            naming.pending && 'name-pending',
          )}
        >
          {title}
        </span>
        <span className="text-text-tertiary block text-xs leading-3.5">
          {naming.pending ? 'naming…' : 'starting…'}
        </span>
      </span>
    </button>
  )
}

/**
 * The dot at the head of a session row, in its four states.
 *
 * `data-testid` and `data-state` are asserted by e2e/smoke.spec.ts — the row
 * types must keep emitting the same values.
 */
function SessionIndicator({
  state,
}: {
  state: 'streaming' | 'unseen' | 'live' | 'disk'
}): React.JSX.Element {
  return (
    <span
      data-testid="session-indicator"
      data-state={state}
      className="flex h-4 w-4 shrink-0 items-center justify-center"
    >
      {state === 'streaming' ? (
        <PiSpark size={13} />
      ) : state === 'unseen' ? (
        <span className="bg-success h-2 w-2 rounded-full" title="New activity" />
      ) : state === 'live' ? (
        <span className="border-success h-2 w-2 rounded-full border" title="Live session" />
      ) : (
        <span className="border-border-strong h-2 w-2 rounded-full border" />
      )}
    </span>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="text-text-tertiary px-2 pb-0.5 pt-2.5 text-xs font-semibold font-mono uppercase tracking-wider">
      {children}
    </div>
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
      className="text-text hover:bg-bg-secondary group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1 text-left text-lg transition-colors"
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
