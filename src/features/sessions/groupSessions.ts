import type { GitInfo, SessionMeta } from '@shared/models'
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
 * first.
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
): GroupedSessions[] {
  const byProject = new Map<
    string,
    { paths: string[]; metas: SessionMeta[]; liveCount: number; scanned: boolean }
  >()
  for (const path of knownWorkspaces) {
    const git = gitByCwd[path]
    const projectKey = git?.isWorktree && git.mainRepoPath ? git.mainRepoPath : path
    const metas = (disk[path] ?? []).filter((m) => !isPinned(m))
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
          metas: entry.metas.sort((a, b) => b.mtimeMs - a.mtimeMs),
          liveCount: entry.liveCount,
          scanned: entry.scanned,
        }
      })
      // Unscanned workspaces (beyond the boot-scan cap) still get a header —
      // hiding them would make their sessions unreachable until restart.
      .filter((g) => g.metas.length > 0 || !g.scanned || g.paths.includes(activeWorkspacePath))
      .sort((a, b) => {
        if (a.liveCount !== b.liveCount) return b.liveCount - a.liveCount
        if (a.paths.includes(activeWorkspacePath)) return -1
        if (b.paths.includes(activeWorkspacePath)) return 1
        return (b.metas[0]?.mtimeMs ?? 0) - (a.metas[0]?.mtimeMs ?? 0)
      })
  )
}
