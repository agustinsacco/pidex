/**
 * The connector catalog: services pidex knows how to point the MCP adapter at
 * without the user typing a URL.
 *
 * Every entry here was checked against the vendor's own documentation. The
 * reason this is a curated list rather than free text is that the wrong URL
 * fails in a way that looks like broken auth: `mcp.notion.com/sse` is a real
 * endpoint that still resolves, and a legacy transport's failure surfaces as
 * "could not connect", not "you used the deprecated path".
 *
 * Auth is the adapter's job (OAuth 2.1 + PKCE + dynamic client registration,
 * tokens in the OS credential store). pidex only writes the config that lets
 * it work. See docs/specs/backlog/connectors.md.
 */
import type { McpServerConfig } from '@shared/mcp'

/**
 * How a connector authorizes.
 *
 * - `dcr` — the adapter registers itself dynamically. One click, no secrets.
 * - `confidential` — the provider does NOT support dynamic registration, so
 *   the user must create an app and supply its client id/secret, and the
 *   redirect URI has to match exactly. Slack is the only one so far.
 * - `oauth-or-key` — OAuth works, and an API key is a supported alternative.
 */
export type ConnectorAuthKind = 'dcr' | 'confidential' | 'oauth-or-key'

/** A regional/site variant of the same service, each with its own endpoint. */
export interface ConnectorVariant {
  id: string
  label: string
  url: string
}

export interface ConnectorEntry {
  id: string
  /** Display name. */
  name: string
  /** Default `mcpServers.<key>` name; also how a configured row is matched. */
  serverName: string
  summary: string
  authKind: ConnectorAuthKind
  docsUrl: string
  /** Single endpoint, for services with one. */
  url?: string
  /** Endpoint per region/site. Exactly one of `url` / `variants` is set. */
  variants?: { label: string; options: ConnectorVariant[] }
  /** A distinct read-only endpoint, offered as a checkbox when present. */
  readOnlyUrl?: string
  /** The thing that will bite, shown in the row. */
  caveat?: string
}

/**
 * The adapter's OAuth callback, from its own defaults
 * (`mcp-oauth-provider.ts`: port 19876, path `/callback`). Only relevant for
 * `confidential` connectors, where the provider requires the redirect URI to
 * be registered up front and match byte for byte.
 */
export const OAUTH_REDIRECT_URI = 'http://localhost:19876/callback'

export const CONNECTORS: ConnectorEntry[] = [
  {
    id: 'linear',
    name: 'Linear',
    serverName: 'linear',
    summary: 'Issues, projects, cycles and comments.',
    authKind: 'dcr',
    docsUrl: 'https://linear.app/docs/mcp',
    url: 'https://mcp.linear.app/mcp',
    readOnlyUrl: 'https://mcp.linear.app/mcp/readonly',
  },
  {
    id: 'notion',
    name: 'Notion',
    serverName: 'notion',
    summary: 'Read and update pages and databases you can already access.',
    authKind: 'dcr',
    docsUrl: 'https://developers.notion.com/guides/mcp/overview',
    url: 'https://mcp.notion.com/mcp',
  },
  {
    id: 'braintrust',
    name: 'Braintrust',
    serverName: 'braintrust',
    summary: 'Projects, experiments, datasets and logs.',
    authKind: 'oauth-or-key',
    docsUrl: 'https://www.braintrust.dev/docs/integrations/developer-tools/mcp',
    variants: {
      label: 'Data plane',
      options: [
        { id: 'us', label: 'US', url: 'https://api.braintrust.dev/mcp' },
        { id: 'eu', label: 'EU', url: 'https://api-eu.braintrust.dev/mcp' },
      ],
    },
    caveat: 'A Braintrust API key works instead of OAuth — see the MCP tab for bearer tokens.',
  },
  {
    id: 'datadog',
    name: 'Datadog',
    serverName: 'datadog',
    summary: 'Logs, metrics, traces, monitors and incidents.',
    authKind: 'dcr',
    docsUrl: 'https://docs.datadoghq.com/mcp_server/setup/',
    variants: {
      label: 'Datadog site',
      options: [
        { id: 'us1', label: 'US1', url: 'https://mcp.datadoghq.com/v1/mcp' },
        { id: 'us3', label: 'US3', url: 'https://mcp.us3.datadoghq.com/v1/mcp' },
        { id: 'us5', label: 'US5', url: 'https://mcp.us5.datadoghq.com/v1/mcp' },
        { id: 'eu1', label: 'EU1', url: 'https://mcp.datadoghq.eu/v1/mcp' },
        { id: 'ap1', label: 'AP1', url: 'https://mcp.ap1.datadoghq.com/v1/mcp' },
      ],
    },
    caveat:
      'The host is per site — the wrong one authorizes and then returns nothing. Append ?toolsets=… to trim a large tool set.',
  },
  {
    id: 'fellow',
    name: 'Fellow',
    serverName: 'fellow',
    summary: 'Meeting recaps, transcripts, action items and attendees.',
    authKind: 'dcr',
    docsUrl: 'https://help.fellow.ai/en/articles/12622641-fellow-s-mcp-server',
    url: 'https://fellow.app/mcp',
    caveat:
      'A workspace admin must first enable Security → Allow users to create MCP connections, or authorization fails.',
  },
  {
    id: 'slack',
    name: 'Slack',
    serverName: 'slack',
    summary: 'Channels, threads, messages and canvases.',
    authKind: 'confidential',
    docsUrl: 'https://docs.slack.dev/ai/slack-mcp-server',
    url: 'https://mcp.slack.com/mcp',
    caveat: `Slack does not support dynamic registration. Create a Slack app, register ${OAUTH_REDIRECT_URI} as its redirect URL, and paste its credentials below.`,
  },
]

/** What the user picked in a catalog row before pressing Add. */
export interface ConnectorChoice {
  /** Variant id, for connectors that have variants. */
  variant?: string
  readOnly?: boolean
  /** `confidential` connectors only. Stored in mcp.json, so env refs are ok. */
  clientId?: string
  clientSecret?: string
}

/** Resolve the endpoint a choice points at. Throws on an unknown variant. */
export function connectorUrl(entry: ConnectorEntry, choice: ConnectorChoice = {}): string {
  if (choice.readOnly && entry.readOnlyUrl) return entry.readOnlyUrl
  if (!entry.variants) {
    if (!entry.url) throw new Error(`${entry.id} has neither url nor variants`)
    return entry.url
  }
  const id = choice.variant ?? entry.variants.options[0]?.id
  const option = entry.variants.options.find((o) => o.id === id)
  if (!option) throw new Error(`${entry.id} has no variant "${String(choice.variant)}"`)
  return option.url
}

/**
 * The mcp.json entry for a connector.
 *
 * `auth: "oauth"` is explicit rather than relying on the adapter's
 * auto-detection: auto-detect turns OAuth *off* the moment custom headers
 * exist, and a user adding a header later would silently lose authorization.
 */
export function buildConnectorConfig(
  entry: ConnectorEntry,
  choice: ConnectorChoice = {},
): McpServerConfig {
  // `lazy-keep-alive`, not the adapter's `lazy` default: lazy drops the
  // connection after every call, so a signed-in connector sits in `cached`
  // and the row reads as though the token were gone. Keeping it alive costs
  // one idle socket per server and is what people mean by "connected".
  const config: McpServerConfig = {
    url: connectorUrl(entry, choice),
    auth: 'oauth',
    lifecycle: 'lazy-keep-alive',
  }
  if (entry.authKind === 'confidential') {
    const clientId = choice.clientId?.trim()
    const clientSecret = choice.clientSecret?.trim()
    if (!clientId || !clientSecret) {
      throw new Error(`${entry.name} needs a client ID and client secret`)
    }
    config.oauth = { clientId, clientSecret, redirectUri: OAUTH_REDIRECT_URI }
  }
  return config
}

/**
 * Which catalog entry a configured server is, if any.
 *
 * Matched on the URL, not the name: a user may call it `linear-rw`, and the
 * endpoint is what actually decides who they are talking to.
 */
export function connectorForUrl(url: string | undefined): ConnectorEntry | undefined {
  if (!url) return undefined
  const normalized = url.split('?')[0]?.replace(/\/+$/, '') ?? ''
  return CONNECTORS.find((entry) => {
    const candidates = [
      entry.url,
      entry.readOnlyUrl,
      ...(entry.variants?.options.map((o) => o.url) ?? []),
    ]
    return candidates.some((candidate) => candidate && normalized === candidate)
  })
}
