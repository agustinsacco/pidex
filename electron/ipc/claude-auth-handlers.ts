import { app, BrowserWindow } from 'electron'
import type { ClaudeLoginState } from '@shared/models'
import { handle } from './handle'
import {
  cancelClaudeLogin,
  logoutClaude,
  startClaudeLogin,
  submitClaudeLoginCode,
} from '../pi/claude-login'
import { fetchUsageSnapshot } from '../claude/usage'

function broadcast(state: ClaudeLoginState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('claude:loginState', state)
  }
}

/**
 * E2E-only claude override, same gating as `packages-handlers`: an env-var
 * binary may only stand in for the real one in unpackaged builds, or it is
 * env-var-triggered code execution in a shipped app.
 */
function claudeBinOverride(): string | undefined {
  if (app.isPackaged) return undefined
  return process.env.PIDEX_CLAUDE_BIN || undefined
}

/**
 * Signing the Claude Code CLI in and out (the plan-billed provider).
 *
 * Separate from `pi-auth-handlers` because the credential lives somewhere else:
 * these channels drive the `claude` binary's own auth, not pi's `auth.json`.
 * No `openExternal` here on purpose — the CLI opens the browser itself, and a
 * second tab is one the user could paste a stale code from.
 */
export function registerClaudeAuthHandlers(): void {
  handle('claude:startLogin', () => startClaudeLogin(broadcast, claudeBinOverride()))
  handle('claude:submitCode', (_event, code) => {
    submitClaudeLoginCode(code)
  })
  handle('claude:cancelLogin', () => {
    cancelClaudeLogin()
  })
  handle('claude:logout', () => logoutClaude(claudeBinOverride()))
  /** Read-only, cached ~60 s in main; the spawn is zero-quota. */
  handle('claude:usageSnapshot', () => fetchUsageSnapshot({ claudeOverride: claudeBinOverride() }))
}
