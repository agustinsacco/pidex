/**
 * pidex orchestrator extension — loaded ONLY into orchestrator sessions
 * (`pi --mode rpc -e <this file>`), never into ordinary work sessions.
 *
 * It registers the tools an orchestration agent needs to see and drive the
 * other sessions in its project. None of them do any work here: each one is a
 * thin round trip to pidex's main process, which owns every side effect.
 *
 * The transport is pi's own extension-UI channel. `ctx.ui.input()` emits an
 * `extension_ui_request` and resolves with whatever the host answers, so a
 * request whose title carries pidex's sentinel is intercepted in main,
 * executed, and answered — no socket, no port, no token. pidex only honours
 * the sentinel from a session it spawned as an orchestrator, so an ordinary
 * session loading this file could not drive anything.
 *
 * Imports resolve against pi's own runtime when it loads the extension.
 *
 * **Every tool here declares at least one REQUIRED parameter, on purpose.**
 * On the Claude Code provider a tool call carrying no arguments streams no
 * `input_json_delta`, so the bridge's accumulated JSON is the empty string and
 * it forwards `arguments: ""`. pi validates arguments before `execute` runs,
 * so an empty-schema tool dies at `root: must be object` and never reaches
 * this file — `fleet_status` and `memory_read` failed on literally every call.
 * A required field forces the model to emit an object, which sidesteps it. The
 * real fix belongs in `@saccolabs/pi-claude-cli` (parse `partialJson || '{}'`);
 * this constraint stays regardless, because it costs nothing and the provider
 * is separately versioned.
 */
import { Type } from 'typebox'

/** Must match `electron/orchestrator/protocol.ts`. */
const SENTINEL = 'pidex-fleet:v1'
const CALL_TIMEOUT_MS = 20_000

interface PiExtensionApi {
  registerTool(definition: Record<string, unknown>): void
}

interface ExtensionContext {
  ui?: {
    input?(
      title: string,
      placeholder?: string,
      opts?: { timeout?: number },
    ): Promise<string | undefined>
  }
}

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  details?: unknown
  isError?: boolean
}

function textResult(text: string, details?: unknown, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], details, isError }
}

/**
 * Make what the model actually sent match what the host expects.
 *
 * Models routinely stringify nested structures in tool arguments — Opus 5 on
 * Bedrock did it on every `publish_digest` call in session 01a04394 — so a
 * field declared as an array arrives as `"[{\"kind\":\"note\",...}]"`.
 * Rather than lecture the model in a prompt it cannot reliably follow, accept
 * the string and parse it. Anything unparseable is dropped rather than
 * throwing: a malformed digest must degrade to a smaller digest, never to a
 * failed sweep.
 */
export function coerceParams(params: Record<string, unknown>): Record<string, unknown> {
  const items = params.items
  if (typeof items !== 'string') return params
  const trimmed = items.trim()
  if (!trimmed) return { ...params, items: [] }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return { ...params, items: parsed }
    // A single item sent bare, which is the other shape models pick.
    if (parsed && typeof parsed === 'object') return { ...params, items: [parsed] }
  } catch {
    // Not JSON at all. Treat the whole string as one note so the sweep still
    // publishes something the user can see.
    return { ...params, items: [{ kind: 'note', text: trimmed }] }
  }
  return { ...params, items: [] }
}

/**
 * One round trip to pidex.
 *
 * Never throws: a failure is returned to the model as an error result, so a
 * broken host degrades into "that tool didn't work" rather than killing the
 * turn. The timeout matters because `ui.input` would otherwise wait forever
 * if the host never answered.
 */
async function callPidex(
  ctx: ExtensionContext,
  command: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const input = ctx.ui?.input
  if (typeof input !== 'function') {
    return { ok: false, error: 'pidex control channel unavailable' }
  }
  let raw: string | undefined
  try {
    raw = await input.call(ctx.ui, `${SENTINEL}:${command}`, JSON.stringify(args), {
      timeout: CALL_TIMEOUT_MS,
    })
  } catch (error) {
    return { ok: false, error: `control channel failed: ${String(error)}` }
  }
  if (raw === undefined) return { ok: false, error: 'pidex did not answer' }
  try {
    const parsed = JSON.parse(raw) as { ok?: boolean; data?: unknown; error?: string }
    if (typeof parsed.ok !== 'boolean') return { ok: false, error: 'malformed response from pidex' }
    return parsed as { ok: boolean; data?: unknown; error?: string }
  } catch {
    return { ok: false, error: 'unparseable response from pidex' }
  }
}

/** Render a result for the model: JSON on success, a plain reason on failure. */
function present(
  result: { ok: boolean; data?: unknown; error?: string },
  summary: (data: unknown) => string,
): ToolResult {
  if (!result.ok) return textResult(result.error ?? 'failed', undefined, true)
  return textResult(summary(result.data), result.data)
}

/** One tool this extension registers. Declared as data so a test can read it. */
export interface OrchestratorToolSpec {
  name: string
  label: string
  description: string
  /** TypeBox schema. Its `properties` / `required` are the argument contract. */
  parameters: unknown
  /** Bridge command in `electron/orchestrator/bridge.ts`. */
  command: string
  summarize: (data: unknown) => string
  guidelines?: string[]
}

const ORCHESTRATOR_TOOLS: OrchestratorToolSpec[] = []

function tool(
  name: string,
  label: string,
  description: string,
  parameters: unknown,
  command: string,
  summarize: (data: unknown) => string,
  guidelines?: string[],
): void {
  ORCHESTRATOR_TOOLS.push({
    name,
    label,
    description,
    parameters,
    command,
    summarize,
    ...(guidelines ? { guidelines } : {}),
  })
}

tool(
  'fleet_status',
  'Fleet status',
  'List the sessions running in this project, with what each is doing right now: ' +
    'phase, the tool it is running, the last thing it said, files it has touched, ' +
    'how long it has been idle, and any question it is blocked on.',
  // `scope` is required to keep the arguments object non-empty (see the
  // header), and it earns its place: a big fleet is easier to read one
  // slice at a time.
  Type.Object({
    scope: Type.String({
      description: '"all", "blocked" (waiting on a question) or "idle" (not working right now)',
    }),
  }),
  'fleet_status',
  (data) => {
    const sessions = (data as { sessions?: unknown[] })?.sessions ?? []
    return sessions.length === 0
      ? 'No sessions are running.'
      : `${sessions.length} session(s):\n${JSON.stringify(sessions, null, 2)}`
  },
)

tool(
  'session_read',
  'Read a session',
  'Read the recent transcript of one session, to judge what it has actually been doing. ' +
    'Prefer this over guessing from the last line alone.',
  Type.Object({
    sessionId: Type.String({ description: 'Session id from fleet_status' }),
    limit: Type.Optional(Type.Number({ description: 'How many recent messages (max 30)' })),
  }),
  'session_read',
  (data) => JSON.stringify(data, null, 2),
)

tool(
  'session_send',
  'Send to a session',
  'Send a message to a running session. mode "steer" interrupts what it is doing now, ' +
    '"followUp" queues the message for when the current run finishes. The message is ' +
    "shown in that session's transcript, attributed to you.",
  Type.Object({
    sessionId: Type.String(),
    text: Type.String({ description: 'What to tell that agent' }),
    mode: Type.Optional(
      Type.String({
        description: '"steer" (interrupt) or "followUp" (queue). Default followUp.',
      }),
    ),
  }),
  'session_send',
  (data) => `Delivered as ${String((data as { delivered?: string })?.delivered ?? 'message')}.`,
  [
    'Only steer a session when it is going the wrong way; interrupting good progress is worse than saying nothing.',
  ],
)

tool(
  'session_stop',
  'Stop a session',
  'Abort what a session is currently doing. Use sparingly — it discards in-flight work.',
  Type.Object({ sessionId: Type.String() }),
  'session_stop',
  () => 'Stopped.',
)

tool(
  'session_answer',
  'Answer a session question',
  'Answer a clarifying question a session is blocked on. For a select question the value ' +
    'must be one of its offered options; for a confirm question pass "yes" or "no".',
  Type.Object({
    sessionId: Type.String(),
    value: Type.String({ description: 'The answer' }),
    requestId: Type.Optional(Type.String()),
  }),
  'session_answer',
  (data) => `Answered: ${String((data as { answered?: unknown })?.answered)}`,
  [
    'Never answer a clarifying question unless the right answer is genuinely clear from the project. Leaving it for the user is the correct default.',
  ],
)

tool(
  'git_status',
  'Git status',
  'Branch, dirty-file count, worktree state and main-repo path for a folder. ' +
    'Use it to tell whether a session has uncommitted work or has already landed.',
  // Required rather than optional: a tool whose every field is optional is
  // called with no arguments sooner or later, which is the empty-arguments
  // failure again. "." means this project.
  Type.Object({
    workspacePath: Type.String({
      description: 'Folder to inspect. Pass "." for this project.',
    }),
  }),
  'git_status',
  (data) => JSON.stringify(data, null, 2),
)

tool(
  'memory_read',
  'Read your memory',
  'Read your durable notes for this project. Your conversation gets compacted over time; ' +
    'these notes do not. Read them at the start of a sweep.',
  // Required for the same reason as `fleet_status`; the host ignores it,
  // but it shows in the transcript as why you went looking.
  Type.Object({
    purpose: Type.String({ description: 'One short phrase: why you are reading memory now' }),
  }),
  'memory_read',
  (data) => {
    const content = (data as { content?: string })?.content ?? ''
    return content.trim().length === 0 ? '(memory is empty)' : content
  },
)

tool(
  'memory_write',
  'Write your memory',
  'Replace your durable notes for this project. Keep them short and current — ' +
    'rewrite the file rather than appending, since you re-read all of it every time.',
  Type.Object({ content: Type.String({ description: 'The full new contents' }) }),
  'memory_write',
  () => 'Memory updated.',
)

tool(
  'propose_work',
  'Propose work',
  'Suggest a new session. By default this only puts a suggestion in front of the user; ' +
    'it starts a session directly only when the user has turned autopilot on.',
  Type.Object({
    title: Type.String({ description: 'Short name for the work' }),
    prompt: Type.String({ description: 'The first message that session should receive' }),
    workspacePath: Type.Optional(Type.String()),
  }),
  'propose_work',
  (data) =>
    (data as { started?: boolean })?.started
      ? 'Started a session for it.'
      : `Suggested to the user (${String((data as { reason?: string })?.reason ?? 'not started')}).`,
)

tool(
  'publish_digest',
  'Publish digest',
  "Publish your findings to pidex's home screen. Call this ONCE at the end of a sweep. " +
    'The headline is one line the user sees at a glance. Mark items "attention" only when ' +
    'the user genuinely needs to act, "suggestion" for things you recommend, "note" otherwise.',
  Type.Object({
    headline: Type.String({ description: 'One line summarizing the project right now' }),
    // A union, not an array, on purpose. Opus 5 on Bedrock sends this field
    // as a JSON-encoded STRING, and pi validates the schema before the
    // handler runs — so a strict array rejected every publish with
    // "items.0: must be object". Observed 4 times out of 4 in session
    // 01a04394: the model reformatted and retried and never recovered,
    // which is what "the orchestrator does nothing" looked like from the
    // outside. `normalizeDigestItems` coerces both shapes below.
    items: Type.Optional(
      Type.Union([
        Type.Array(
          Type.Object({
            kind: Type.String({ description: 'attention | suggestion | note' }),
            text: Type.String(),
            sessionPath: Type.Optional(
              Type.String({ description: 'Session file path this item is about' }),
            ),
            startPrompt: Type.Optional(
              Type.String({
                description:
                  'For a suggestion the user could act on: the first message a new session ' +
                  'should receive. Renders as a one-click "Start this" button.',
              }),
            ),
          }),
        ),
        Type.String({ description: 'A JSON array of the same items, encoded as a string' }),
      ]),
    ),
  }),
  'publish_digest',
  (data) => `Published ${String((data as { published?: number })?.published ?? 0)} item(s).`,
  ['Publish exactly one digest per sweep, as the last thing you do.'],
)

/**
 * Register every tool above. The registration loop is deliberately dumb: the
 * contract lives in `ORCHESTRATOR_TOOLS`, which `orchestrator.test.ts` reads
 * to check the tool table in `docs/orchestration.md` still matches.
 */
export default function orchestratorExtension(pi: PiExtensionApi): void {
  for (const spec of ORCHESTRATOR_TOOLS) {
    pi.registerTool({
      name: spec.name,
      label: spec.label,
      description: spec.description,
      parameters: spec.parameters,
      ...(spec.guidelines ? { promptGuidelines: spec.guidelines } : {}),
      async execute(
        _toolCallId: string,
        params: Record<string, unknown>,
        _signal: unknown,
        _onUpdate: unknown,
        ctx: ExtensionContext,
      ) {
        return present(
          await callPidex(ctx, spec.command, coerceParams(params ?? {})),
          spec.summarize,
        )
      },
    })
  }
}

export { ORCHESTRATOR_TOOLS }
