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
  cost: number
  entryCount: number
  branchCount: number
  mtimeMs: number
  lastActivityAt: string
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
}

export type ThemePreference = 'light' | 'dark' | 'system'

export interface AppPrefs {
  theme: ThemePreference
  recentWorkspaces: WorkspaceInfo[]
  lastWorkspacePath?: string
  /** Pinned session file paths. */
  pinnedSessions: string[]
}

export const DEFAULT_APP_PREFS: AppPrefs = {
  theme: 'system',
  recentWorkspaces: [],
  pinnedSessions: [],
}

/** Minimum pi version pidex is verified against. */
export const MIN_PI_VERSION = '0.78.0'
