import {
  ORCHESTRATOR_MODE_INFO,
  modeAllowsSessionControl,
  type DigestItem,
  type FleetSession,
  type OrchestratorDigest,
  type OrchestratorMode,
} from '@shared/models'
import { envelope, newNonce, scrubInvisible, untrustedPreamble } from './untrusted'
import type { AgentMessage } from '@shared/rpc'
import { type FleetCallResult, type FleetCommandName } from './protocol'

/**
 * Executes the orchestrator's fleet commands in the main process.
 *
 * Deliberately free of Electron and of the registry's concrete type: it takes
 * a small `BridgeDeps` port, so the whole dispatch table — including the
 * authorization rule that keeps this from being a covert channel — is
 * testable with fakes (`bridge.test.ts`).
 */

export interface BridgeDeps {
  /** Fleet snapshot, already excluding nothing — the bridge filters. */
  snapshot: () => FleetSession[]
  /** Live session ids that are orchestrators. */
  isOrchestrator: (sessionId: string) => boolean
  /** Send an RPC command to a live session. Rejects if it is gone. */
  requestOn: (
    sessionId: string,
    command:
      | { type: 'prompt'; message: string }
      | { type: 'steer'; message: string }
      | { type: 'follow_up'; message: string }
      | { type: 'abort' }
      | { type: 'get_messages' },
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>
  /** Reply to a pending extension-UI dialog on some session. */
  answerQuestion: (
    sessionId: string,
    requestId: string,
    answer: { value?: string; confirmed?: boolean },
  ) => void
  /** Show a message in a session's transcript as orchestrator-sent. */
  announceInjection: (sessionId: string, text: string) => void
  /** Branch / dirty / PR summary for a folder. */
  gitStatus: (workspacePath: string) => Promise<unknown>
  readMemory: (workspacePath: string) => Promise<string>
  writeMemory: (workspacePath: string, content: string) => Promise<void>
  publishDigest: (digest: OrchestratorDigest) => void
  /**
   * The caller's current mode, read at CALL time.
   *
   * Deliberately a function, not a value: the preamble is fixed when the
   * session spawns, but the user can change mode mid-thread. Enforcing here
   * means a change takes effect on the very next tool call, with no respawn
   * and no window where the prompt and the rules disagree.
   */
  modeFor: (workspacePath: string) => OrchestratorMode
  /** Record a proposal for the inbox; starts work only under autopilot. */
  proposeWork: (
    workspacePath: string,
    title: string,
    prompt: string,
  ) => Promise<{ started: boolean; reason?: string }>
}

const MAX_TRANSCRIPT_MESSAGES = 30

/** Commands that change something outside the orchestrator's own thread. */
const MUTATING_COMMANDS = new Set<FleetCommandName>([
  'session_send',
  'session_stop',
  'session_answer',
  'propose_work',
])

/** How each refusal reads, so the model is told what it may not do. */
const MUTATION_VERBS: Partial<Record<FleetCommandName, string>> = {
  session_send: 'message sessions',
  session_stop: 'stop sessions',
  session_answer: 'answer questions on a session',
  propose_work: 'start or propose work',
}

function fail(error: string): FleetCallResult {
  return { ok: false, error }
}

function ok(data: unknown): FleetCallResult {
  return { ok: true, data }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

const YES = new Set(['yes', 'y', 'true', '1', 'confirm', 'confirmed', 'ok', 'approve'])
const NO = new Set(['no', 'n', 'false', '0', 'cancel', 'deny', 'reject'])

/**
 * A confirmation answer, or `null` when it is not one.
 *
 * Deliberately a closed set with an explicit unknown, not a truthiness test.
 * The version this replaces was `value === true || value === 'true' || value
 * === 'yes'`, which turns every unrecognised answer into a silent **no** on a
 * dialog whose whole purpose is guarding something destructive. Returning null
 * lets the caller refuse and let the model try again, which is recoverable;
 * answering "no" to "delete the branch?" when the model meant "affirmative"
 * is not.
 */
export function parseConfirm(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (YES.has(normalized)) return true
  if (NO.has(normalized)) return false
  return null
}

/**
 * Compact a transcript down to what a manager needs to judge progress.
 *
 * Every free-text field here was written by another lane's agent, which may
 * have been reading a hostile issue, log or web page. It reaches a thread
 * holding `session_send` and `session_stop` over that same lane, so it is
 * enveloped under a per-call nonce rather than returned verbatim. The
 * structural fields (role, tool name, error flag, stop reason) are facts the
 * runtime produced and stay plain.
 */
function summarizeMessages(messages: AgentMessage[], limit: number, nonce: string): unknown[] {
  const frame = (text: string, kind: string): string =>
    text ? envelope(nonce, text, { kind }) : text
  return messages.slice(-limit).map((message) => {
    if (message.role === 'user') {
      return {
        role: 'user',
        text:
          typeof message.content === 'string'
            ? frame(message.content, 'lane-user-message')
            : '[blocks]',
      }
    }
    if (message.role === 'assistant') {
      const text = message.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
      const tools = message.content
        .filter((b): b is Extract<typeof b, { type: 'toolCall' }> => b.type === 'toolCall')
        .map((b) => b.name)
      return {
        role: 'assistant',
        text: frame(text, 'lane-output'),
        tools,
        stopReason: message.stopReason,
      }
    }
    if (message.role === 'toolResult') {
      return { role: 'toolResult', tool: message.toolName, isError: message.isError }
    }
    return { role: message.role }
  })
}

function parseDigest(
  args: Record<string, unknown>,
  workspacePath: string,
): OrchestratorDigest | null {
  const headline = asString(args.headline)
  if (!headline) return null
  const rawItems = Array.isArray(args.items) ? args.items : []
  const items: DigestItem[] = []
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const text = asString(item.text)
    if (!text) continue
    const kind = item.kind
    // A suggestion the user can act on carries the prompt that would start it,
    // so "propose work" becomes a button rather than a sentence to re-type.
    const startPrompt = asString(item.startPrompt)
    items.push({
      kind: kind === 'attention' || kind === 'suggestion' ? kind : 'note',
      text,
      ...(asString(item.sessionPath) ? { sessionPath: asString(item.sessionPath)! } : {}),
      ...(startPrompt
        ? { action: { label: 'Start this', kind: 'start' as const, payload: startPrompt } }
        : {}),
    })
  }
  return { workspacePath, updatedAt: Date.now(), headline, items }
}

/**
 * Run one fleet command on behalf of `callerSessionId`.
 *
 * **The authorization gate is the first line.** Only a session main itself
 * spawned as an orchestrator may drive other sessions; anything else is
 * refused here rather than filtered later.
 */
export async function handleFleetCommand(
  deps: BridgeDeps,
  callerSessionId: string,
  command: FleetCommandName,
  args: Record<string, unknown>,
): Promise<FleetCallResult> {
  if (!deps.isOrchestrator(callerSessionId)) {
    return fail('not authorized: only an orchestrator session may call fleet commands')
  }

  const caller = deps.snapshot().find((s) => s.sessionId === callerSessionId)
  const callerWorkspace = caller?.workspacePath ?? ''
  const mode = deps.modeFor(callerWorkspace)

  // Observe mode is read-only. Refusing here rather than trusting the preamble
  // is what makes the mode a guarantee instead of a request: the prompt is
  // fixed at spawn, this is evaluated per call.
  if (MUTATING_COMMANDS.has(command) && !modeAllowsSessionControl(mode)) {
    return fail(
      `refused: the orchestrator is in ${ORCHESTRATOR_MODE_INFO[mode].label} mode, which cannot ${MUTATION_VERBS[command] ?? 'act on sessions'}. Report what you found instead, or ask the user to switch modes.`,
    )
  }

  /** Resolve a target, refusing the orchestrator's own session. */
  const target = (id: unknown): FleetSession | { error: string } => {
    const sessionId = asString(id)
    if (!sessionId) return { error: 'sessionId is required' }
    if (sessionId === callerSessionId) return { error: 'an orchestrator cannot drive itself' }
    const found = deps.snapshot().find((s) => s.sessionId === sessionId)
    if (!found) return { error: `no live session ${sessionId}` }
    if (found.isOrchestrator) return { error: 'that session is another orchestrator' }
    return found
  }

  switch (command) {
    case 'fleet_status': {
      // The orchestrator never sees itself: a sweep that observes its own
      // activity feeds back into the next sweep.
      const sessions = deps.snapshot().filter((s) => !s.isOrchestrator)
      return ok({ sessions })
    }

    case 'session_read': {
      const found = target(args.sessionId)
      if ('error' in found) return fail(found.error)
      const limitRaw = typeof args.limit === 'number' ? args.limit : MAX_TRANSCRIPT_MESSAGES
      const limit = Math.max(1, Math.min(MAX_TRANSCRIPT_MESSAGES, Math.floor(limitRaw)))
      const response = await deps.requestOn(found.sessionId, { type: 'get_messages' })
      if (!response.success) return fail(response.error ?? 'get_messages failed')
      const data = response.data as { messages?: AgentMessage[] } | undefined
      const nonce = newNonce()
      return ok({
        sessionId: found.sessionId,
        title: found.title === undefined ? undefined : scrubInvisible(found.title),
        phase: found.phase,
        // Stated in the payload, not left to the system prompt: this result
        // may arrive long after the preamble and may survive a compaction
        // that the preamble did not.
        readMe: untrustedPreamble(nonce),
        messages: summarizeMessages(data?.messages ?? [], limit, nonce),
      })
    }

    case 'session_send': {
      const found = target(args.sessionId)
      if ('error' in found) return fail(found.error)
      const text = asString(args.text)
      if (!text) return fail('text is required')
      const mode = args.mode === 'steer' ? 'steer' : args.mode === 'prompt' ? 'prompt' : 'followUp'
      // Steering only makes sense mid-run; an idle session takes a prompt.
      const streaming = found.phase === 'streaming'
      const type =
        mode === 'steer' && streaming
          ? 'steer'
          : mode === 'followUp' && streaming
            ? 'follow_up'
            : 'prompt'
      const response = await deps.requestOn(found.sessionId, { type, message: text } as never)
      if (!response.success) return fail(response.error ?? `${type} failed`)
      // The visible-hand rule: the target's transcript must show this arrived.
      deps.announceInjection(found.sessionId, text)
      return ok({ delivered: type })
    }

    case 'session_stop': {
      const found = target(args.sessionId)
      if ('error' in found) return fail(found.error)
      const response = await deps.requestOn(found.sessionId, { type: 'abort' })
      if (!response.success) return fail(response.error ?? 'abort failed')
      deps.announceInjection(found.sessionId, 'Stopped by the orchestrator.')
      return ok({ stopped: true })
    }

    case 'session_answer': {
      const found = target(args.sessionId)
      if ('error' in found) return fail(found.error)
      const question = found.pendingQuestion
      if (!question) return fail('that session is not waiting on a question')
      const requestId = asString(args.requestId) ?? question.requestId
      if (requestId !== question.requestId) return fail('that question is no longer pending')
      const value = asString(args.value)
      if (question.method === 'confirm') {
        const confirmed = parseConfirm(args.value)
        if (confirmed === null) {
          // Never coerce an unrecognised answer to `false`. The old code read
          // truthiness (`=== true || 'true' || 'yes'`), so a model replying
          // "affirmative" or "y" silently answered NO to a destructive
          // confirmation — and the transcript honestly recorded that it had.
          // A refusal the model can see and retry is the only safe default.
          return fail(
            `"${String(args.value)}" is not a yes/no answer. ` +
              `Reply with one of: yes, no, true, false, y, n.`,
          )
        }
        deps.answerQuestion(found.sessionId, requestId, { confirmed })
        deps.announceInjection(
          found.sessionId,
          `Orchestrator answered "${question.title}": ${confirmed ? 'yes' : 'no'}`,
        )
        return ok({ answered: confirmed })
      }
      if (!value) return fail('value is required')
      if (question.method === 'select' && question.options && !question.options.includes(value)) {
        return fail(`value must be one of: ${question.options.join(', ')}`)
      }
      deps.answerQuestion(found.sessionId, requestId, { value })
      deps.announceInjection(found.sessionId, `Orchestrator answered "${question.title}": ${value}`)
      return ok({ answered: value })
    }

    case 'git_status': {
      const path = asString(args.workspacePath) ?? callerWorkspace
      if (!path) return fail('workspacePath is required')
      return ok(await deps.gitStatus(path))
    }

    case 'memory_read':
      return ok({ content: await deps.readMemory(callerWorkspace) })

    case 'memory_write': {
      const content = asString(args.content)
      if (content === undefined) return fail('content is required')
      await deps.writeMemory(callerWorkspace, content)
      return ok({ written: true })
    }

    case 'propose_work': {
      const title = asString(args.title)
      const prompt = asString(args.prompt)
      if (!title || !prompt) return fail('title and prompt are required')
      const workspacePath = asString(args.workspacePath) ?? callerWorkspace
      const result = await deps.proposeWork(workspacePath, title, prompt)
      return ok(result)
    }

    case 'publish_digest': {
      const digest = parseDigest(args, callerWorkspace)
      if (!digest) return fail('headline is required')
      deps.publishDigest(digest)
      return ok({ published: digest.items.length })
    }

    default:
      return fail(`unknown fleet command: ${String(command)}`)
  }
}
