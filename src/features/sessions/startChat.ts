import type { WorktreeInfo } from '@shared/models'
import type { ImageContent } from '@shared/rpc'
import { useSessionsStore } from '@/stores/sessions'
import { useWorkspacesStore } from '@/stores/workspaces'
import { repoWorktrees, useWorktreesStore } from '@/stores/worktrees'
import { branchNameFor } from '@/lib/branchName'
import { sessionTitle } from '@/lib/sessionTitle'
import { workspaceName } from '@/lib/path'
import { errorText } from '@shared/errors'

/**
 * Starting a chat from the home composer: name it, branch it, run it.
 *
 * These were two separate ideas that only work as one. pi never titles a
 * session, so pidex asks a one-shot `pi -p` for a name; and a chat that edits
 * files wants its own branch. Doing them independently would mean two model
 * calls and two unrelated names for the same piece of work — so the generated
 * title is what the branch and the worktree folder are derived from, and one
 * chat ends up with one name in three places.
 *
 * The sequencing is the whole design. The branch has to exist *before* pi
 * spawns, because a pi session is bound to the cwd it started in (it records
 * its transcript under a mangling of that path) — there is no moving a live
 * session into a worktree afterwards. So the send button waits on the title,
 * which is why every failure below degrades instead of aborting: naming can
 * time out, the remote can be unreachable, git can refuse, and in each case
 * the user still gets their session with their message in it.
 */

/** Cap on waiting for the naming model before falling back to the message. */
const TITLE_TIMEOUT_MS = 12_000

export type StartChatPhase = 'naming' | 'branching' | 'starting'

export interface StartChatOptions {
  /** Workspace the home screen is composing against. */
  workspacePath: string
  prompt: string
  images?: ImageContent[]
  /** Progress for the composer's button label. */
  onPhase?: (phase: StartChatPhase) => void
  /** Non-fatal problem to surface; the session still starts. */
  onWarning?: (message: string) => void
}

export interface StartChatResult {
  sessionId: string
  /** Where the session actually started (a worktree, or the original folder). */
  workspacePath: string
  /** Branch created for this chat, when one was. */
  branch?: string
}

/**
 * Create the chat the composer just described.
 *
 * Returns once the session exists and its first prompt is on the way; the
 * transcript streams in on its own after that.
 */
export async function startChat(options: StartChatOptions): Promise<StartChatResult> {
  const { workspacePath, prompt, images } = options
  const isolate = await shouldIsolate(workspacePath)

  if (!isolate) {
    options.onPhase?.('starting')
    const sessionId = await useSessionsStore
      .getState()
      .createSession(workspacePath, { firstPrompt: prompt, firstImages: images })
    return { sessionId, workspacePath }
  }

  const { repoPath } = isolate
  options.onPhase?.('naming')

  // Both slow, neither depends on the other: the title comes from a model and
  // the fetch from the network, and the branch needs both before it can exist.
  const [title, base] = await Promise.all([
    generateTitle(repoPath, workspacePath, prompt),
    resolveBase(repoPath),
  ])

  options.onPhase?.('branching')
  const created = await createBranchWorktree(repoPath, title ?? prompt, base)

  if (!created.worktree) {
    // Git refused (a locked index, a name race, a repo in an odd state). The
    // message is worth more than the branch: start where we are and say why.
    options.onWarning?.(created.error)
    options.onPhase?.('starting')
    const sessionId = await useSessionsStore.getState().createSession(workspacePath, {
      firstPrompt: prompt,
      firstImages: images,
      ...(title ? { name: title } : {}),
    })
    return { sessionId, workspacePath }
  }

  const cwd = created.worktree.realPath
  options.onPhase?.('starting')
  // Point the window at the new worktree before the session starts, so the top
  // bar and file tree describe the place the session is actually running in.
  useWorkspacesStore.getState().openWorkspace(cwd)

  const sessionId = await useSessionsStore.getState().createSession(cwd, {
    firstPrompt: prompt,
    firstImages: images,
    // Passing the title here also suppresses the store's own auto-naming pass:
    // we already spent that model call, and its result is in the branch name.
    ...(title ? { name: title } : {}),
  })
  return { sessionId, workspacePath: cwd, branch: created.worktree.branch ?? undefined }
}

/**
 * Whether this chat should get its own branch, and which repo owns it.
 *
 * A chat started from inside a worktree still branches off trunk rather than
 * joining the branch it was started from: "new chat" means new work, and the
 * repo of record for a worktree is its main tree (`mainRepoPath`), which is
 * where every other worktree lives too. Continuing on the current branch is
 * still reachable — the sidebar's "New session here" does exactly that.
 */
async function shouldIsolate(workspacePath: string): Promise<{ repoPath: string } | null> {
  if (!useWorktreesStore.getState().preferWorktree) return null
  try {
    const info = await window.pidex.invoke('git:info', workspacePath)
    if (!info.isRepo) return null
    return { repoPath: info.isWorktree && info.mainRepoPath ? info.mainRepoPath : workspacePath }
  } catch {
    // Not a repo, or git is unavailable — a plain session is the right answer.
    return null
  }
}

/**
 * Ask for a session name, bounded by a timeout.
 *
 * `pi:generateTitle` already fails soft (it returns null rather than throwing),
 * but "returns null" and "returns eventually" are different promises: this call
 * is now on the critical path of the send button, so a model that hangs must
 * cost a bounded wait, not the session.
 */
async function generateTitle(
  repoPath: string,
  workspacePath: string,
  prompt: string,
): Promise<string | null> {
  const existing = existingTitlesForRepo(repoPath, workspacePath)
  const request = window.pidex
    .invoke('pi:generateTitle', workspacePath, prompt, existing)
    .catch(() => null)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), TITLE_TIMEOUT_MS)
  })
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Session titles already used anywhere in this repo, worktrees included.
 *
 * Scoped to the repo rather than the folder because that is the scope the
 * names have to be unique in: every worktree's branch lives in one repo, and
 * the sidebar folds all of their sessions into one group.
 */
function existingTitlesForRepo(repoPath: string, workspacePath: string): string[] {
  const { disk } = useSessionsStore.getState()
  const titles: string[] = []
  for (const [path, metas] of Object.entries(disk)) {
    // Both separators: worktree paths reach the renderer as the OS wrote them.
    const inRepo =
      path === repoPath ||
      path === workspacePath ||
      path.startsWith(`${repoPath}/`) ||
      path.startsWith(`${repoPath}\\`)
    if (!inRepo) continue
    for (const meta of metas) {
      const title = sessionTitle({ explicitName: meta.name, firstUserText: meta.firstUserText })
      if (title) titles.push(title)
    }
  }
  return titles
}

/**
 * Freshest trunk to branch from, fetching first so "latest main" is true.
 *
 * The fetch is the throttled one (once per 3 minutes per repo in main), so
 * starting several chats in a row costs one network round trip. A repo that is
 * offline, has no remote, or has no credentials simply resolves to local trunk.
 */
async function resolveBase(repoPath: string): Promise<{ base: string; noTrack: boolean }> {
  try {
    await useWorktreesStore.getState().syncRemote(repoPath)
    const point = await window.pidex.invoke('git:startPoint', repoPath)
    return { base: point.base, noTrack: point.fromRemote }
  } catch {
    // `HEAD` is the last resort: whatever trunk is, the main tree is on it.
    return { base: 'HEAD', noTrack: false }
  }
}

/** Create the worktree, or explain in one sentence why there isn't one. */
async function createBranchWorktree(
  repoPath: string,
  title: string,
  base: { base: string; noTrack: boolean },
): Promise<{ worktree: WorktreeInfo; error?: undefined } | { worktree: null; error: string }> {
  const store = useWorktreesStore.getState()
  // Refresh first: the taken-name lists have to reflect the repo as it is now,
  // not as it was when the branch popup was last opened.
  await store.refresh(repoPath)
  const repo = repoWorktrees(useWorktreesStore.getState(), repoPath)

  const { folder, branch } = branchNameFor({
    title,
    prefix: useWorktreesStore.getState().branchPrefix,
    takenBranches: repo.branches.map((b) => b.name),
    takenFolders: repo.worktrees.filter((w) => !w.isMain).map((w) => workspaceName(w.path)),
  })

  try {
    const worktree = await store.addWorktree(repoPath, folder, {
      kind: 'new',
      base: base.base,
      branch,
      noTrack: base.noTrack,
    })
    return { worktree }
  } catch (error) {
    return {
      worktree: null,
      error: `Couldn't create the branch ${branch} — this session is running in ${workspaceName(repoPath)} instead. ${errorText(error)}`,
    }
  }
}
