import Store from 'electron-store'
import { DEFAULT_APP_PREFS, type AppPrefs, type ThemePreference, type WorkspaceInfo } from '@shared/models'

const store = new Store<AppPrefs>({ defaults: DEFAULT_APP_PREFS })

export function getPrefs(): AppPrefs {
  return {
    theme: store.get('theme'),
    recentWorkspaces: store.get('recentWorkspaces'),
    lastWorkspacePath: store.get('lastWorkspacePath'),
    pinnedSessions: store.get('pinnedSessions') ?? [],
    fonts: { ...DEFAULT_APP_PREFS.fonts, ...store.get('fonts') },
  }
}

export function setFontPrefs(fonts: AppPrefs['fonts']): void {
  store.set('fonts', fonts)
}

export function setRecentWorkspaces(workspaces: AppPrefs['recentWorkspaces']): void {
  store.set('recentWorkspaces', workspaces)
}

export function setPinnedSessions(paths: string[]): void {
  store.set('pinnedSessions', paths)
}

export function setTheme(theme: ThemePreference): void {
  store.set('theme', theme)
}

export function recordWorkspace(path: string, name: string): void {
  const now = Date.now()
  const existing = store.get('recentWorkspaces').filter((w: WorkspaceInfo) => w.path !== path)
  const entry: WorkspaceInfo = { path, name, lastOpenedAt: now }
  store.set('recentWorkspaces', [entry, ...existing].slice(0, 20))
  store.set('lastWorkspacePath', path)
}
