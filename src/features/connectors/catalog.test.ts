import { describe, expect, it } from 'vitest'
import {
  CONNECTORS,
  OAUTH_REDIRECT_URI,
  SLACK_APP_MANIFEST,
  SLACK_USER_SCOPES,
  buildConnectorConfig,
  connectorForUrl,
  connectorUrl,
} from './catalog'

describe('connector catalog', () => {
  it('points every endpoint at https streamable HTTP, never a legacy SSE path', () => {
    for (const entry of CONNECTORS) {
      const urls = [
        entry.url,
        entry.readOnlyUrl,
        ...(entry.variants?.options.map((o) => o.url) ?? []),
      ].filter((u): u is string => Boolean(u))
      expect(urls.length, entry.id).toBeGreaterThan(0)
      for (const url of urls) {
        expect(new URL(url).protocol, url).toBe('https:')
        // `/sse` still resolves at several vendors; its failures read as
        // broken auth rather than a deprecated transport.
        expect(url, url).not.toMatch(/\/sse\b/)
      }
    }
  })

  it('gives each entry exactly one endpoint source', () => {
    for (const entry of CONNECTORS) {
      expect(Boolean(entry.url) !== Boolean(entry.variants), entry.id).toBe(true)
    }
  })

  it('keeps ids, names and variant ids unique', () => {
    expect(new Set(CONNECTORS.map((c) => c.id)).size).toBe(CONNECTORS.length)
    expect(new Set(CONNECTORS.map((c) => c.serverName)).size).toBe(CONNECTORS.length)
    for (const entry of CONNECTORS) {
      const ids = entry.variants?.options.map((o) => o.id) ?? []
      expect(new Set(ids).size, entry.id).toBe(ids.length)
    }
  })

  it('defaults a variant connector to its first option', () => {
    const datadog = CONNECTORS.find((c) => c.id === 'datadog')!
    expect(connectorUrl(datadog)).toBe('https://mcp.datadoghq.com/v1/mcp')
    expect(connectorUrl(datadog, { variant: 'eu1' })).toBe('https://mcp.datadoghq.eu/v1/mcp')
  })

  it('refuses an unknown variant instead of silently using the default', () => {
    const datadog = CONNECTORS.find((c) => c.id === 'datadog')!
    expect(() => connectorUrl(datadog, { variant: 'us9' })).toThrow(/variant/)
  })

  it('swaps in the read-only endpoint only where one exists', () => {
    const linear = CONNECTORS.find((c) => c.id === 'linear')!
    expect(connectorUrl(linear, { readOnly: true })).toBe('https://mcp.linear.app/mcp/readonly')
    const notion = CONNECTORS.find((c) => c.id === 'notion')!
    expect(connectorUrl(notion, { readOnly: true })).toBe('https://mcp.notion.com/mcp')
  })

  it('writes an explicit auth mode so a later header cannot disable OAuth', () => {
    const notion = CONNECTORS.find((c) => c.id === 'notion')!
    expect(buildConnectorConfig(notion)).toEqual({
      url: 'https://mcp.notion.com/mcp',
      auth: 'oauth',
      lifecycle: 'lazy-keep-alive',
    })
  })

  it('writes a pre-registered client as a public PKCE client by default', () => {
    // Slack only accepts a loopback redirect URL from a PKCE app, and a PKCE
    // app's token exchange carries no secret. An empty secret must not reach
    // mcp.json: the adapter reads one as client_secret_post.
    const slack = CONNECTORS.find((c) => c.id === 'slack')!
    expect(buildConnectorConfig(slack, { clientId: 'abc', clientSecret: '  ' })).toEqual({
      url: 'https://mcp.slack.com/mcp',
      auth: 'oauth',
      lifecycle: 'lazy-keep-alive',
      oauth: {
        clientId: 'abc',
        redirectUri: OAUTH_REDIRECT_URI,
        scope: SLACK_USER_SCOPES.join(' '),
      },
    })
  })

  it('keeps a client secret when a pre-PKCE app supplies one', () => {
    const slack = CONNECTORS.find((c) => c.id === 'slack')!
    const oauth = buildConnectorConfig(slack, { clientId: 'abc', clientSecret: 'shh' })
      .oauth as Record<string, string>
    expect(oauth.clientSecret).toBe('shh')
  })

  it('refuses to write a pre-registered connector with no client ID', () => {
    const slack = CONNECTORS.find((c) => c.id === 'slack')!
    expect(() => buildConnectorConfig(slack)).toThrow(/client ID/)
    expect(() => buildConnectorConfig(slack, { clientId: ' ', clientSecret: 'x' })).toThrow(
      /client ID/,
    )
  })

  it('asks Slack for exactly the scopes its own manifest declares', () => {
    // With no scope configured the MCP SDK requests every scope in the
    // server's protected-resource metadata, and Slack fails the whole
    // authorization for any scope the registered app does not declare.
    const manifest = JSON.parse(SLACK_APP_MANIFEST) as {
      oauth_config: { redirect_urls: string[]; pkce_enabled: boolean; scopes: { user: string[] } }
    }
    expect(manifest.oauth_config.scopes.user).toEqual(SLACK_USER_SCOPES)
    expect(manifest.oauth_config.redirect_urls).toEqual([OAUTH_REDIRECT_URI])
    expect(manifest.oauth_config.pkce_enabled).toBe(true)
  })

  it('recognises a configured server by endpoint, whatever it is named', () => {
    expect(connectorForUrl('https://mcp.linear.app/mcp/readonly')?.id).toBe('linear')
    expect(connectorForUrl('https://mcp.datadoghq.eu/v1/mcp?toolsets=apm')?.id).toBe('datadog')
    expect(connectorForUrl('https://mcp.notion.com/mcp/')?.id).toBe('notion')
    expect(connectorForUrl('https://mcp.example.com/mcp')).toBeUndefined()
    expect(connectorForUrl(undefined)).toBeUndefined()
  })

  it('makes new connectors keep their connection, not the adapter lazy default', () => {
    // `lazy` drops the socket after every call, so a signed-in connector
    // reports `cached` and the row used to offer "Sign in" for it.
    for (const entry of CONNECTORS) {
      const config =
        entry.authKind === 'preregistered'
          ? buildConnectorConfig(entry, { clientId: 'a' })
          : buildConnectorConfig(entry)
      expect(config.lifecycle).toBe('lazy-keep-alive')
    }
  })
})
