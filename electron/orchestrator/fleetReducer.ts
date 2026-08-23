import { FILES_TOUCHED_CAP, type FleetQuestion, type FleetSession } from '@shared/models'
import type { AgentMessage, ExtensionUIRequest, PiEvent } from '@shared/rpc'

/**
 * The fleet hub's brain, as a pure function.
 *
 * Everything the home screen knows about a running session is derived here
 * from pi's own event stream — no model, no polling, no extra RPC. Kept free
 * of Electron and of the registry so the whole state machine is testable
 * without spawning anything (see `__tests__/fleetReducer.test.ts`).
 */

/** Inputs the hub folds into a session's state. */
export type FleetInput =
  | { kind: 'event'; event: PiEvent }
  | { kind: 'extension-ui'; request: ExtensionUIRequest }
  /** A reply was sent for `requestId`, so the question is no longer pending. */
  | { kind: 'question-answered'; requestId: string }
  | { kind: 'exit' }
  /** `get_state` landed, or the session's project root was resolved. */
  | { kind: 'meta'; diskPath?: string; title?: string; projectRoot?: string }

const LAST_LINE_MAX = 160

/** Tool argument keys that name a file. Best-effort by design. */
const PATH_ARG_KEYS = ['path', 'file_path', 'filePath', 'filename', 'file']

export function emptySession(
  sessionId: string,
  workspacePath: string,
  options: { isOrchestrator?: boolean; now?: number } = {},
): FleetSession {
  return {
    sessionId,
    workspacePath,
    phase: 'idle',
    filesTouched: [],
    lastActivityAt: options.now ?? Date.now(),
    idleSince: options.now ?? Date.now(),
    turns: 0,
    isOrchestrator: options.isOrchestrator ?? false,
  }
}

/**
 * Pull a file path out of a tool call's arguments.
 *
 * Deliberately narrow: only string values under known keys. Guessing more
 * widely (any string that looks path-ish) produced false positives from
 * grep patterns and bash command text, and this feeds a collision warning
 * where a false positive is worse than a miss.
 */
export function pathFromArgs(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined
  for (const key of PATH_ARG_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return undefined
}

function addFile(files: string[], path: string | undefined): string[] {
  if (!path || files.includes(path)) return files
  const next = [...files, path]
  // Bounded: a long-running session touching thousands of files must not grow
  // the snapshot that gets broadcast to every window on every change.
  return next.length > FILES_TOUCHED_CAP ? next.slice(next.length - FILES_TOUCHED_CAP) : next
}

/** Last non-empty line of an assistant message's prose, truncated. */
export function lastProseLine(message: AgentMessage | undefined): string | undefined {
  if (!message || message.role !== 'assistant') return undefined
  const text = message.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .pop()
  if (!line) return undefined
  return line.length > LAST_LINE_MAX ? `${line.slice(0, LAST_LINE_MAX - 1)}…` : line
}

function questionFrom(request: ExtensionUIRequest, now: number): FleetQuestion | undefined {
  if (request.method === 'select') {
    return {
      requestId: request.id,
      method: 'select',
      title: request.title,
      options: request.options,
      askedAt: now,
    }
  }
  if (request.method === 'confirm') {
    return {
      requestId: request.id,
      method: 'confirm',
      title: request.title,
      message: request.message,
      askedAt: now,
    }
  }
  if (request.method === 'input') {
    return { requestId: request.id, method: 'input', title: request.title, askedAt: now }
  }
  // notify / setStatus / setWidget / setTitle / editor are not questions the
  // home screen can answer with buttons, so they never block a session.
  return undefined
}

/**
 * Fold one input into a session's state.
 *
 * Returns the same object when nothing changed, so the hub can skip
 * broadcasting on the vast majority of streaming deltas.
 */
export function fleetReducer(
  state: FleetSession,
  input: FleetInput,
  now: number = Date.now(),
): FleetSession {
  switch (input.kind) {
    case 'meta': {
      const next = {
        ...state,
        diskPath: input.diskPath ?? state.diskPath,
        title: input.title ?? state.title,
        projectRoot: input.projectRoot ?? state.projectRoot,
      }
      if (
        next.diskPath === state.diskPath &&
        next.title === state.title &&
        next.projectRoot === state.projectRoot
      ) {
        return state
      }
      return next
    }

    case 'exit':
      if (state.phase === 'exited') return state
      return { ...state, phase: 'exited', currentTool: undefined, lastActivityAt: now }

    case 'question-answered': {
      if (state.pendingQuestion?.requestId !== input.requestId) return state
      return {
        ...state,
        pendingQuestion: undefined,
        // Answering hands control back to the agent; it is about to stream.
        phase: state.phase === 'awaiting-input' ? 'streaming' : state.phase,
        lastActivityAt: now,
      }
    }

    case 'extension-ui': {
      const question = questionFrom(input.request, now)
      if (!question) return state
      return { ...state, pendingQuestion: question, phase: 'awaiting-input', lastActivityAt: now }
    }

    case 'event':
      return reduceEvent(state, input.event, now)
  }
}

function reduceEvent(state: FleetSession, event: PiEvent, now: number): FleetSession {
  switch (event.type) {
    case 'agent_start':
      return {
        ...state,
        phase: 'streaming',
        turns: state.turns + 1,
        idleSince: undefined,
        lastActivityAt: now,
      }

    case 'tool_execution_start':
      return {
        ...state,
        phase: 'streaming',
        currentTool: event.toolName,
        filesTouched: addFile(state.filesTouched, pathFromArgs(event.args)),
        lastActivityAt: now,
      }

    case 'tool_execution_end':
      return { ...state, currentTool: undefined, lastActivityAt: now }

    case 'message_end': {
      const line = lastProseLine(event.message)
      // An assistant turn that ended in an error is a stalled session, not a
      // finished one — the home screen surfaces it for attention.
      const errored = event.message.role === 'assistant' && event.message.stopReason === 'error'
      if (!line && !errored) return { ...state, lastActivityAt: now }
      return {
        ...state,
        ...(line ? { lastLine: line } : {}),
        ...(errored ? { phase: 'error' as const, idleSince: now } : {}),
        lastActivityAt: now,
      }
    }

    case 'agent_end':
    case 'agent_settled': {
      // A session blocked on a question is NOT idle: pi settles while the
      // dialog is open, and calling that idle would drop it out of the
      // "needs you" inbox at exactly the moment it needs you.
      if (state.pendingQuestion) return { ...state, lastActivityAt: now }
      if (state.phase === 'error') return { ...state, lastActivityAt: now }
      return {
        ...state,
        phase: 'idle',
        currentTool: undefined,
        idleSince: state.idleSince ?? now,
        lastActivityAt: now,
      }
    }

    default:
      // Streaming deltas (message_update), queue updates, compaction and retry
      // events carry nothing the fleet view shows. Returning `state` unchanged
      // is what keeps the broadcast off the per-token path.
      return state
  }
}
