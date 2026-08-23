import { homedir } from 'node:os'
import { handle } from './handle'
import { checkSubscriptionAuth } from '../pi/auth-status'
import { checkPiHealth } from '../pi/health'
import { piProcessEnv } from '../pi/shell-env'
import { ptyManager } from '../pty/pty-manager'

/** Signing into the subscription providers pi supports. */
export function registerPiAuthHandlers(): void {
  handle('pi:subscriptionAuth', () => checkSubscriptionAuth())

  handle('pi:loginTerminal', async (_event, cols, rows) => {
    const health = await checkPiHealth()
    if (!health.ok || !health.binaryPath) {
      throw new Error(health.message ?? 'pi is not available')
    }
    /*
     * `--no-session` keeps this throwaway pi out of the session list — the
     * user is signing in, not starting a conversation, and a stray session
     * would show up in the sidebar. Home as cwd because sign-in has nothing
     * to do with any workspace, and pi refuses nothing there.
     */
    return ptyManager.create(homedir(), cols, rows, undefined, {
      file: health.binaryPath,
      args: ['--no-session'],
      env: await piProcessEnv(),
    })
  })
}
