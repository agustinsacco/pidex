/**
 * Per-server MCP state, as published by pidex's bundled `pi-ext/mcp-status.ts`
 * over pi's status channel.
 *
 * The adapter emits `pi-mcp-adapter/status/v1` snapshots on pi's shared
 * extension event bus; the extension forwards them verbatim. Nothing here is
 * inferred from prose — the old MCP tab could only show the adapter's footer
 * sentence, which says nothing per server.
 */
export const MCP_STATUS_STATUS_KEY = 'pidex-mcp-status'

/** Mirrors the adapter's `McpServerStatusSnapshot["status"]`. */
export const MCP_SERVER_STATES = [
  'connected',
  'needs-auth',
  'failed',
  'cached',
  'disabled',
  'not-connected',
] as const

export type McpServerState = (typeof MCP_SERVER_STATES)[number]

export interface McpServerStatus {
  name: string
  state: McpServerState
  toolCount: number
  resourceCount?: number
  failedAgoSeconds?: number
}

export interface McpStatusSnapshot {
  servers: McpServerStatus[]
  totalTools: number
  connectedCount: number
  disabledCount: number
}

const num = (value: unknown): number => (typeof value === 'number' && value >= 0 ? value : 0)

/**
 * Parse the status payload. Untrusted input from a subprocess: anything
 * unexpected degrades to "no status", never to a wrong badge.
 */
export function parseMcpStatus(statusText: string | undefined): McpStatusSnapshot | null {
  if (!statusText) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(statusText)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const raw = parsed as { servers?: unknown; totalTools?: unknown }
  if (!Array.isArray(raw.servers)) return null

  const servers: McpServerStatus[] = []
  for (const entry of raw.servers) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name : ''
    if (!name) continue
    const state = MCP_SERVER_STATES.includes(record.status as McpServerState)
      ? (record.status as McpServerState)
      : 'not-connected'
    servers.push({
      name,
      state,
      toolCount: num(record.toolCount),
      ...(typeof record.resourceCount === 'number'
        ? { resourceCount: num(record.resourceCount) }
        : {}),
      ...(typeof record.failedAgoSeconds === 'number'
        ? { failedAgoSeconds: num(record.failedAgoSeconds) }
        : {}),
    })
  }

  return {
    servers,
    totalTools: num(raw.totalTools),
    connectedCount: servers.filter((s) => s.state === 'connected').length,
    disabledCount: servers.filter((s) => s.state === 'disabled').length,
  }
}

/** Human label for a row badge. */
export function stateLabel(state: McpServerState): string {
  switch (state) {
    case 'connected':
      return 'Connected'
    case 'needs-auth':
      return 'Needs sign-in'
    case 'failed':
      return 'Failed'
    case 'cached':
      return 'Idle (cached tools)'
    case 'disabled':
      return 'Disabled'
    case 'not-connected':
      return 'Not connected'
  }
}
