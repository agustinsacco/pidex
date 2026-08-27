/**
 * Is this session's last error one that resetting the thread would fix?
 *
 * Some failures are transient (a network blip, a rate limit) and retrying is
 * right. One class is not: a model emits a tool call whose *name* is not a
 * valid identifier, pi persists it into the session file, and every later turn
 * replays it. The provider then rejects the whole request before the model
 * runs, so the thread cannot take another turn ever again — "try again" and
 * even `/new` produce the identical error, which is exactly what it looks like
 * from the outside: a chat that has stopped responding for no visible reason.
 *
 * Observed from MiniMax M2 on Bedrock, whose raw tool-call syntax leaked into
 * the name field. `pi-ext/tool-name-guard.ts` stops new occurrences; it cannot
 * clean a file already poisoned, so recovery is a reset — and this predicate
 * is what lets the UI offer that at the moment it is needed instead of hiding
 * it in a right-click menu.
 *
 * Matched on both halves of the provider's message so an unrelated validation
 * error does not offer to throw away a working thread.
 */
export function isPoisonedThreadError(error: string | null | undefined): boolean {
  if (!error) return false
  const mentionsToolName = /toolUse\.name|tool_use\.name|tool name/i.test(error)
  const isNamePatternRejection = /regular expression pattern|failed to satisfy constraint/i.test(
    error,
  )
  return mentionsToolName && isNamePatternRejection
}

/**
 * Models known to emit malformed tool names, by substring of the model id.
 *
 * A denylist rather than an allowlist on purpose: this names only what has
 * actually been observed breaking, so a model absent from it is untested, not
 * endorsed. Substring matching because the same model arrives under several
 * ids depending on provider routing (`minimax-m2`, `MiniMax-M2`, and the
 * Bedrock ARN form all have to match).
 */
const KNOWN_MALFORMED_TOOL_NAME_MODELS = ['minimax']

/**
 * Is this model known to brick a thread by emitting invalid tool names?
 *
 * The orchestrator calls tools on almost every turn — it is the one thread
 * whose whole job is tool calls — so it is the most exposed to this, and it
 * has no model of its own unless one is set. Worth a warning where the model
 * is chosen rather than a silent failure hours later.
 */
export function modelRisksMalformedToolNames(modelId: string | null | undefined): boolean {
  if (!modelId) return false
  const id = modelId.toLowerCase()
  return KNOWN_MALFORMED_TOOL_NAME_MODELS.some((bad) => id.includes(bad))
}
