import { registerPiSessionHandlers } from './ipc/pi-session-handlers'
import { registerAppHandlers } from './ipc/app-handlers'
import { registerPiConfigHandlers } from './ipc/pi-config-handlers'
import { registerSessionsHandlers } from './ipc/sessions-handlers'
import { registerGitHandlers } from './ipc/git-handlers'
import { registerFsHandlers } from './ipc/fs-handlers'
import { registerPtyHandlers } from './ipc/pty-handlers'

/**
 * Register every IPC invoke handler, grouped by domain.
 *
 * Called once from main.ts on `app.whenReady()`. Each registrar owns one
 * channel prefix, so a new handler has exactly one obvious home.
 */
export function registerIpcHandlers(): void {
  registerPiSessionHandlers()
  registerAppHandlers()
  registerPiConfigHandlers()
  registerSessionsHandlers()
  registerGitHandlers()
  registerFsHandlers()
  registerPtyHandlers()
}
