/**
 * Reading the MCP adapter's OAuth conversation.
 *
 * The adapter drives OAuth through `ctx.ui.input()` and `ctx.ui.notify()`,
 * which reach pidex as ordinary extension-UI requests. pidex intercepts the
 * ones that belong to an authorization flow so it can open the browser and
 * show a connector card instead of a bare "paste this URL" text box.
 *
 * These are string contracts with a separately versioned package, so both
 * parsers are deliberately narrow and both fail closed: an unrecognised
 * message falls through to the generic dialog/toast, which is the pre-existing
 * behaviour and always usable. Source: `pi-mcp-adapter/commands.ts`.
 */
import { stripAnsi } from './ansi'

export interface OAuthPrompt {
  serverName: string
  authorizationUrl: string
}

/** First http(s) URL in the text, with any trailing punctuation removed. */
function firstUrl(text: string): string | undefined {
  const match = /https?:\/\/[^\s"'<>)\]]+/.exec(text)
  if (!match) return undefined
  return match[0].replace(/[.,;]+$/, '')
}

/**
 * The adapter's authorization prompt:
 *
 *   Complete <server> OAuth
 *
 *   <osc8 hyperlink>
 *   <authorization url>
 *
 *   Approve access, then paste the full localhost callback URL below.
 *
 * The hyperlink is an OSC 8 escape, so ANSI is stripped before matching.
 */
export function parseOAuthPrompt(message: string): OAuthPrompt | null {
  const text = stripAnsi(message)
  const header = /^\s*Complete\s+(.+?)\s+OAuth\b/.exec(text)
  if (!header) return null
  const serverName = header[1]?.trim()
  if (!serverName) return null
  const authorizationUrl = firstUrl(text)
  if (!authorizationUrl) return null
  try {
    const protocol = new URL(authorizationUrl).protocol
    if (protocol !== 'http:' && protocol !== 'https:') return null
  } catch {
    return null
  }
  return { serverName, authorizationUrl }
}

export interface AuthNotice {
  serverName: string
  outcome: 'success' | 'failure'
  detail?: string
}

/**
 * The adapter's own verdict on a flow, which is what actually tells pidex the
 * browser round-trip finished. Status snapshots follow, but they arrive on a
 * reconnect and can lag.
 */
export function parseAuthNotice(message: string): AuthNotice | null {
  const text = stripAnsi(message)
  const success = /^OAuth authentication successful for "(.+?)"/.exec(text)
  if (success?.[1]) return { serverName: success[1], outcome: 'success' }

  const failure = /^OAuth authentication failed for "(.+?)"/.exec(text)
  if (failure?.[1]) return { serverName: failure[1], outcome: 'failure' }

  const errored = /^Failed to authenticate "(.+?)":\s*(.*)$/.exec(text)
  if (errored?.[1]) {
    return {
      serverName: errored[1],
      outcome: 'failure',
      ...(errored[2]?.trim() ? { detail: errored[2].trim() } : {}),
    }
  }
  return null
}
