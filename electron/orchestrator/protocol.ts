/**
 * The orchestrator's control channel, as a wire contract.
 *
 * Extensions run inside pi and cannot reach main directly. Rather than open a
 * socket — a new listening surface, a token to leak, another `app.isPackaged`
 * gate to get wrong — the orchestrator extension rides pi's existing
 * extension-UI round trip: `ctx.ui.input(title, placeholder)` emits an
 * `extension_ui_request` and resolves with whatever pidex answers.
 *
 * Requests carrying `SENTINEL` are handled in main and never forwarded to the
 * renderer. Authorization is structural: main only honours the sentinel from a
 * session it spawned as an orchestrator (see `bridge.ts`), so an ordinary
 * session cannot use this as a covert channel.
 *
 * Shared by `pi-ext/orchestrator.ts` (which must compile standalone under pi's
 * runtime), so this file imports nothing.
 */

/** Bumped if the request or response shape ever changes incompatibly. */
export const SENTINEL = 'pidex-fleet:v1'

/** Milliseconds an extension waits before giving up on main. */
export const CALL_TIMEOUT_MS = 20_000

export type FleetCommandName =
  | 'fleet_status'
  | 'session_read'
  | 'session_send'
  | 'session_stop'
  | 'session_answer'
  | 'git_status'
  | 'propose_work'
  | 'memory_read'
  | 'memory_write'
  | 'publish_digest'

/** `title` on the wire: sentinel plus the command being invoked. */
export function requestTitle(command: FleetCommandName): string {
  return `${SENTINEL}:${command}`
}

/** Returns the command name when `title` is one of ours, else null. */
export function parseRequestTitle(title: string | undefined): FleetCommandName | null {
  if (!title || !title.startsWith(`${SENTINEL}:`)) return null
  const name = title.slice(SENTINEL.length + 1)
  return name.length > 0 ? (name as FleetCommandName) : null
}

export type FleetCallResult = { ok: true; data: unknown } | { ok: false; error: string }

/** Every response is JSON in the `value` string; never an exception. */
export function encodeResult(result: FleetCallResult): string {
  return JSON.stringify(result)
}

export function decodeResult(value: string | undefined): FleetCallResult {
  if (value === undefined) {
    return { ok: false, error: 'pidex did not answer (timed out or cancelled)' }
  }
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && 'ok' in parsed) {
      return parsed as FleetCallResult
    }
    return { ok: false, error: 'malformed response from pidex' }
  } catch {
    return { ok: false, error: 'unparseable response from pidex' }
  }
}
