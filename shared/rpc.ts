/**
 * pi RPC protocol types, mirrored from the installed
 * @earendil-works/pi-coding-agent (verified against 0.78.0):
 *   dist/modes/rpc/rpc-types.d.ts
 *   docs/rpc.md
 *
 * Self-contained on purpose — pidex spawns pi as a subprocess and never
 * imports its code, so the contract is duplicated here and unit-tested.
 */

// ---------- content blocks ----------

export interface TextContent {
  type: 'text'
  text: string
}

export interface ImageContent {
  type: 'image'
  data: string
  mimeType: string
}

export interface ThinkingContent {
  type: 'thinking'
  thinking: string
}

export interface ToolCallContent {
  type: 'toolCall'
  id: string
  name: string
  arguments: Record<string, unknown>
}

export type AssistantContentBlock = TextContent | ThinkingContent | ToolCallContent
export type UserContentBlock = TextContent | ImageContent

// ---------- models ----------

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface ModelCost {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface Model {
  id: string
  name: string
  api: string
  provider: string
  baseUrl?: string
  reasoning: boolean
  input: string[]
  contextWindow: number
  maxTokens: number
  cost: ModelCost
  [key: string]: unknown
}

// ---------- messages ----------

export type StopReason = 'stop' | 'length' | 'toolUse' | 'error' | 'aborted'

export interface Usage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost?: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
}

export interface UserMessage {
  role: 'user'
  content: string | UserContentBlock[]
  timestamp?: number
  attachments?: unknown[]
}

export interface AssistantMessage {
  role: 'assistant'
  content: AssistantContentBlock[]
  api?: string
  provider?: string
  model?: string
  usage?: Usage
  stopReason?: StopReason
  errorMessage?: string
  timestamp?: number
}

export interface ToolResultMessage {
  role: 'toolResult'
  toolCallId: string
  toolName: string
  content: (TextContent | ImageContent)[]
  details?: unknown
  isError: boolean
  timestamp?: number
}

export interface BashExecutionMessage {
  role: 'bashExecution'
  command: string
  output: string
  exitCode: number | null
  cancelled: boolean
  truncated: boolean
  fullOutputPath?: string | null
  excludeFromContext?: boolean
  timestamp?: number
}

/** Extension-injected messages and other roles that may appear in history. */
export interface CustomMessage {
  role: 'custom' | 'customMessage'
  customType?: string
  content?: unknown
  display?: boolean
  details?: unknown
  timestamp?: number
  [key: string]: unknown
}

export interface BranchSummaryMessage {
  role: 'branchSummary'
  summary: string
  fromId?: string
  timestamp?: number
  [key: string]: unknown
}

export interface CompactionSummaryMessage {
  role: 'compactionSummary'
  summary: string
  tokensBefore?: number
  timestamp?: number
  [key: string]: unknown
}

export type AgentMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | BashExecutionMessage
  | CustomMessage
  | BranchSummaryMessage
  | CompactionSummaryMessage

// ---------- assistant streaming deltas ----------

export type AssistantMessageEvent =
  | { type: 'start'; partial?: AssistantMessage }
  | { type: 'text_start'; contentIndex: number; partial?: AssistantMessage }
  | { type: 'text_delta'; contentIndex: number; delta: string; partial?: AssistantMessage }
  | { type: 'text_end'; contentIndex: number; content?: string; partial?: AssistantMessage }
  | { type: 'thinking_start'; contentIndex: number; partial?: AssistantMessage }
  | { type: 'thinking_delta'; contentIndex: number; delta: string; partial?: AssistantMessage }
  | { type: 'thinking_end'; contentIndex: number; content?: string; partial?: AssistantMessage }
  | { type: 'toolcall_start'; contentIndex: number; partial?: AssistantMessage }
  | { type: 'toolcall_delta'; contentIndex: number; delta: string; partial?: AssistantMessage }
  | {
      type: 'toolcall_end'
      contentIndex: number
      toolCall?: ToolCallContent
      partial?: AssistantMessage
    }
  | { type: 'done'; reason: 'stop' | 'length' | 'toolUse'; message?: AssistantMessage }
  | { type: 'error'; reason: 'aborted' | 'error'; error?: unknown; message?: AssistantMessage }

// ---------- events (stdout stream, no `id`) ----------

export interface ToolPartialResult {
  content: (TextContent | ImageContent)[]
  details?: unknown
}

export type PiEvent =
  | { type: 'agent_start' }
  | { type: 'agent_end'; messages: AgentMessage[] }
  | { type: 'turn_start' }
  | { type: 'turn_end'; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: 'message_start'; message: AgentMessage }
  | { type: 'message_update'; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: 'message_end'; message: AgentMessage }
  | {
      type: 'tool_execution_start'
      toolCallId: string
      toolName: string
      args: Record<string, unknown>
    }
  | {
      type: 'tool_execution_update'
      toolCallId: string
      toolName: string
      args: Record<string, unknown>
      partialResult: ToolPartialResult
    }
  | {
      type: 'tool_execution_end'
      toolCallId: string
      toolName: string
      result: ToolPartialResult
      isError: boolean
    }
  | { type: 'queue_update'; steering: string[]; followUp: string[] }
  | { type: 'compaction_start'; reason: CompactionReason }
  | {
      type: 'compaction_end'
      reason: CompactionReason
      result: CompactionResult | null
      aborted: boolean
      willRetry?: boolean
      errorMessage?: string
    }
  | {
      type: 'auto_retry_start'
      attempt: number
      maxAttempts: number
      delayMs: number
      errorMessage: string
    }
  | { type: 'auto_retry_end'; success: boolean; attempt: number; finalError?: string }
  | { type: 'extension_error'; extensionPath?: string; event?: string; error: string }

export type CompactionReason = 'manual' | 'threshold' | 'overflow'

export interface CompactionResult {
  summary: string
  firstKeptEntryId: string
  tokensBefore: number
  details?: unknown
}

// ---------- commands (stdin) ----------

export type StreamingBehavior = 'steer' | 'followUp'
export type QueueMode = 'all' | 'one-at-a-time'

export type RpcCommand =
  | {
      id?: string
      type: 'prompt'
      message: string
      images?: ImageContent[]
      streamingBehavior?: StreamingBehavior
    }
  | { id?: string; type: 'steer'; message: string; images?: ImageContent[] }
  | { id?: string; type: 'follow_up'; message: string; images?: ImageContent[] }
  | { id?: string; type: 'abort' }
  | { id?: string; type: 'new_session'; parentSession?: string }
  | { id?: string; type: 'get_state' }
  | { id?: string; type: 'set_model'; provider: string; modelId: string }
  | { id?: string; type: 'cycle_model' }
  | { id?: string; type: 'get_available_models' }
  | { id?: string; type: 'set_thinking_level'; level: ThinkingLevel }
  | { id?: string; type: 'cycle_thinking_level' }
  | { id?: string; type: 'set_steering_mode'; mode: QueueMode }
  | { id?: string; type: 'set_follow_up_mode'; mode: QueueMode }
  | { id?: string; type: 'compact'; customInstructions?: string }
  | { id?: string; type: 'set_auto_compaction'; enabled: boolean }
  | { id?: string; type: 'set_auto_retry'; enabled: boolean }
  | { id?: string; type: 'abort_retry' }
  | { id?: string; type: 'bash'; command: string; excludeFromContext?: boolean }
  | { id?: string; type: 'abort_bash' }
  | { id?: string; type: 'get_session_stats' }
  | { id?: string; type: 'export_html'; outputPath?: string }
  | { id?: string; type: 'switch_session'; sessionPath: string }
  | { id?: string; type: 'fork'; entryId: string }
  | { id?: string; type: 'clone' }
  | { id?: string; type: 'get_fork_messages' }
  | { id?: string; type: 'get_last_assistant_text' }
  | { id?: string; type: 'set_session_name'; name: string }
  | { id?: string; type: 'get_messages' }
  | { id?: string; type: 'get_commands' }

export type RpcCommandType = RpcCommand['type']

// ---------- responses ----------

export interface RpcSessionState {
  model?: Model | null
  thinkingLevel: ThinkingLevel
  isStreaming: boolean
  isCompacting: boolean
  steeringMode: QueueMode
  followUpMode: QueueMode
  sessionFile?: string
  sessionId: string
  sessionName?: string
  autoCompactionEnabled: boolean
  messageCount: number
  pendingMessageCount: number
}

export interface SessionStats {
  sessionFile?: string
  sessionId: string
  userMessages: number
  assistantMessages: number
  toolCalls: number
  toolResults: number
  totalMessages: number
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
  cost: number
  contextUsage?: {
    tokens: number | null
    contextWindow: number
    percent: number | null
  }
}

export interface BashResult {
  output: string
  exitCode: number | null
  cancelled: boolean
  truncated: boolean
  fullOutputPath?: string
}

export interface SourceInfo {
  path: string
  source: string
  scope: 'user' | 'project' | 'temporary'
  origin: 'package' | 'top-level'
  baseDir?: string
}

export interface RpcSlashCommand {
  name: string
  description?: string
  source: 'extension' | 'prompt' | 'skill'
  sourceInfo?: SourceInfo
}

interface RpcResponseBase {
  id?: string
  type: 'response'
  command: string
}

export interface RpcSuccessResponse<TData = unknown> extends RpcResponseBase {
  success: true
  data?: TData
}

export interface RpcErrorResponse extends RpcResponseBase {
  success: false
  error: string
}

export type RpcResponse<TData = unknown> = RpcSuccessResponse<TData> | RpcErrorResponse

/** Per-command response data payloads. */
export interface RpcResponseDataMap {
  prompt: undefined
  steer: undefined
  follow_up: undefined
  abort: undefined
  new_session: { cancelled: boolean }
  get_state: RpcSessionState
  set_model: Model
  cycle_model: { model: Model; thinkingLevel: ThinkingLevel; isScoped: boolean } | null
  get_available_models: { models: Model[] }
  set_thinking_level: undefined
  cycle_thinking_level: { level: ThinkingLevel } | null
  set_steering_mode: undefined
  set_follow_up_mode: undefined
  compact: CompactionResult
  set_auto_compaction: undefined
  set_auto_retry: undefined
  abort_retry: undefined
  bash: BashResult
  abort_bash: undefined
  get_session_stats: SessionStats
  export_html: { path: string }
  switch_session: { cancelled: boolean }
  fork: { text: string; cancelled: boolean }
  clone: { cancelled: boolean }
  get_fork_messages: { messages: Array<{ entryId: string; text: string }> }
  get_last_assistant_text: { text: string | null }
  set_session_name: undefined
  get_messages: { messages: AgentMessage[] }
  get_commands: { commands: RpcSlashCommand[] }
}

/**
 * `RpcResponseDataMap` is maintained by hand alongside the `RpcCommand` union.
 * These assertions fail to compile if the two ever drift — a missing key or a
 * stale leftover — instead of surfacing as an `undefined` payload at runtime.
 */
type AssertNever<T extends never> = T
export type _NoMissingResponseKeys = AssertNever<Exclude<RpcCommandType, keyof RpcResponseDataMap>>
export type _NoExtraResponseKeys = AssertNever<Exclude<keyof RpcResponseDataMap, RpcCommandType>>

// ---------- extension UI sub-protocol ----------

export type ExtensionUIRequest =
  | {
      type: 'extension_ui_request'
      id: string
      method: 'select'
      title: string
      options: string[]
      timeout?: number
    }
  | {
      type: 'extension_ui_request'
      id: string
      method: 'confirm'
      title: string
      message: string
      timeout?: number
    }
  | {
      type: 'extension_ui_request'
      id: string
      method: 'input'
      title: string
      placeholder?: string
      timeout?: number
    }
  | {
      type: 'extension_ui_request'
      id: string
      method: 'editor'
      title: string
      prefill?: string
    }
  | {
      type: 'extension_ui_request'
      id: string
      method: 'notify'
      message: string
      notifyType?: 'info' | 'warning' | 'error'
    }
  | {
      type: 'extension_ui_request'
      id: string
      method: 'setStatus'
      statusKey: string
      statusText: string | undefined
    }
  | {
      type: 'extension_ui_request'
      id: string
      method: 'setWidget'
      widgetKey: string
      widgetLines: string[] | undefined
      widgetPlacement?: 'aboveEditor' | 'belowEditor'
    }
  | { type: 'extension_ui_request'; id: string; method: 'setTitle'; title: string }
  | { type: 'extension_ui_request'; id: string; method: 'set_editor_text'; text: string }

export type ExtensionUIResponse =
  | { type: 'extension_ui_response'; id: string; value: string }
  | { type: 'extension_ui_response'; id: string; confirmed: boolean }
  | { type: 'extension_ui_response'; id: string; cancelled: true }
