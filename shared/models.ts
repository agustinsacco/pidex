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

export type AddWorktreeBranch = { kind: 'new'; base: string } | { kind: 'existing'; branch: string }

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
