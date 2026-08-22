import type { SessionMeta } from '@shared/models'
import { useSessionsStore } from '@/stores/sessions'
import { useChatStore } from '@/stores/chat'
import { piCall } from '@/lib/rpc'
import { exportSessionHtml, renameSession } from './sessionActions'

/**
 * Sidebar row actions. These wrap the shared session actions with the
 * open-disk-session-first step the sidebar needs, since a row may refer to a
 * session that has no live pi process yet.
 */

export async function renameSidebarSession(
  workspacePath: string,
  meta: SessionMeta,
  livePidexId?: string,
): Promise<void> {
  const store = useSessionsStore.getState()
  const pidexId = livePidexId ?? (await store.openDiskSession(workspacePath, meta))
  if (await renameSession(pidexId, meta.name)) void store.refreshDisk(workspacePath)
}

export async function cloneSession(
  workspacePath: string,
  meta: SessionMeta,
  livePidexId?: string,
): Promise<void> {
  if (livePidexId) {
    // The `success &&` guard used to swallow the failure branch entirely, so a
    // clone that never happened still refreshed the sidebar and looked done.
    const result = await piCall(livePidexId, { type: 'clone' })
    if (!result) return
    if (result.cancelled) {
      useChatStore.getState().setError(livePidexId, 'Clone was cancelled by an extension.')
      return
    }
    void useSessionsStore.getState().refreshDisk(workspacePath)
  } else {
    await useSessionsStore.getState().createSession(workspacePath, { forkFrom: meta.path })
  }
}

/** Export a disk or live session to HTML, opening it first if needed. */
export async function exportSidebarSession(
  workspacePath: string,
  meta: SessionMeta,
  livePidexId?: string,
): Promise<void> {
  const store = useSessionsStore.getState()
  const pidexId = livePidexId ?? (await store.openDiskSession(workspacePath, meta))
  await exportSessionHtml(pidexId, meta.name ?? 'session')
}
