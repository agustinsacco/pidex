import { useChatStore } from '@/stores/chat'
import { piCall, piCallOk } from '@/lib/rpc'

/**
 * Session operations shared by the chat composer, the session menu and the
 * sidebar's context menu.
 *
 * Each of these used to exist as three near-identical copies that had drifted
 * apart in their error handling — the sidebar and session-menu variants
 * discarded RPC failures, so a failed export or rename looked like nothing had
 * happened. Routing all three through one implementation makes the reporting
 * consistent.
 */

/**
 * Export a session to HTML via the native save dialog, then reveal the file.
 * No-op when the user cancels the dialog.
 */
export async function exportSessionHtml(sessionId: string, defaultName = 'session'): Promise<void> {
  const outputPath = await window.pidex.invoke('app:saveDialog', {
    title: 'Export session as HTML',
    defaultPath: `${defaultName}.html`,
    filters: [{ name: 'HTML', extensions: ['html'] }],
  })
  if (!outputPath) return

  const data = await piCall(sessionId, { type: 'export_html', outputPath })
  if (data) await window.pidex.invoke('app:revealPath', data.path)
}

/**
 * Prompt for a new session name and apply it. Returns the new name on success
 * so callers can run their own follow-up (e.g. refreshing the disk listing),
 * or `undefined` when cancelled or failed.
 */
export async function renameSession(
  sessionId: string,
  currentName?: string,
): Promise<string | undefined> {
  const name = window.prompt('Session name', currentName ?? '')
  if (!name) return undefined

  if (!(await piCallOk(sessionId, { type: 'set_session_name', name }))) return undefined
  useChatStore.getState().patchMeta(sessionId, { sessionName: name })
  return name
}
