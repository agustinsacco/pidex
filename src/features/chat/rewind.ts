import { useChatStore } from '@/stores/chat'
import { bootstrapSession } from '@/stores/sessions'
import { piCall, rehydrateTranscript } from '@/lib/rpc'
import { useChatUiStore } from './uiState'

/**
 * Rewind semantics come straight from pi's own `fork` RPC command: it
 * branches the *live* session onto a new file rooted just before `entryId`
 * and hands back the original text, which the composer offers up for
 * edit-and-resend. This is the one mechanism behind both the per-message
 * "Rewind" button and the (multi-message) fork picker.
 *
 * pi always creates a new session file here, even though the live RPC
 * connection carries on uninterrupted on the same subprocess — so
 * `bootstrapSession` has to run again to relearn the new `sessionFile`.
 * Skipping that step leaves `live[sessionId].diskPath` pointed at the
 * abandoned pre-fork file, which reads in the sidebar as the chat having
 * been duplicated (see `bootstrapSession`'s doc comment).
 */
export async function rewindToEntry(sessionId: string, entryId: string): Promise<void> {
  const fork = await piCall(sessionId, { type: 'fork', entryId })
  if (!fork) return
  if (fork.cancelled) {
    useChatStore.getState().setError(sessionId, 'Rewind was cancelled by an extension.')
    return
  }
  // Rebuild the transcript from the new branch point and relearn its file.
  await Promise.all([rehydrateTranscript(sessionId), bootstrapSession(sessionId)])
  if (fork.text) {
    useChatUiStore.getState().setPrefill(sessionId, fork.text)
  }
}

/**
 * Resolve the pi entry id for the Nth (0-based, non-optimistic) user message
 * in a session. The ordinal is stable across the two calls that need it —
 * this transcript and `get_fork_messages` both derive from the same on-disk
 * entry order — so a rendered message row can target its own rewind point
 * without opening a picker over every user message in the session.
 *
 * Deliberately NOT `piCall` (CLAUDE.md fact 3): every `null` from here, however
 * it arose, means the same thing to the caller, and `MessageItem`'s rewind
 * button already reports it as "Could not locate this message to rewind." —
 * a piCall error would just be overwritten a line later by that better message.
 */
export async function entryIdForUserMessageOrdinal(
  sessionId: string,
  ordinal: number,
): Promise<string | null> {
  const response = await window.pidex.piCommand(sessionId, { type: 'get_fork_messages' })
  if (!response.success || !response.data) return null
  return response.data.messages[ordinal]?.entryId ?? null
}
