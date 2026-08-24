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
   * steered stays silent until it is reopened. See specs/13-orchestration.md,
   * "the visible-hand rule".
   */
  | { kind: 'injected'; text: string; source: 'orchestrator' }

/** Parsed metadata for one on-disk session file (sidebar row + stats). */
export interface SessionMeta {
  path: string
  sessionId: string
  cwd: string
  createdAt: string
  parentSession?: string
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

/** Rollup of usage across sessions (per workspace and grand total). */
export interface UsageTotals {
  cost: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  messages: number
  toolCalls: number
  sessionCount: number
}

export interface WorkspaceUsage {
  /** The cwd sessions were recorded against (from each session header). */
  workspacePath: string
  sessions: SessionMeta[]
  totals: UsageTotals
}

export interface UsageSummary {
  workspaces: WorkspaceUsage[]
  totals: UsageTotals
}

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

// ---------- orchestration (specs/13-orchestration.md) ----------

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
  action?: {
    label: string
    kind: 'open' | 'resume' | 'archive' | 'merge' | 'start'
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

export interface OrchestratorWorkspacePrefs {
  /** False until the user first opens the orchestrator for this project. */
  enabled: boolean
  /** May mutate sessions and start work without asking. */
  autopilot: boolean
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
  autopilot: false,
  maxConcurrent: 2,
}

/**
 * Session names carry this prefix so an orchestrator session stays
 * identifiable when the prefs pointer is lost (fresh machine, cleared prefs).
 * Deliberately a visible glyph rather than a hidden marker — a user browsing
 * their pi sessions outside pidex should be able to tell what it is.
 */
export const ORCHESTRATOR_NAME_PREFIX = '✳ Orchestrator'

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
  /** Sidebar workspace groups the user collapsed, by workspace path. */
  collapsedWorkspaces: string[]
  /**
   * Session file path → epoch ms when the user last viewed it. Powers the
   * sidebar's "unseen activity" pill; pruned to a bounded size in the store.
   */
  seenSessions: Record<string, number>
  fonts: FontPrefs
  /** Whose system prompt Claude Code sessions run under. */
  claudeSystemPrompt: ClaudeSystemPromptMode
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
}

/**
 * Which system prompt the pi-claude-cli provider gives its `claude`
 * subprocess. Mirrors the extension's `PI_CLAUDE_CLI_SYSTEM_PROMPT`, which
 * pidex sets when spawning pi.
 *
 * `claude` appends pi's prompt to Claude Code's own — everything the CLI
 * normally knows about its tools stays. `pi` replaces it, which frees roughly
 * 12k tokens of context per call but leaves the model working from pi's
 * instructions plus the raw tool schemas.
 */
export type ClaudeSystemPromptMode = 'claude' | 'pi'

export const DEFAULT_APP_PREFS: AppPrefs = {
  theme: 'dark',
  recentWorkspaces: [],
  pinnedSessions: [],
  collapsedWorkspaces: [],
  seenSessions: {},
  fonts: DEFAULT_FONT_PREFS,
  // Matches the extension's own default: keep Claude Code's prompt unless the
  // user opts out of it.
  claudeSystemPrompt: 'claude',
  worktrees: DEFAULT_WORKTREE_PREFS,
  orchestrator: {},
  orchestratorSessions: {},
  orchestratorDigests: {},
  notificationsMuted: false,
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
  error?: string
}

/** Claude Code CLI health for the provider tab. */
export interface ClaudeStatus {
  binary: { found: boolean; path?: string; version?: string }
  auth: ClaudeAuthStatus
}

// ---------- resource monitor ----------

/** One process tree's cost. RSS is in kilobytes, matching `ps rss=`. */
export interface UsageTotal {
  rssKb: number
  /** Percent of ONE core, as `ps %cpu=` reports it (may exceed 100). */
  cpuPercent: number
  processCount: number
}

/** Per-session resource usage, split by what is spending it. */
export interface SessionUsage {
  sessionId: string
  workspacePath: string
  /** The pi subprocess and any tools it spawned. */
  agent: UsageTotal
  /** This session's terminal shells and whatever the user ran in them. */
  terminals: UsageTotal
  /** agent + terminals, de-duplicated by pid. */
  total: UsageTotal
  piPid?: number
}

export interface AppProcessUsage {
  pid: number
  type: string
  name?: string
  rssKb: number
  cpuPercent: number
}

/** One monitor tick. */
export interface ResourceSnapshot {
  /** Epoch ms, stamped in main so every renderer agrees on tick times. */
  at: number
  /**
   * False where per-process sampling is unavailable (Windows has no `ps`).
   * The UI must say so rather than render zeroes as if they were measurements.
   */
  perSessionSupported: boolean
  sessions: SessionUsage[]
  /** pidex's own Electron processes (browser, renderers, GPU, utility). */
  app: {
    rssKb: number
    cpuPercent: number
    processes: AppProcessUsage[]
  }
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
