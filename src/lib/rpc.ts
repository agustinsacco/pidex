import type { RpcCommand, RpcResponseDataMap } from '@shared/rpc'
import { useChatStore } from '@/stores/chat'

/**
 * Helpers over `window.pidex.piCommand`.
 *
 * The raw API returns a `{ success, data?, error? }` envelope, which meant every
 * call site re-implemented the unwrapping — and roughly half of them dropped the
 * error branch entirely, so a failed RPC looked like a no-op in the UI. These
 * wrappers make reporting the default and silence an explicit choice.
 */

/**
 * Send a command and return its data, or `undefined` on failure after surfacing
 * the error on the session's chat surface.
 */
export async function piCall<T extends RpcCommand['type']>(
  sessionId: string,
  command: Extract<RpcCommand, { type: T }>,
): Promise<RpcResponseDataMap[T] | undefined> {
  const response = await window.pidex.piCommand<T>(sessionId, command)
  if (!response.success) {
    useChatStore.getState().setError(sessionId, response.error ?? `${command.type} failed`)
    return undefined
  }
  return response.data
}

/**
 * Send a command and report failures, ignoring the response data. For
 * fire-and-forget settings toggles where only the failure matters.
 *
 * Returns whether the command succeeded, so callers can gate optimistic local
 * state on the result.
 */
export async function piCallOk<T extends RpcCommand['type']>(
  sessionId: string,
  command: Extract<RpcCommand, { type: T }>,
): Promise<boolean> {
  const response = await window.pidex.piCommand<T>(sessionId, command)
  if (!response.success) {
    useChatStore.getState().setError(sessionId, response.error ?? `${command.type} failed`)
    return false
  }
  return true
}
