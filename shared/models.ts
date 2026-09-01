/** App-level domain types shared between main and renderer. */
import { type ExtensionUIRequest, type PiEvent } from './rpc'

export interface PiHealth {
  ok: boolean
  /** Absolute path to the pi binary, when found. */
  binaryPath?: string
  /** Reported `pi --version`, when runnable. */
  version?: string
  /** Minimum version pidex supports. */
  minVersion: string
  reason?: 'not-found' | 'version-check-failed' | 'too-old'
  message?: string
}

export interface WorkspaceInfo {
  /** Absolute folder path. Doubles as the workspace id. */
  path: string
  name: string
  lastOpenedAt: number
}

/** Options for creating/attaching a live pi session (subprocess). */
export interface CreateSessionOptions {
  workspacePath: string
  /** Resume an existing session file. */
  sessionPath?: string
  /** Fork from an existing session file/id. */
  forkFrom?: string
  /** Display name for new sessions. */
  name?: string
  model?: string
  provider?: string
  thinkingLevel?: string
}

/** A live session handle as reported by main. */
export interface LiveSessionInfo {
  /** pidex-side id used for IPC channels (not pi's session id). */
  sessionId: string
  workspacePath: string
  pid?: number
}

/**
 * One live session as reported to a freshly loaded renderer, so a reload can
 * re-adopt the pi subprocesses it orphaned instead of stranding ~200 MB each.
 * `diskPath` comes from the fleet hub (which asks `get_state` itself) and can
 * be briefly absent for a session that just spawned.
 */
export interface AdoptableSession extends LiveSessionInfo {
  diskPath?: string
  isOrchestrator: boolean
}

/** Pushed on the per-session event channel. */
export type SessionPush =
  | { kind: 'event'; event: PiEvent }
  | { kind: 'extension-ui'; request: ExtensionUIRequest }
  | { kind: 'stderr'; text: string }
  | { kind: 'exit'; code: number | null; signal: string | null; expected: boolean }
  /**
   * A message main sent into this session on someone else's behalf (today:
   * the orchestrator). pi persists it either way, but the renderer only paints
   * messages it added itself — without this the transcript of a session being
   * steered stays silent until it is reopened. See docs/orchestration.md,
   * "the visible-hand rule".
   */
  | { kind: 'injected'; text: string; source: 'orchestrator' }
  /**
   * Main reclaimed this session's idle pi subprocess (the session reaper).
   * The transcript is on disk and reopening resumes it; the renderer's job is
   * local cleanup plus marking the sidebar row suspended — the process is
   * already gone, so it must NOT call `pi:disposeSession` again.
   */
  | { kind: 'reaped'; diskPath?: string; workspacePath: string }

/** Parsed metadata for one on-disk session file (sidebar row + stats). */
export interface SessionMeta {
  path: string
  sessionId: string
  cwd: string
  createdAt: string
  parentSession?: string
  /** Id of the first entry after the header; see `dropSupersededSessions`. */
  firstEntryId?: string
  name?: string
  firstUserText?: string
  userMessages: number
  assistantMessages: number
  toolCalls: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
  entryCount: number
  branchCount: number
  mtimeMs: number
  lastActivityAt: string
}

/**
 * Latest attempt to scan a workspace's session directory.
 *
 * Absent = never attempted. `ok` = the newest `sessions:list` resolved
 * (possibly to zero sessions); `error` = the newest attempt threw, so the
 * sidebar must not claim the folder is empty.
 */
export type SessionScanStatus = 'ok' | 'error'

export interface WorkspaceSessionStats {
  sessionCount: number
  messages: number
  tokens: number
  cost: number
  activeDays: number
  /** ISO day (YYYY-MM-DD) → activity count. */
  activityByDay: Record<string, number>
}

export interface GitInfo {
  isRepo: boolean
  branch?: string
  ahead?: number
  behind?: number
  dirtyCount?: number
  /** True when the cwd is a linked git worktree (git-dir ≠ common-dir). */
  isWorktree?: boolean
  /** The main repository's working directory, when this is a worktree. */
  mainRepoPath?: string
}

/** One entry from `git worktree list`, enriched with dirty state. */
export interface WorktreeInfo {
  /** Path as git recorded it at `worktree add` time. */
  path: string
  /** `realpathSync.native`-resolved path — matches session cwds. */
  realPath: string
  branch: string | null
  head: string
  isMain: boolean
  locked: boolean
  prunable: boolean
  /** `git status --porcelain` line count; −1 when the dir is missing. */
  dirtyCount: number
}

export interface BranchInfo {
  name: string
  isCurrent: boolean
  /** Worktree that has this branch checked out, if any. */
  worktreePath?: string
  lastCommitSubject?: string
  lastCommitAt?: number
  /** Upstream ref (`origin/main`), absent when the branch never had one. */
  upstream?: string
  /** Commits this branch has that its upstream does not. */
  ahead?: number
  /** Commits the upstream has that this branch does not — "out of date". */
  behind?: number
  /**
   * Commits the repo's default branch has that this one does not. Absent when
   * git is too old for `%(ahead-behind:)` (< 2.41), which the UI treats the
   * same as "unknown", never as zero.
   */
  behindDefault?: number
}

export type AddWorktreeBranch =
  | {
      kind: 'new'
      base: string
      /**
       * Branch to create, when it must differ from the worktree folder name.
       * Auto-created session branches carry a configurable prefix (`pidex/…`)
       * that cannot appear in the folder name — the folder's basename is what
       * names the sidebar group, and a `/` in it would nest the checkout.
       * Absent means "same as the folder name", the hand-created case.
       */
      branch?: string
      /**
       * Skip `git`'s automatic upstream setup. Set when `base` is a
       * remote-tracking ref: without it the new branch would take `origin/main`
       * as its upstream, so its ahead/behind counts would be measured against
       * trunk and a stray `git push` would aim at main.
       */
      noTrack?: boolean
    }
  | { kind: 'existing'; branch: string }

/**
 * Where a new session branch should start from: the freshest trunk this repo
 * can offer without touching the main tree's checkout.
 */
export interface StartPoint {
  /** Ref to branch from — `origin/main` when fetched, else local `main`. */
  base: string
  /** Trunk's local branch name (`main`, `master`, …). */
  defaultBranch: string
  /** True when `base` is a remote-tracking ref (implies `noTrack` on create). */
  fromRemote: boolean
}

/** `git fetch --prune`, which is allowed to be a no-op or to fail quietly. */
export type FetchResult =
  | { fetched: true; at: number }
  /** Skipped: a fetch for this repo already ran inside the throttle window. */
  | { fetched: false; reason: 'throttled'; at: number }
  /** Offline, no remote, or no credentials — all ordinary, never an error. */
  | { fetched: false; reason: 'failed'; message: string }

/** Fast-forward-only pull. Never writes a merge commit, never conflicts. */
export type PullResult =
  | { pulled: true; upstream: string; commits: number }
  | { pulled: false; reason: 'up-to-date'; upstream: string }
  | { pulled: false; reason: 'no-upstream' }
  | { pulled: false; reason: 'diverged'; upstream: string; ahead: number; behind: number }
  | { pulled: false; reason: 'dirty'; dirtyCount: number }

/** Merging trunk into a worktree branch. Conflicts abort, never linger. */
export type UpdateFromMainResult =
  | { updated: true; commits: number; sha: string }
  | { updated: false; reason: 'up-to-date' }
  | { updated: false; reason: 'dirty'; dirtyCount: number }
  | { updated: false; reason: 'conflict'; conflicts: string[] }

/** Checking a branch out in a working tree, guarded on dirty/held. */
export type CheckoutResult =
  | { checkedOut: true; branch: string }
  | { checkedOut: false; reason: 'dirty'; dirtyCount: number }
  | { checkedOut: false; reason: 'held'; worktreePath: string }

/** Summary of a PR's status checks, from `gh` statusCheckRollup. */
export interface GhChecks {
  passed: number
  failed: number
  pending: number
  total: number
}

/**
 * A pull request for the current branch, as reported by the `gh` CLI.
 * Absent (null) whenever gh is missing, unauthenticated, or the repo has no
 * GitHub remote — all normal states, never surfaced as errors.
 */
export interface GhPullRequest {
  number: number
  title: string
  state: 'OPEN' | 'DRAFT' | 'CLOSED' | 'MERGED'
  url: string
  mergeable?: string
  mergeStateStatus?: string
  checks?: GhChecks
  /**
   * Review verdict. Distinct from `checks`: a PR can be fully green and still
   * blocked on a human, which is a different action for the reader than a red
   * build, so the sidebar chip renders the two differently.
   */
  reviewDecision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED'
}

export interface DirEntry {
  name: string
  path: string
  relativePath: string
  isDirectory: boolean
}

export interface FileContent {
  path: string
  content: string
  size: number
  mtimeMs: number
  tooLarge?: boolean
  binary?: boolean
}

export type ThemePreference = 'light' | 'dark' | 'system'

export interface FontPrefs {
  /** Page-zoom multiplier for the whole UI (1 = 100%). */
  uiScale: number
  chatFontSize: number
  editorFontSize: number
  terminalFontSize: number
  /** Mono font family name (bundled options). */
  monoFont: string
}

/**
 * UI-scale bounds. Shared so the settings field, the zoom shortcuts and the
 * main process that actually applies the zoom cannot drift apart.
 */
export const UI_SCALE_MIN = 0.7
export const UI_SCALE_MAX = 2

export function clampUiScale(factor: number): number {
  if (!Number.isFinite(factor)) return 1
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, factor))
}

export const DEFAULT_FONT_PREFS: FontPrefs = {
  uiScale: 1,
  chatFontSize: 14.5,
  editorFontSize: 12.5,
  terminalFontSize: 12.5,
  monoFont: 'JetBrains Mono',
}

/**
 * How new chats relate to git branches.
 *
 * `auto` is the same switch the branch popup's "worktree" checkbox flips — one
 * persisted preference, not two that can disagree: it decides both whether
 * picking a branch isolates it and whether a new chat gets a branch of its own.
 */
/**
 * How a lane names itself, brands itself and slugs its branch.
 *
 * Split from `WorktreePrefs` on purpose: those two fields decide WHETHER a
 * chat gets a branch, while these decide what the resulting lane looks like.
 * A user who turns worktrees off still names sessions.
 */
export interface LanePrefs {
  /**
   * Emoji markers in the sidebar.
   * - `auto`   every lane has one; unset lanes derive theirs from the branch
   * - `manual` only lanes you explicitly chose a marker for
   * - `off`    no marker column at all
   */
  markers: 'auto' | 'manual' | 'off'
  /** Name a session from its first message. Off means it keeps that message. */
  autoName: boolean
  /** Word range the namer is asked for. */
  nameMinWords: number
  nameMaxWords: number
  /** Hard cap on the generated title, applied after the model replies. */
  nameMaxLength: number
  /**
   * Hard cap on the branch/folder slug. Separate from `nameMaxLength`: a title
   * is read in a sidebar, a slug is read in `git branch` output and in a path.
   */
  branchSlugMaxLength: number
  /**
   * Show each lane's GitHub PR status (open, checks, review, merged,
   * conflicts) in place of its session cost. Off reverts to cost, matching
   * pidex's behaviour before the PR chip existed.
   */
  prStatus: boolean
}

/** Bounds the settings UI enforces, and the store clamps to. */
export const LANE_PREF_LIMITS = {
  nameWords: { min: 1, max: 12 },
  nameMaxLength: { min: 16, max: 120 },
  branchSlugMaxLength: { min: 12, max: 80 },
} as const

export const DEFAULT_LANE_PREFS: LanePrefs = {
  markers: 'auto',
  autoName: true,
  nameMinWords: 2,
  nameMaxWords: 5,
  nameMaxLength: 60,
  branchSlugMaxLength: 40,
  prStatus: true,
}

/**
 * Clamp anything read off disk or sent over IPC.
 *
 * Prefs are user-editable JSON, and every one of these numbers ends up in a
 * prompt, a git ref or a path. A negative or absurd value must not reach any
 * of those.
 */
export function normalizeLanePrefs(input: Partial<LanePrefs> | undefined): LanePrefs {
  const merged = { ...DEFAULT_LANE_PREFS, ...input }
  const clamp = (value: number, lo: number, hi: number, fallback: number): number =>
    Number.isFinite(value) ? Math.min(hi, Math.max(lo, Math.round(value))) : fallback
  const minWords = clamp(
    merged.nameMinWords,
    LANE_PREF_LIMITS.nameWords.min,
    LANE_PREF_LIMITS.nameWords.max,
    DEFAULT_LANE_PREFS.nameMinWords,
  )
  return {
    markers: (['auto', 'manual', 'off'] as const).includes(merged.markers)
      ? merged.markers
      : DEFAULT_LANE_PREFS.markers,
    autoName: Boolean(merged.autoName),
    nameMinWords: minWords,
    // Never let max fall below min, or the prompt asks for "5-2 words".
    nameMaxWords: Math.max(
      minWords,
      clamp(
        merged.nameMaxWords,
        LANE_PREF_LIMITS.nameWords.min,
        LANE_PREF_LIMITS.nameWords.max,
        DEFAULT_LANE_PREFS.nameMaxWords,
      ),
    ),
    nameMaxLength: clamp(
      merged.nameMaxLength,
      LANE_PREF_LIMITS.nameMaxLength.min,
      LANE_PREF_LIMITS.nameMaxLength.max,
      DEFAULT_LANE_PREFS.nameMaxLength,
    ),
    branchSlugMaxLength: clamp(
      merged.branchSlugMaxLength,
      LANE_PREF_LIMITS.branchSlugMaxLength.min,
      LANE_PREF_LIMITS.branchSlugMaxLength.max,
      DEFAULT_LANE_PREFS.branchSlugMaxLength,
    ),
    prStatus: Boolean(merged.prStatus),
  }
}

export interface WorktreePrefs {
  /** New chats start on their own branch in their own worktree. */
  auto: boolean
  /**
   * Prepended to auto-generated branch names. `pidex/session-naming` keeps
   * generated branches sorted together and away from hand-made ones. Empty is
   * allowed and means "no prefix".
   */
  branchPrefix: string
}

export const DEFAULT_WORKTREE_PREFS: WorktreePrefs = {
  auto: true,
  branchPrefix: 'pidex/',
}

// ---------- orchestration (docs/orchestration.md) ----------

/**
 * What a live session is doing, as observed mechanically in main. No model is
 * involved in producing this — it is a projection of pi's own event stream.
 */
export type FleetPhase = 'streaming' | 'awaiting-input' | 'idle' | 'error' | 'exited'

/** A clarifying question a session is blocked on, mirrored from extension UI. */
export interface FleetQuestion {
  requestId: string
  method: 'select' | 'confirm' | 'input'
  title: string
  message?: string
  options?: string[]
  askedAt: number
}

export interface FleetSession {
  /** pidex-side live session id. */
  sessionId: string
  workspacePath: string
  /**
   * The project this session belongs to: its repo's main working tree, or its
   * own cwd when that is unknown.
   *
   * Load-bearing, not cosmetic. pidex gives most chats their own git worktree,
   * so `workspacePath` is usually a folder under `.pidex/worktrees/` that
   * matches no project path exactly — grouping on it made a project's own
   * orchestrator report "no sessions are running" while several were.
   */
  projectRoot?: string
  /** Session file, once `get_state` has reported it. */
  diskPath?: string
  title?: string
  phase: FleetPhase
  /** Last assistant prose line, truncated. */
  lastLine?: string
  /** Tool executing right now, if any. */
  currentTool?: string
  /**
   * Paths this session's tools touched. Best-effort — harvested from tool
   * arguments, so it is a signal and never a claim. Bounded; see FILES_TOUCHED_CAP.
   */
  filesTouched: string[]
  pendingQuestion?: FleetQuestion
  lastActivityAt: number
  /** When the session went idle; powers "waiting 14 min". */
  idleSince?: number
  turns: number
  isOrchestrator: boolean
}

export interface FleetSnapshot {
  sessions: FleetSession[]
  updatedAt: number
}

/** Upper bound on remembered paths per session, so the hub cannot grow forever. */
export const FILES_TOUCHED_CAP = 50

/** One line of a digest the orchestrator published. */
export interface DigestItem {
  kind: 'attention' | 'suggestion' | 'note'
  /** Session file path this item is about, when it is about one. */
  sessionPath?: string
  text: string
  /**
   * Synthesized by the bridge from a per-item `startPrompt` — the model never
   * sends it. `start` is the only kind: `open`, `resume`, `archive` and
   * `merge` sat in this union unproduced and unrendered until 2026-08-30.
   */
  action?: {
    label: string
    kind: 'start'
    payload?: string
  }
}

/**
 * The orchestrator's report on one project. Owned by main (not by the
 * per-session status map) so it survives restarts and renders on the home
 * screen before any orchestrator process exists.
 */
export interface OrchestratorDigest {
  workspacePath: string
  updatedAt: number
  headline: string
  items: DigestItem[]
}

/** Which kind of pass to run. `question` is an ordinary user prompt. */
export type SweepKind = 'brief' | 'review'

/**
 * How much the orchestrator may do on its own.
 *
 * A single axis, from "look but do not touch" to "act unattended". It replaces
 * the old `autopilot` boolean, which conflated two different questions (may it
 * message sessions? may it start them?) into one switch.
 *
 * Enforced in `electron/orchestrator/bridge.ts` at call time, so switching mode
 * takes effect on the very next tool call — no respawn, no stale posture.
 */
export type OrchestratorMode = 'observe' | 'supervise' | 'autopilot'

export const ORCHESTRATOR_MODES: readonly OrchestratorMode[] = ['observe', 'supervise', 'autopilot']

export interface OrchestratorModeInfo {
  label: string
  /** One line, shown in the picker. */
  summary: string
}

export const ORCHESTRATOR_MODE_INFO: Record<OrchestratorMode, OrchestratorModeInfo> = {
  observe: {
    label: 'Observe',
    summary: 'Read and report only. Cannot message, stop or start sessions.',
  },
  supervise: {
    label: 'Supervise',
    summary: 'May message, stop and unblock sessions. Proposes new work; never starts it.',
  },
  autopilot: {
    label: 'Autopilot',
    summary: 'May also start new sessions unattended, up to the cap.',
  },
}

export interface OrchestratorWorkspacePrefs {
  /** False until the user first opens the orchestrator for this project. */
  enabled: boolean
  /** How much it may do on its own. See OrchestratorMode. */
  mode: OrchestratorMode
  /** Cap on autopilot-started live sessions. */
  maxConcurrent: number
  /**
   * Model for the FIRST spawn only. After that the orchestrator's own picker
   * owns it: pi records `model_change` in the session file and restores the
   * model on resume, so the choice persists with no pidex state.
   */
  model?: string
}

export const DEFAULT_ORCHESTRATOR_PREFS: OrchestratorWorkspacePrefs = {
  enabled: false,
  mode: 'supervise',
  maxConcurrent: 2,
}

/**
 * Read a mode off stored prefs, migrating the pre-modes `autopilot` boolean.
 *
 * Prefs are persisted electron-store JSON, so old installs carry
 * `{ autopilot: true|false }` and no `mode`. Defaulting those to `supervise`
 * silently would DOWNGRADE someone who had autopilot on, so the boolean maps
 * across explicitly.
 */
export function orchestratorModeOf(
  prefs: Partial<OrchestratorWorkspacePrefs> & { autopilot?: boolean },
): OrchestratorMode {
  if (prefs.mode && ORCHESTRATOR_MODES.includes(prefs.mode)) return prefs.mode
  if (prefs.autopilot === true) return 'autopilot'
  return DEFAULT_ORCHESTRATOR_PREFS.mode
}

/** May the orchestrator message, stop or answer sessions in this mode? */
export function modeAllowsSessionControl(mode: OrchestratorMode): boolean {
  return mode !== 'observe'
}

/** May the orchestrator start work itself in this mode? */
export function modeAllowsStartingWork(mode: OrchestratorMode): boolean {
  return mode === 'autopilot'
}

/**
 * Session names carry this prefix so an orchestrator session stays
 * identifiable when the prefs pointer is lost (fresh machine, cleared prefs).
 * Deliberately a visible glyph rather than a hidden marker — a user browsing
 * their pi sessions outside pidex should be able to tell what it is.
 */
export const ORCHESTRATOR_NAME_PREFIX = '✳ Orchestrator'

/**
 * The idle-session reaper's policy. Both conditions must hold before a
 * session's pi subprocess is reclaimed: the live count is over
 * `maxLiveSessions` AND the candidate has been idle longer than
 * `idleGraceMinutes`. Either alone is wrong — the cap alone can take a
 * session the user touched seconds ago, the grace alone leaves ten rotating
 * lanes holding ~2 GB.
 */
export interface SessionReaperPrefs {
  enabled: boolean
  maxLiveSessions: number
  idleGraceMinutes: number
}

export const DEFAULT_SESSION_REAPER_PREFS: SessionReaperPrefs = {
  enabled: true,
  maxLiveSessions: 4,
  idleGraceMinutes: 15,
}

export const SESSION_REAPER_LIMITS = {
  maxLiveSessions: { min: 1, max: 32 },
  idleGraceMinutes: { min: 1, max: 24 * 60 },
} as const

/** Clamp anything read off disk or sent over IPC; these gate process kills. */
export function normalizeSessionReaperPrefs(
  input: Partial<SessionReaperPrefs> | undefined,
): SessionReaperPrefs {
  const merged = { ...DEFAULT_SESSION_REAPER_PREFS, ...input }
  const clamp = (value: number, lo: number, hi: number, fallback: number): number =>
    Number.isFinite(value) ? Math.min(hi, Math.max(lo, Math.round(value))) : fallback
  return {
    enabled: Boolean(merged.enabled),
    maxLiveSessions: clamp(
      merged.maxLiveSessions,
      SESSION_REAPER_LIMITS.maxLiveSessions.min,
      SESSION_REAPER_LIMITS.maxLiveSessions.max,
      DEFAULT_SESSION_REAPER_PREFS.maxLiveSessions,
    ),
    idleGraceMinutes: clamp(
      merged.idleGraceMinutes,
      SESSION_REAPER_LIMITS.idleGraceMinutes.min,
      SESSION_REAPER_LIMITS.idleGraceMinutes.max,
      DEFAULT_SESSION_REAPER_PREFS.idleGraceMinutes,
    ),
  }
}

export interface AppPrefs {
  theme: ThemePreference
  recentWorkspaces: WorkspaceInfo[]
  /** Most recently used workspace — where the app lands with no session. */
  lastWorkspacePath?: string
  /**
   * Session file (.jsonl) that was open when the app last closed. Restored on
   * launch so pidex reopens where you left off rather than at the picker.
   */
  lastSessionPath?: string
  /** Pinned session file paths. */
  pinnedSessions: string[]
  /**
   * Model picker memory, keyed `provider/id` (the same identity the picker
   * uses — a model is only ever "the same" if the route to it is too).
   */
  modelPicks: ModelPicks
  /** Sidebar workspace groups the user collapsed, by workspace path. */
  collapsedWorkspaces: string[]
  /**
   * Session file path → epoch ms when the user last viewed it. Powers the
   * sidebar's "unseen activity" pill; pruned to a bounded size in the store.
   */
  seenSessions: Record<string, number>
  /**
   * Session file path → chosen lane marker. Only EXPLICIT choices are stored;
   * every other lane derives its marker from its branch (`lib/laneMarker.ts`),
   * so this map stays small and is safe to prune. An empty string is a real
   * value meaning "no marker, on purpose".
   */
  laneMarkers: Record<string, string>
  /** How lanes name and brand themselves. See LanePrefs. */
  lanes: LanePrefs
  fonts: FontPrefs
  /** What pidex appends to every lane's system prompt. */
  agentDirectives: AgentDirectivePrefs
  /** Per-project override of the above, keyed by main-repo path. */
  agentDirectivesByProject: Record<string, AgentDirectivePrefs>
  worktrees: WorktreePrefs
  /** Orchestrator settings per main-repo path. */
  orchestrator: Record<string, OrchestratorWorkspacePrefs>
  /**
   * Main-repo path → the orchestrator's session FILE path. Doubles as the
   * resume target, so the same thread comes back across restarts.
   */
  orchestratorSessions: Record<string, string>
  /** Last digest per main-repo path, so home renders before anything spawns. */
  orchestratorDigests: Record<string, OrchestratorDigest>
  /** Suppress orchestrator desktop notifications. */
  notificationsMuted: boolean
  /**
   * Claude Code auto-compact window for pi-claude-cli sessions, passed as
   * `PI_CLAUDE_CLI_AUTOCOMPACT` when a session spawns. Empty string means
   * "the provider's default" (200k as of pi-claude-cli 0.5.0). Other accepted
   * values mirror the provider: a window from 100k to 1M (`400k`, `400000`,
   * bare `400` = thousands), `auto` (the CLI's own default — effectively the
   * model's full 1M window), or `off` (omit the flag, for CLIs that predate
   * `--autocompact`). The provider validates again and falls back to its
   * default rather than passing a bad value to the CLI.
   */
  claudeAutocompact: string
  /** Idle-session reaper policy. See SessionReaperPrefs. */
  sessionReaper: SessionReaperPrefs
  /**
   * Unsent composer drafts, keyed by `session:<pidexId>` or
   * `home:<workspacePath>`.
   *
   * Both composers used to keep their text and pending attachments in local
   * `useState`, and `ChatView` is keyed on the active session id — so
   * switching session unmounted the subtree and threw the draft away with no
   * warning, and quitting did the same. Image BYTES are not in here: they go
   * to `userData/drafts/` and are referenced by `blobId`, because a 5 MB paste
   * re-serialised into config.json on every keystroke is not a pref, it is a
   * problem.
   */
  drafts: Record<string, ComposerDraftRecord>
}

/** One pending attachment inside a persisted draft. */
export interface DraftAttachment {
  kind: 'image' | 'file'
  name: string
  size: number
  /** kind 'file': the absolute path the agent is told to open. */
  path?: string
  /** kind 'image': file under `userData/drafts/`. */
  blobId?: string
  mimeType?: string
}

/** A composer's unsent state, durable across session switches and restarts. */
export interface ComposerDraftRecord {
  key: string
  text: string
  attachments: DraftAttachment[]
  /**
   * The model chosen for THIS draft. The home picker also writes pi's global
   * default, but coming back to a draft should restore the model you picked
   * for it rather than whatever the last session set globally.
   */
  model?: { provider: string; id: string }
  thinking?: string
  workspacePath?: string
  preferWorktree?: boolean
  updatedAt: number
}

/** Drafts kept per key; the oldest are pruned past this. */
export const MAX_DRAFTS = 30

/** Total bytes of draft image blobs allowed on disk. */
export const MAX_DRAFT_BLOB_BYTES = 50 * 1024 * 1024

/**
 * Layer 2 of the directive stack: what pidex appends to a lane's system
 * prompt. See `electron/pi/directives.ts` for the full stack and why this is
 * a setting rather than a constant.
 *
 * Global by default with a per-project override, because the right contents
 * depend on the repo AND on which model the lane runs: Anthropic's frontier
 * models now ship a system prompt roughly 70-80% shorter than the previous
 * generation, and a mixed fleet needs a lean profile and a fuller one.
 */
export interface AgentDirectivePrefs {
  /**
   * The worktree working-directory block. On by default and worth keeping:
   * it is the reason a whole class of confident wrong-branch answers stopped
   * (session 01a02ca0 read a copy 19 commits behind main and recommended
   * building a feature that already existed in its own worktree).
   */
  worktreeGuard: boolean
  /** The lane charter: this is a lane, it owns a branch, it ends in a PR. */
  laneCharter: boolean
  /**
   * The sub-agent policy block.
   *
   * On by default because the default is the unsafe one. A Claude Code
   * sub-agent launches in the BACKGROUND unless the caller passes
   * `run_in_background: false`, and the CLI is a per-turn model server that
   * exits when the turn's answer is done — so a backgrounded agent is killed
   * mid-flight and its findings never reach the model that asked for them.
   * Observed 2026-08-27: one lane launched five, they spawned two more, and
   * all seven died at the same millisecond having spent 28.6M tokens on work
   * nobody ever read. A synchronous sub-agent completes inside the turn and
   * returns normally (verified against `claude -p`), so this block asks for
   * the form that works rather than banning the tool.
   */
  subagentPolicy: boolean
  /** Free text appended last, so it can qualify either block above. */
  custom: string
}

export const DEFAULT_AGENT_DIRECTIVES: AgentDirectivePrefs = {
  worktreeGuard: true,
  laneCharter: true,
  subagentPolicy: true,
  custom: '',
}

/** Starred and recently used models, keyed `provider/id`, plus how to group them. */
export interface ModelPicks {
  /** User-ordered; these sort to the top of the picker. */
  starred: string[]
  /** Most-recent-first, bounded by {@link MAX_RECENT_MODELS}. */
  recent: string[]
  /**
   * Whether the idle picker buckets by model family ("which Opus 5?") or by
   * provider ("what do I have from whom?"). Persisted because it is a habit,
   * not a per-open decision.
   */
  groupMode: 'family' | 'provider'
}

/**
 * How many recent models to remember. Long enough to cover the handful anyone
 * rotates between, short enough that the "Recent" section stays a shortcut
 * rather than a second copy of the catalogue.
 */
export const MAX_RECENT_MODELS = 8

export const DEFAULT_MODEL_PICKS: ModelPicks = { starred: [], recent: [], groupMode: 'family' }

export const DEFAULT_APP_PREFS: AppPrefs = {
  theme: 'dark',
  recentWorkspaces: [],
  pinnedSessions: [],
  modelPicks: DEFAULT_MODEL_PICKS,
  collapsedWorkspaces: [],
  seenSessions: {},
  laneMarkers: {},
  lanes: DEFAULT_LANE_PREFS,
  fonts: DEFAULT_FONT_PREFS,
  agentDirectives: DEFAULT_AGENT_DIRECTIVES,
  agentDirectivesByProject: {},
  worktrees: DEFAULT_WORKTREE_PREFS,
  orchestrator: {},
  orchestratorSessions: {},
  orchestratorDigests: {},
  notificationsMuted: false,
  claudeAutocompact: '',
  sessionReaper: DEFAULT_SESSION_REAPER_PREFS,
  drafts: {},
}

/** Minimum pi version pidex is verified against. */
export const MIN_PI_VERSION = '0.84.1'

/**
 * Health of one pi config file. `malformed` distinguishes "present but
 * unparseable" from "absent", which matters before writing: merging a patch
 * onto a failed read would silently discard the user's configuration.
 */
export interface ConfigFileHealth {
  exists: boolean
  malformed: boolean
  error?: string
}

/** Health of the global and per-project pi config files. */
export interface AgentSettingsHealth {
  global: ConfigFileHealth
  project: ConfigFileHealth | null
}

/** Runtime and version info for the About tab. */
export interface AboutInfo {
  appVersion: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
}

/** Native save-dialog options. */
export interface SaveDialogOptions {
  title?: string
  defaultPath?: string
  filters?: { name: string; extensions: string[] }[]
}

/** Local (non-package) resources discovered in pi's agent directory. */
export interface PiResources {
  skills: string[]
  extensions: string[]
  prompts: string[]
  themes: string[]
}

// ---------- pi packages ----------

/** Resources a pi package provides, by kind (file/dir names for display). */
export interface PiPackageResources {
  extensions: string[]
  skills: string[]
  prompts: string[]
  themes: string[]
}

/** One entry of a settings.json `packages` array, enriched from disk. */
export interface PiPackageEntry {
  /** The spec as written in settings (string form of the object form's `source`). */
  spec: string
  scope: 'global' | 'project'
  kind: 'npm' | 'git' | 'path'
  /** True when the settings entry is the object form with resource filters. */
  filtered: boolean
  /** Display name: npm package name, git repo, or path basename. */
  name: string
  version?: string
  description?: string
  /** Whether the resolved install directory exists on disk. */
  installed: boolean
  installPath?: string
  resources: PiPackageResources
}

export type PackageJobAction = 'install' | 'remove' | 'update'

/** Local `claude auth status` result (no network round-trip). */
export interface ClaudeAuthStatus {
  ok: boolean
  loggedIn?: boolean
  method?: string
  email?: string
  /** `subscriptionType`, e.g. `pro` / `max` / `team`. Which plan pays. */
  plan?: string
  /** `orgName` — present for team/enterprise logins, the giveaway for a wrong account. */
  organization?: string
  error?: string
}

/** Claude Code CLI health for the provider tab. */
export interface ClaudeStatus {
  binary: { found: boolean; path?: string; version?: string }
  auth: ClaudeAuthStatus
}

/**
 * One plan-usage window, as the CLI renders it in `claude -p /usage`.
 *
 * The CLI prints Claude Desktop's own live numbers (fed by the internal
 * `/api/oauth/usage` endpoint) as text; these are the parsed windows of that
 * text. The percent is the server's own accounting — always visible, not
 * gated on any warning threshold like `rate_limit_event`'s `utilization`.
 */
export interface ClaudeUsageWindow {
  /** The CLI's rendered label, e.g. "Current session" (the 5-hour block). */
  label: string
  /** Window family, derived from the label; `other` for kinds pidex doesn't know. */
  kind: 'five_hour' | 'weekly' | 'weekly_model' | 'other'
  /** Fraction of the window consumed, 0–100 (the CLI prints whole percents). */
  percentUsed: number
  /** When the window resets, Unix ms; null when the reset didn't parse. */
  resetsAt: number | null
}

/** Result of one `claude -p /usage` run. */
export interface ClaudeUsageSnapshot {
  fetchedAt: number
  /** True when the CLI served its cache ("Showing last-known usage"). */
  stale: boolean
  windows: ClaudeUsageWindow[]
  /** The "What's contributing to your limits usage?" block, verbatim, when present. */
  contributing: string | null
}

/** `claude:usageSnapshot` channel result. */
export type ClaudeUsageSnapshotResult =
  | { ok: true; snapshot: ClaudeUsageSnapshot }
  | { ok: false; error: 'claude-not-found' | 'run-failed' | 'no-usage' }

/**
 * Where an in-app `claude auth login` has got to.
 *
 * Deliberately not `LoginFlowState`: this is a different flow with a different
 * shape. pi's OAuth providers hand off to a browser and finish by themselves,
 * while the Claude CLI's handshake redirects to a page that shows a code the
 * user must paste back — so `awaiting-code` is a state the UI must collect
 * input in, not just wait in. See `electron/pi/claude-login.ts`.
 */
export type ClaudeLoginState =
  | { phase: 'starting' }
  | {
      phase: 'awaiting-code'
      /** Authorization page. The CLI already opened it; this is the fallback link. */
      url: string
      /** The previous code was rejected and this URL is its replacement. */
      invalidCode?: boolean
    }
  /** Code submitted; waiting on the CLI to write credentials. */
  | { phase: 'finishing' }
  | { phase: 'signed-in'; email?: string }
  | { phase: 'cancelled' }
  | { phase: 'error'; message: string }

// ---------- subscription accounts ----------

/**
 * A provider pi can sign into with a consumer subscription rather than an
 * API key. The list is pidex's, not pi's: pi exposes no way to enumerate its
 * OAuth providers over RPC or the CLI, so these are curated from pi's
 * providers doc and each id is verified against `pi auth check`.
 */
/**
 * Providers pi offers under "Sign in with an account", as of pi 0.84.1.
 *
 * Read off pi's own login screen rather than guessed: pi exposes no way to
 * enumerate these (no CLI, no RPC, and the provider registry is not a package
 * export), so this list is maintained by hand and WILL drift as pi adds
 * providers. `pi auth check --provider <id>` answers `provider_not_found` for
 * an id pi does not know, which surfaces as "unknown" rather than a crash.
 */
export type LoginProviderId =
  | 'anthropic'
  | 'openai-codex'
  | 'github-copilot'
  | 'kimi-for-coding'
  | 'openrouter'
  | 'radius'
  | 'xai'

/** Where a sign-in has got to. Drives the whole Accounts UI. */
/**
 * Progress of a headless MCP connector authorization
 * (`electron/pi/connector-auth.ts`).
 *
 * Deliberately not `LoginFlowState`: this flow is owned by the MCP adapter
 * inside a throwaway pi process, and its only interactive step is a browser
 * round-trip whose fallback is pasting the callback URL back.
 */
export type ConnectorAuthState =
  | { phase: 'starting' }
  /** The adapter produced an authorization URL; main already opened it. */
  | { phase: 'awaiting-browser'; authorizationUrl: string }
  | { phase: 'connected' }
  | { phase: 'failed'; message: string }

/** One `mcp:authState` push. */
export interface ConnectorAuthPush {
  serverName: string
  state: ConnectorAuthState
}

export type LoginFlowState =
  | { providerId: LoginProviderId; phase: 'starting' }
  /** pi produced a device-code URL; the user finishes in their browser. */
  | {
      providerId: LoginProviderId
      phase: 'awaiting-browser'
      url: string
      /** Device code to type on the provider's page. */
      userCode?: string
    }
  | { providerId: LoginProviderId; phase: 'signed-in' }
  | { providerId: LoginProviderId; phase: 'cancelled' }
  | { providerId: LoginProviderId; phase: 'error'; message: string }

export interface SubscriptionProvider {
  /** pi's provider id — the key in `auth.json` and `pi auth check --provider`. */
  id: LoginProviderId
  name: string
  /** What the user must already be paying for. */
  requires: string
  /**
   * What signing in actually spends. The distinction matters enough to sort
   * the list by: a plan you already pay for is free to use here, while a
   * balance is charged per token even though the sign-in looks identical.
   */
  billing: 'subscription' | 'balance'
  /** Anything the user should know before signing in. Rendered verbatim. */
  caveat?: string
}

/**
 * One provider's readiness, straight from `pi auth check --json`.
 *
 * `status` is pi's own word. `unknown` is pidex's: it means the check could
 * not be run at all (pi missing, spawn failed, unparseable output), which is
 * deliberately distinct from pi answering "not_ready".
 */
export interface SubscriptionProviderStatus extends SubscriptionProvider {
  status: 'ready' | 'not_ready' | 'unknown'
  /** pi's machine-readable reason, e.g. `credentials_not_configured`. */
  reason?: string
  /** Present only when the check itself failed. */
  error?: string
}

// ---------- updater ----------

/**
 * Update lifecycle as the renderer sees it. Mirrors
 * `electron/updates/update-state.ts`, which owns the reducer.
 */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'downloading'
  /** Verifying and expanding the download (macOS self-install only). */
  | 'installing'
  | 'downloaded'
  /** Detected, but this install must be updated by hand (unsigned mac, deb). */
  | 'manual-download'
  /** No update mechanism (dev / unpackaged). */
  | 'unsupported'

export interface UpdateState {
  phase: UpdatePhase
  version?: string
  progressPercent?: number
  releaseUrl?: string
}
