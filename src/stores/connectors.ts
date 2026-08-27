/**
 * The connector authorization flow.
 *
 * pidex does not implement OAuth and does not hold connector tokens. The MCP
 * adapter already does PKCE, dynamic client registration, a loopback callback
 * server and token custody in the OS credential store — so this store only
 * *drives* it: it sends the adapter's own `/mcp-auth <server>` command into a
 * live session (an extension command, so no model runs and no tokens are
 * spent), intercepts the authorization prompt, and opens the browser.
 *
 * The load-bearing rule, and the reason this is a store rather than a dialog:
 * **never auto-answer the adapter's pending input request.** pi's RPC has no
 * server→client cancel, so when the loopback callback wins the race the
 * adapter silently abandons its prompt and pidex is never told. An empty or
 * cancelled answer sent "to tidy up" wins that race instead and throws
 * `OAuth authentication cancelled` — killing a flow that already succeeded.
 * A pending request is left pending; only an explicit user Cancel answers it.
 *
 * See specs/backlog/connectors.md.
 */
import { create } from 'zustand'
import { piCallOk } from '@/lib/rpc'

export type ConnectFlow =
  | { phase: 'starting'; sessionId: string }
  | {
      phase: 'awaiting-browser'
      sessionId: string
      authorizationUrl: string
      /** Pending `extension_ui_request` id — the paste fallback answers this. */
      requestId: string
    }
  | { phase: 'connected' }
  | { phase: 'failed'; message: string }

interface ConnectorsState {
  /** serverName → flow. One flow per server; connectors are independent. */
  flows: Record<string, ConnectFlow>

  /** Send `/mcp-auth <server>` into `sessionId`. Costs no tokens. */
  connect: (sessionId: string, serverName: string) => Promise<void>
  /** Adapter asked for authorization: open the browser, show the card. */
  promptReceived: (input: {
    sessionId: string
    serverName: string
    authorizationUrl: string
    requestId: string
  }) => void
  /** The adapter's own verdict on a flow. */
  settle: (serverName: string, outcome: 'success' | 'failure', detail?: string) => void
  /** Answer the pending prompt with a pasted callback URL. */
  submitCallbackUrl: (serverName: string, url: string) => void
  /** Explicit user cancel — the only case where pidex answers the prompt. */
  cancel: (serverName: string) => void
  /** Clear a settled flow's card. */
  dismiss: (serverName: string) => void
  /** `/mcp logout <server>` — the adapter removes the stored credentials. */
  disconnect: (sessionId: string, serverName: string) => Promise<void>
  /** `/mcp reconnect <server>`. */
  reconnect: (sessionId: string, serverName: string) => Promise<void>
}

function setFlow(
  flows: Record<string, ConnectFlow>,
  serverName: string,
  flow: ConnectFlow | undefined,
): Record<string, ConnectFlow> {
  const next = { ...flows }
  if (flow) next[serverName] = flow
  else delete next[serverName]
  return next
}

/**
 * Extension commands are dispatched as prompts; pi runs them immediately and
 * they manage their own LLM interaction, which for `/mcp-*` is none at all.
 */
async function command(sessionId: string, message: string): Promise<boolean> {
  return piCallOk(sessionId, { type: 'prompt', message })
}

export const useConnectorsStore = create<ConnectorsState>((set, get) => ({
  flows: {},

  connect: async (sessionId, serverName) => {
    set((s) => ({ flows: setFlow(s.flows, serverName, { phase: 'starting', sessionId }) }))
    const ok = await command(sessionId, `/mcp-auth ${serverName}`)
    if (!ok) {
      set((s) => ({
        flows: setFlow(s.flows, serverName, {
          phase: 'failed',
          message: 'pi refused the /mcp-auth command — is the MCP adapter installed?',
        }),
      }))
    }
  },

  promptReceived: ({ sessionId, serverName, authorizationUrl, requestId }) => {
    set((s) => ({
      flows: setFlow(s.flows, serverName, {
        phase: 'awaiting-browser',
        sessionId,
        authorizationUrl,
        requestId,
      }),
    }))
    void window.pidex.invoke('app:openExternal', authorizationUrl).catch(() => {
      // The card shows the URL, so a blocked browser launch is recoverable.
    })
  },

  settle: (serverName, outcome, detail) => {
    set((s) => ({
      flows: setFlow(
        s.flows,
        serverName,
        outcome === 'success'
          ? { phase: 'connected' }
          : { phase: 'failed', message: detail ?? 'Authorization failed.' },
      ),
    }))
  },

  submitCallbackUrl: (serverName, url) => {
    const flow = get().flows[serverName]
    if (flow?.phase !== 'awaiting-browser') return
    void window.pidex.invoke('pi:extensionUiResponse', flow.sessionId, {
      type: 'extension_ui_response',
      id: flow.requestId,
      value: url.trim(),
    })
    set((s) => ({
      flows: setFlow(s.flows, serverName, { phase: 'starting', sessionId: flow.sessionId }),
    }))
  },

  cancel: (serverName) => {
    const flow = get().flows[serverName]
    if (flow?.phase === 'awaiting-browser') {
      void window.pidex.invoke('pi:extensionUiResponse', flow.sessionId, {
        type: 'extension_ui_response',
        id: flow.requestId,
        cancelled: true,
      })
    }
    set((s) => ({ flows: setFlow(s.flows, serverName, undefined) }))
  },

  dismiss: (serverName) => set((s) => ({ flows: setFlow(s.flows, serverName, undefined) })),

  disconnect: async (sessionId, serverName) => {
    await command(sessionId, `/mcp logout ${serverName}`)
    set((s) => ({ flows: setFlow(s.flows, serverName, undefined) }))
  },

  reconnect: async (sessionId, serverName) => {
    await command(sessionId, `/mcp reconnect ${serverName}`)
  },
}))
