/**
 * Account rate-limit state, as reported by the Claude Code provider
 * (`@saccolabs/pi-claude-cli` ≥ 0.4.5) over pi's status channel.
 *
 * Present only for sessions served by that provider — every other provider
 * simply never pushes this key, so the UI shows nothing rather than an
 * empty section.
 *
 * Deliberately not utilization percentages: those come from
 * `anthropic-ratelimit-unified-*` response headers, which the CLI consumes
 * in-process and never forwards. What we get is the window and its reset,
 * which is the actionable part — "when do I get capacity back".
 */

export const RATE_LIMIT_STATUS_KEY = 'claude-rate-limit'

export interface ClaudeRateLimit {
  /** "allowed" while requests are being served; "rejected" when capped. */
  status: string | null
  /** Unix seconds when the window resets, when known. */
  resetsAt: number | null
  /** e.g. "five_hour". */
  windowType: string | null
  isUsingOverage: boolean
  overageStatus: string | null
}

export function parseRateLimit(statusText: string | undefined): ClaudeRateLimit | null {
  if (!statusText) return null
  try {
    const raw = JSON.parse(statusText) as Record<string, unknown>
    const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
    const resetsAt = typeof raw.resetsAt === 'number' && raw.resetsAt > 0 ? raw.resetsAt : null
    const status = str(raw.status)
    const windowType = str(raw.rateLimitType)
    // A payload with none of the three useful fields is not worth a section.
    if (!status && !resetsAt && !windowType) return null
    return {
      status,
      resetsAt,
      windowType,
      isUsingOverage: raw.isUsingOverage === true,
      overageStatus: str(raw.overageStatus),
    }
  } catch {
    return null
  }
}

/** "five_hour" → "5-hour limit"; unknown types pass through readably. */
export function windowLabel(windowType: string | null): string {
  switch (windowType) {
    case 'five_hour':
      return '5-hour limit'
    case 'seven_day':
      return 'Weekly limit'
    case 'seven_day_oauth_apps':
      return 'Weekly limit (apps)'
    default:
      return windowType ? windowType.replace(/_/g, ' ') : 'Usage limit'
  }
}

/**
 * "Resets in 2 hr 24 min". Returns null once the reset has passed, since a
 * stale countdown is worse than no countdown — the next turn re-reports.
 */
export function resetLabel(resetsAt: number | null, nowMs: number = Date.now()): string | null {
  if (resetsAt === null) return null
  const seconds = resetsAt - Math.floor(nowMs / 1000)
  if (seconds <= 0) return null
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  if (hours > 0) return `Resets in ${hours} hr${minutes > 0 ? ` ${minutes} min` : ''}`
  return `Resets in ${Math.max(1, minutes)} min`
}
