import { useChatStore } from '@/stores/chat'
import { piCallOk } from '@/lib/rpc'

/**
 * Drop one entry from a rendered queue snapshot, returning the survivors.
 *
 * The index comes from the chip row, which renders the last `queue_update`. pi
 * can deliver a queued message between that render and the click, so the index
 * alone is not trustworthy: it is used only when the text at it still matches,
 * and otherwise the first equal text wins. `null` means the entry is already
 * gone (pi read it) and the caller must not claim a removal.
 */
export function dropQueuedEntry(queue: string[], index: number, text: string): string[] | null {
  const at = queue[index] === text ? index : queue.indexOf(text)
  if (at === -1) return null
  return [...queue.slice(0, at), ...queue.slice(at + 1)]
}

/**
 * Undo a queued steering / follow-up message that pi has not read yet.
 *
 * pi's protocol has no "remove entry N": the only queue mutation is
 * `clear_queue` (pi 0.84.4+), which drains BOTH queues and returns what it
 * drained. So an undo is drain-then-re-queue-the-survivors, in order — and a
 * re-queue re-runs pi's skill / prompt-template expansion, which is a no-op on
 * text that does not start with `/`, as already-expanded queue text does not.
 *
 * On an older pi the drain fails and nothing is lost: pi answers
 * `Unknown command: clear_queue` with both queues untouched.
 */
export async function unqueueMessage(
  sessionId: string,
  kind: 'steer' | 'follow-up',
  index: number,
  text: string,
): Promise<void> {
  const chat = useChatStore.getState()
  const response = await window.pidex.piCommand<'clear_queue'>(sessionId, { type: 'clear_queue' })
  const drainedQueues = response.success ? response.data : undefined
  if (!drainedQueues) {
    const reason = response.success ? 'clear_queue returned no queues' : response.error
    chat.setError(
      sessionId,
      `Could not remove the queued message: ${reason}. This needs pi 0.84.4 or newer.`,
    )
    return
  }

  const { steering, followUp } = drainedQueues
  const dropped = dropQueuedEntry(kind === 'steer' ? steering : followUp, index, text)
  const keptSteering = kind === 'steer' ? (dropped ?? steering) : steering
  const keptFollowUp = kind === 'follow-up' ? (dropped ?? followUp) : followUp

  // Re-queue survivors before reporting: a failure here would otherwise drop
  // messages the user still wants, so the error names what was lost.
  const lost: string[] = []
  for (const message of keptSteering) {
    if (!(await piCallOk(sessionId, { type: 'steer', message }))) lost.push(message)
  }
  for (const message of keptFollowUp) {
    if (!(await piCallOk(sessionId, { type: 'follow_up', message }))) lost.push(message)
  }
  if (lost.length > 0) {
    chat.setError(sessionId, `Could not re-queue ${lost.length} message(s): ${lost.join(' · ')}`)
    return
  }
  if (dropped === null) {
    chat.setError(sessionId, 'That message was already delivered to the agent.')
  }
}
