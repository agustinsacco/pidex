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
   * steered stays silent until it is reopened. See specs/reference/orchestration.md,
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

// ---------- orchestration (specs/reference/orchestration.md) ----------

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

/**
 * The lane loop: the fixed ladder of oracles a lane climbs on its way to a PR.
 *
 * A lane is one unit of work — one charter, one branch, one worktree, one
 * agent process, one exit. The ladder is its *state*, as distinct from the
 * transcript, which is its history. It renders in exactly two places and they
 * are the same component: the right-hand end of a lane row on the fleet
 * surface, and directly above the composer inside the lane.
 *
 * The rung set is fixed per project and its ORDER is fixed too. A ladder whose
 * rungs move is one you have to read; a ladder that never moves is one you can
 * glance at. Same reason a service map never re-lays-out on refresh.
 *
 * **A rung is never filled by anything an agent said.** Only the harness
 * executing the command may set a result, which is the whole point: a model
 * that writes code printing PASS is a documented behaviour, not a hypothesis.
 */
export type LaneRungState =
  /** Not run since the lane's last edit. The honest default. */
  | 'stale'
  /** Ran, exit code matched. */
  | 'pass'
  /** Ran, exit code did not match. */
  | 'fail'
  /** Running right now. */
  | 'running'
  /** No command configured for this rung in this project. */
  | 'unconfigured'

export interface LaneRung {
  /** Stable key: `tsc`, `test`, `lint`, `diff`, `merge`, `pr`. */
  key: string
  /** Short uppercase label for the ladder. */
  label: string
  state: LaneRungState
  /** Exactly what ran, so the state is checkable rather than assertable. */
  command?: string
  exitCode?: number
  /** First line of failure output, for the hint. Never the whole log. */
  detail?: string
  /** When this result was produced. */
  at?: number
  /** Wall-clock of the run, for the ones that get slow. */
  durationMs?: number
}

export interface LaneLoop {
  rungs: LaneRung[]
  /** Lines changed since the lane's baseline, for the diff rung and the header. */
  diff?: { added: number; removed: number; files: number }
  /** Budget the diff rung is measured against. */
  diffBudget?: { lines: number; files: number }
  /** Branch this lane is on, when it has one. */
  branch?: string
  updatedAt: number
}

/**
 * Default ladder. Six rungs, and two of them are oracles nothing else in this
 * market computes:
 *
 * - `diff` fails above the size where measured review effectiveness collapses
 *   (SmartBear/Cisco: detection 87% under 100 lines, 28% over 1,000; useful
 *   comments degrade past ~20 files). An unreviewable change is a failed
 *   acceptance test and the surface should say so before you open it.
 * - `merge` is a `git merge-tree` dry run against the current base, which is
 *   the same replay that measured 27.67% of agent PRs conflicting.
 *
 * `pr` is present from turn one, unfilled. An empty rung is a better standing
 * instruction than a paragraph, because it does not compact away.
 */
export const DEFAULT_LANE_RUNGS: readonly { key: string; label: string }[] = [
  { key: 'tsc', label: 'tsc' },
  { key: 'test', label: 'test' },
  { key: 'lint', label: 'lint' },
  { key: 'diff', label: 'diff' },
  { key: 'merge', label: 'merge' },
  { key: 'pr', label: 'pr' },
]

/** Review-capacity bounds for the `diff` rung. See DEFAULT_LANE_RUNGS. */
export const DEFAULT_DIFF_BUDGET = { lines: 400, files: 20 }

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
  fonts: FontPrefs
  /** Whose system prompt Claude Code sessions run under. */
  claudeSystemPrompt: ClaudeSystemPromptMode
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
  /** Free text appended last, so it can qualify either block above. */
  custom: string
}

export const DEFAULT_AGENT_DIRECTIVES: AgentDirectivePrefs = {
  worktreeGuard: true,
  laneCharter: true,
  custom: '',
}

export type ClaudeSystemPromptMode = 'claude' | 'pi'

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
  fonts: DEFAULT_FONT_PREFS,
  // Matches the extension's own default: keep Claude Code's prompt unless the
  // user opts out of it.
  claudeSystemPrompt: 'claude',
  agentDirectives: DEFAULT_AGENT_DIRECTIVES,
  agentDirectivesByProject: {},
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
