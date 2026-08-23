import type { WorktreeInfo } from '@shared/models'
import type { ImageContent } from '@shared/rpc'
import { useSessionsStore } from '@/stores/sessions'
import { useNamingStore } from '@/stores/naming'
import { useChatStore } from '@/stores/chat'
import { useWorkspacesStore } from '@/stores/workspaces'
import { repoWorktrees, useWorktreesStore } from '@/stores/worktrees'
import { branchNameFor } from '@/lib/branchName'
import { sessionTitle } from '@/lib/sessionTitle'
import { workspaceName } from '@/lib/path'
import { piCallOk } from '@/lib/rpc'
import { errorText } from '@shared/errors'

/**
 * Starting a chat from the home composer: branch it, run it, name it.
 *
 * A chat that edits files wants its own branch, and pi never titles a session,
 * so pidex asks a one-shot `pi -p` for a name and derives the branch from it —
 * one chat, one branch, one name.
 *
 * The ORDER of those three is the whole design, and it is the opposite of what
 * it was. Naming used to run first, because the branch is named after the
 * title and a pi session is bound to the cwd it spawns in (it records its
 * transcript under a mangling of that path), so there is no moving a live
 * session into a worktree afterwards — the branch genuinely has to exist
 * before pi spawns.
 *
 * But `pi -p` is a whole agent boot: measured at ~6s before the model is even
 * asked anything, ~13s for a real naming prompt. Blocking the send button on
 * that made "new chat" read as a hang, and — because the wait was capped at
 * 12s — the title lost its own race every single time, so every auto-created
 * branch was in fact named after a slug of the first message and the generated
 * name arrived only via a SECOND ~13s call. Two model calls, ~26s, no title.
 *
 * So the dependency is inverted instead: the branch is cut immediately from a
 * slug of the first message, pi spawns and starts inference right away, and
 * the title is generated off the critical path. When it lands it sets the
 * session name and renames the branch to match (`git branch -m` is safe on a
 * branch a worktree has checked out; the folder keeps its slug, because moving
 * it would move a live session's cwd). The names still agree — a few seconds
 * later than before, having actually arrived rather than timed out.
 *
 * Every step still degrades instead of aborting: an unreachable remote falls
 * back to local trunk, a git refusal starts a plain session in the open folder
 * with the reason shown, and a failed naming leaves the slug in place. The
 * user's message is never lost to a failure in any of this.
 */

/**
 * How long the send may wait on `git fetch` before branching off local refs.
 *
 * Bounded because "branch off the *latest* trunk" is a nicety and starting the
 * chat is not: a slow link, a credential prompt or a large repo would
 * otherwise put the whole fetch (30s in main, worst case) back in front of the
 * send button — the exact failure this rewrite exists to remove. The fetch is
 * not cancelled, only stopped being waited on; it lands in time for the next
 * chat.
 */
const FETCH_BUDGET_MS = 3_000

export type StartChatPhase = 'branching' | 'starting'

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
 * transcript streams in on its own after that, and so does the name.
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
  options.onPhase?.('branching')

  const base = await resolveBase(repoPath)
  const created = await createBranchWorktree(repoPath, prompt, base)

  if (!created.worktree) {
    // Git refused (a locked index, a name race, a repo in an odd state). The
    // message is worth more than the branch: start where we are and say why.
    options.onWarning?.(created.error)
    options.onPhase?.('starting')
    const sessionId = await useSessionsStore
      .getState()
      .createSession(workspacePath, { firstPrompt: prompt, firstImages: images })
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
    // The store's own auto-naming pass is suppressed because this flow owns
    // naming end to end: the title has to reach the branch as well as the
    // session, and two independent naming calls would mean two names.
    autoName: false,
  })

  const branch = created.worktree.branch ?? undefined
  // Deliberately not awaited: this is the ~13s call that used to be in front
  // of the send button.
  void nameChat({ sessionId, repoPath, cwd, prompt, branch })

  return { sessionId, workspacePath: cwd, branch }
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
 * Give the running chat its real name, and its branch the same one.
 *
 * Runs after the session is live and streaming, so nothing here is on a user's
 * critical path and every failure is simply "the slug stands". The session
 * name is set first: it is the visible one, and a branch rename that failed
 * must not cost the user their title too.
 */
async function nameChat({
  sessionId,
  repoPath,
  cwd,
  prompt,
  branch,
}: {
  sessionId: string
  repoPath: string
  cwd: string
  prompt: string
  branch?: string
}): Promise<void> {
  // Flagged for the whole operation, branch rename included: the branch chip
  // is one of the surfaces about to change, so it stays marked provisional
  // until there is nothing left to change.
  useNamingStore.getState().start(sessionId, cwd)
  try {
    await applyGeneratedName({ sessionId, repoPath, cwd, prompt, branch })
  } finally {
    useNamingStore.getState().finish(sessionId)
  }
}

/** The naming itself, split out so `nameChat` owns only the pending flag. */
async function applyGeneratedName({
  sessionId,
  repoPath,
  cwd,
  prompt,
  branch,
}: {
  sessionId: string
  repoPath: string
  cwd: string
  prompt: string
  branch?: string
}): Promise<void> {
  const title = await generateTitle(repoPath, cwd, prompt)
  if (!title) return
  // The user may have renamed or closed the chat during those seconds — the
  // same two guards the store's auto-naming pass uses.
  if (useChatStore.getState().sessions[sessionId]?.meta?.sessionName) return
  if (!useSessionsStore.getState().live[sessionId]) return

  if (await piCallOk(sessionId, { type: 'set_session_name', name: title })) {
    useChatStore.getState().patchMeta(sessionId, { sessionName: title })
    void useSessionsStore.getState().refreshDisk(cwd)
  }

  if (!branch) return
  const store = useWorktreesStore.getState()
  await store.refresh(repoPath)
  const repo = repoWorktrees(useWorktreesStore.getState(), repoPath)
  const { branch: renamed } = branchNameFor({
    title,
    prefix: useWorktreesStore.getState().branchPrefix,
    // The chat's current branch is itself in this list; excluding it keeps a
    // title that already slugs to the branch we have from being suffixed "2".
    takenBranches: repo.branches.map((b) => b.name).filter((name) => name !== branch),
    takenFolders: [],
  })
  if (renamed === branch) return
  await store.renameBranch(repoPath, branch, renamed)
  // The sidebar's branch chips read `gitByCwd`, which nothing else invalidates
  // on a rename.
  void useSessionsStore.getState().refreshGitInfo([cwd])
}

/**
 * Ask for a session name.
 *
 * Unbounded on purpose now that it is off the critical path — `pi:generateTitle`
 * already fails soft (null rather than throwing) and the subprocess behind it
 * carries its own 30s timeout in main. The renderer-side race this used to run
 * was a 12s cap on a ~13s call, which is to say a guarantee of no title at all.
 */
async function generateTitle(
  repoPath: string,
  workspacePath: string,
  prompt: string,
): Promise<string | null> {
  const existing = existingTitlesForRepo(repoPath, workspacePath)
  return window.pidex.invoke('pi:generateTitle', workspacePath, prompt, existing).catch(() => null)
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
 * starting several chats in a row costs one network round trip — and it is
 * bounded here (see FETCH_BUDGET_MS) so the one that does go to the network
 * cannot hold the send button. A repo that is offline, has no remote, or has
 * no credentials simply resolves to local trunk.
 */
async function resolveBase(repoPath: string): Promise<{ base: string; noTrack: boolean }> {
  try {
    await withBudget(useWorktreesStore.getState().syncRemote(repoPath), FETCH_BUDGET_MS)
    const point = await window.pidex.invoke('git:startPoint', repoPath)
    return { base: point.base, noTrack: point.fromRemote }
  } catch {
    // `HEAD` is the last resort: whatever trunk is, the main tree is on it.
    return { base: 'HEAD', noTrack: false }
  }
}

/** Wait on `work` for at most `ms`; the work itself keeps running either way. */
async function withBudget(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms)
  })
  try {
    await Promise.race([work.catch(() => undefined), budget])
  } finally {
    clearTimeout(timer)
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
