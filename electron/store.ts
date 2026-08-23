import Store from 'electron-store'
import { pruneSeenSessions } from './prefs-utils'
import {
  DEFAULT_APP_PREFS,
  type AppPrefs,
  type OrchestratorDigest,
  type OrchestratorWorkspacePrefs,
  type ThemePreference,
  type WorkspaceInfo,
} from '@shared/models'

/**
 * Constructed lazily, NOT at module scope.
 *
 * electron-store resolves `userData` the moment it is instantiated, and ES
 * imports are hoisted — a module-scope `new Store()` would run while main.ts
 * is still importing, i.e. before main.ts can redirect userData for E2E runs.
 * That leaked test workspaces into the developer's real prefs. Deferring the
 * construction to first use keeps the redirect effective.
 */
let store: Store<AppPrefs> | null = null

function prefs(): Store<AppPrefs> {
  store ??= new Store<AppPrefs>({ defaults: DEFAULT_APP_PREFS })
  return store
}

export function getPrefs(): AppPrefs {
  const s = prefs()
  return {
    theme: s.get('theme'),
    recentWorkspaces: s.get('recentWorkspaces'),
    lastWorkspacePath: s.get('lastWorkspacePath'),
    lastSessionPath: s.get('lastSessionPath'),
    pinnedSessions: s.get('pinnedSessions') ?? [],
    collapsedWorkspaces: s.get('collapsedWorkspaces') ?? [],
    seenSessions: s.get('seenSessions') ?? {},
    fonts: { ...DEFAULT_APP_PREFS.fonts, ...s.get('fonts') },
    claudeSystemPrompt: s.get('claudeSystemPrompt') ?? DEFAULT_APP_PREFS.claudeSystemPrompt,
    worktrees: { ...DEFAULT_APP_PREFS.worktrees, ...s.get('worktrees') },
    orchestrator: s.get('orchestrator') ?? {},
    orchestratorSessions: s.get('orchestratorSessions') ?? {},
    orchestratorDigests: s.get('orchestratorDigests') ?? {},
    notificationsMuted: s.get('notificationsMuted') ?? false,
  }
}

export function setOrchestratorPrefs(
  workspacePath: string,
  value: OrchestratorWorkspacePrefs,
): void {
  const s = prefs()
  s.set('orchestrator', { ...(s.get('orchestrator') ?? {}), [workspacePath]: value })
}

/** Remember which session file is this project's orchestrator, for resume. */
export function setOrchestratorSession(workspacePath: string, sessionPath: string): void {
  const s = prefs()
  s.set('orchestratorSessions', {
    ...(s.get('orchestratorSessions') ?? {}),
    [workspacePath]: sessionPath,
  })
}

export function setOrchestratorDigest(digest: OrchestratorDigest): void {
  const s = prefs()
  s.set('orchestratorDigests', {
    ...(s.get('orchestratorDigests') ?? {}),
    [digest.workspacePath]: digest,
  })
}

export function setNotificationsMuted(muted: boolean): void {
  prefs().set('notificationsMuted', muted)
}

/** Record that the user has viewed a session's current state. */
export function markSessionSeen(sessionPath: string): void {
  const s = prefs()
  const seen = { ...(s.get('seenSessions') ?? {}), [sessionPath]: Date.now() }
  s.set('seenSessions', pruneSeenSessions(seen))
}

export function setFontPrefs(fonts: AppPrefs['fonts']): void {
  prefs().set('fonts', fonts)
}

export function setClaudeSystemPrompt(mode: AppPrefs['claudeSystemPrompt']): void {
  prefs().set('claudeSystemPrompt', mode)
}

export function setWorktreePrefs(worktrees: AppPrefs['worktrees']): void {
  prefs().set('worktrees', worktrees)
}

export function setRecentWorkspaces(workspaces: AppPrefs['recentWorkspaces']): void {
  prefs().set('recentWorkspaces', workspaces)
}

export function setPinnedSessions(paths: string[]): void {
  prefs().set('pinnedSessions', paths)
}

export function setCollapsedWorkspaces(paths: string[]): void {
  prefs().set('collapsedWorkspaces', paths)
}

/**
 * Remember the session to reopen on next launch. `undefined` clears it, so
 * closing a session means the app lands on that workspace's home screen
 * rather than reopening something the user deliberately left.
 */
export function setLastSession(sessionPath: string | undefined): void {
  const s = prefs()
  if (sessionPath) s.set('lastSessionPath', sessionPath)
  else s.delete('lastSessionPath')
}

export function setTheme(theme: ThemePreference): void {
  prefs().set('theme', theme)
}

export function recordWorkspace(path: string, name: string): void {
  const s = prefs()
  const now = Date.now()
  const existing = s.get('recentWorkspaces').filter((w: WorkspaceInfo) => w.path !== path)
  const entry: WorkspaceInfo = { path, name, lastOpenedAt: now }
  s.set('recentWorkspaces', [entry, ...existing].slice(0, 20))
  s.set('lastWorkspacePath', path)
}
