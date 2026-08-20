import { BrowserWindow, nativeTheme } from 'electron'
import type { ThemePreference } from '@shared/models'

/**
 * Window Controls Overlay colors (Windows/Linux; macOS draws traffic lights).
 *
 * The overlay strip is painted by the OS rather than the renderer, so it does
 * not inherit the page theme. Without re-applying it on every theme change,
 * the close/minimize corner stays dark after a switch to the light theme.
 */

/** Must track `--px-bg` / `--px-text-secondary` in src/styles/index.css. */
const CHROME = {
  dark: { color: '#1e1c18', symbolColor: '#aca496' },
  light: { color: '#f7f7f8', symbolColor: '#66666e' },
} as const

/** Must equal the renderer's `h-11` drag strip, or content sits off the controls. */
export const TITLEBAR_HEIGHT = 44

export function overlayFor(theme: ThemePreference): {
  color: string
  symbolColor: string
  height: number
} {
  const resolved = theme === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : theme
  return { ...CHROME[resolved], height: TITLEBAR_HEIGHT }
}

/** No-op on macOS, which has no overlay to restyle. */
export function applyTitleBarOverlay(theme: ThemePreference): void {
  if (process.platform === 'darwin') return
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.setTitleBarOverlay(overlayFor(theme))
  }
}
