import { BrowserWindow } from 'electron'

/**
 * Send a payload to every open window.
 *
 * Same shape as `pty-manager`'s and `workspace-watcher`'s broadcasts: fleet
 * state is not owned by whichever window happened to create a session, so it
 * cannot be pushed to a captured `event.sender`.
 */
export function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}
