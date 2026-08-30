/**
 * Validation for the Claude Code auto-compact window setting
 * (Settings → Claude Code → Context window, stored as
 * `AppPrefs.claudeAutocompact`, passed as `PI_CLAUDE_CLI_AUTOCOMPACT`).
 *
 * Mirrors how pi-claude-cli 0.5.0 parses the value: `auto`, `off`, or a
 * token count from 100k to 1M — `k`/`M` suffixes accepted, bare numbers are
 * thousands (the CLI's own shorthand: `400` means 400k).
 *
 * Format alone is not enough: `77k` is well-formed but below the CLI's
 * floor, and the provider would silently fall back to its default — a
 * number the user typed must never mean something else than what they
 * typed, so the range is enforced here too.
 */
export function isValidAutocompactValue(raw: string): boolean {
  const lowered = raw.toLowerCase()
  if (lowered === 'auto' || lowered === 'off') return true
  const m = /^(\d+(?:\.\d+)?)\s*([km])?$/i.exec(raw)
  if (!m) return false
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return false
  const suffix = (m[2] ?? '').toLowerCase()
  const tokens =
    suffix === 'k' ? n * 1_000 : suffix === 'm' ? n * 1_000_000 : n < 100_000 ? n * 1_000 : n
  return tokens >= 100_000 && tokens <= 1_000_000
}
