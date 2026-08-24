import type { GitInfo, SessionMeta } from '@shared/models'
import { isOrchestratorSession } from '@shared/orchestratorIdentity'
import { compareSessionsByCreation } from '@shared/session-order'
import { workspaceName } from '@/lib/path'

export interface GroupedSessions {
  /**
   * Representative folder for this group: the main repo when it's known,
   * otherwise whichever linked worktree we do know. Used as the persisted
   * collapse key and as the target for group-level actions ("new session
   * here", watchers).
   */
  workspacePath: string
  /** Every physical folder merged into this group (main repo + worktrees). */
  paths: string[]
  name: string
  metas: SessionMeta[]
  liveCount: number
  /** False until every folder in this group has been scanned. */
  scanned: boolean
}

/**
 * Group known workspace folders into one entry per *project*, live projects
 * in the caller's persisted workspace order.
 *
 * A linked worktree is a different folder from its main repo, so grouping
 * naively by folder gave every worktree its own sidebar header ("pidex",
 * "pidex (test)", ...) even though they're all the same project — the
 * sidebar read as more projects than actually existed. Instead, a worktree's
 * sessions fold into its main repo's group (keyed by `mainRepoPath`, from
 * `git:info`); the worktree/branch a session actually runs on is shown per
 * row via the sidebar's "wt" subtitle chip, not by splitting the group.
 */
export function groupSessionsByProject(
  knownWorkspaces: string[],
  disk: Record<string, SessionMeta[]>,
  gitByCwd: Record<string, GitInfo | undefined>,
  isPinned: (meta: SessionMeta) => boolean,
  isLive: (meta: SessionMeta) => boolean,
  activeWorkspacePath: string,
  /**
   * Session file paths belonging to orchestrator threads. They run in the
   * project's own cwd, so without this they sort into the list as ordinary
   * chats — see `OrchestratorRow`, which gives them their own shape.
   */
  orchestratorPaths: Iterable<string> = [],
): GroupedSessions[] {
  const byProject = new Map<
    string,
    { paths: string[]; metas: SessionMeta[]; liveCount: number; scanned: boolean }
  >()
  for (const path of knownWorkspaces) {
    const git = gitByCwd[path]
    const projectKey = git?.isWorktree && git.mainRepoPath ? git.mainRepoPath : path
    const metas = (disk[path] ?? []).filter(
      (m) => !isPinned(m) && !isOrchestratorSession(m, orchestratorPaths),
    )
    const liveCount = metas.filter(isLive).length
    const scanned = path in disk
    const existing = byProject.get(projectKey)
    if (existing) {
      existing.paths.push(path)
      existing.metas.push(...metas)
      existing.liveCount += liveCount
      existing.scanned &&= scanned
    } else {
      byProject.set(projectKey, { paths: [path], metas, liveCount, scanned })
    }
  }
  return (
    [...byProject.entries()]
      .map(([projectKey, entry]) => {
        // The main repo path is the natural target for group-level actions
        // (new session, watchers) when we know about it; otherwise fall back
        // to whichever worktree folder we do know.
        const workspacePath = entry.paths.includes(projectKey) ? projectKey : entry.paths[0]!
        return {
          workspacePath,
          paths: entry.paths,
          name: workspaceName(projectKey),
          metas: entry.metas.sort(compareSessionsByCreation),
          liveCount: entry.liveCount,
          scanned: entry.scanned,
        }
      })
      // Unscanned workspaces (beyond the boot-scan cap) still get a header —
      // hiding them would make their sessions unreachable until restart.
      // Map insertion order comes from `knownWorkspaces`, the persisted
      // user-defined order. Do not sort by active/live/recent activity here.
      .filter((g) => g.metas.length > 0 || !g.scanned || g.paths.includes(activeWorkspacePath))
  )
}

interface LiveEntry {
  pidexId: string
  workspacePath: string
  diskPath?: string
}

/**
 * Live sessions with no matching row in `disk` yet, keyed by each session's
 * *group* (via `paths`, not the raw `workspacePath`) so a live session in a
 * worktree folded into its main repo's group still finds its placeholder.
 *
 * Gated on the path actually appearing in `diskPaths`, not on whether
 * `diskPath` is merely known: `get_state` (which supplies `diskPath`)
 * resolves as soon as pi answers the RPC call, independently of when pi
 * actually flushes the file and independently of the session-dir watcher's
 * awaitWriteFinish-plus-debounce picking it up. Gating on "unknown" alone
 * reopens the gap this exists to close — a session can sit with a known
 * `diskPath` but no sidebar row for the length of a slow first turn.
 */
export function pendingSessionsByGroup(
  live: LiveEntry[],
  diskPaths: ReadonlySet<string>,
  groups: Pick<GroupedSessions, 'workspacePath' | 'paths'>[],
): Map<string, string[]> {
  const groupKeyByPath = new Map<string, string>()
  for (const g of groups) {
    for (const path of g.paths) groupKeyByPath.set(path, g.workspacePath)
  }

  const map = new Map<string, string[]>()
  for (const entry of live) {
    if (entry.diskPath && diskPaths.has(entry.diskPath)) continue
    const key = groupKeyByPath.get(entry.workspacePath) ?? entry.workspacePath
    const list = map.get(key)
    if (list) list.push(entry.pidexId)
    else map.set(key, [entry.pidexId])
  }
  return map
}
