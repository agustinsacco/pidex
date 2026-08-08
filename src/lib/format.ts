/** Number and duration formatters shared across surfaces. */

/**
 * Compact token count: `1.5M`, `12k`, `999`.
 *
 * Sub-1k values are exact. The `k` tier keeps one decimal until 100k, past
 * which the extra digit is noise in a dense UI.
 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`
  return String(n)
}

/** Elapsed time for tool runs: `840ms`, `1.4s`, `2m 5s`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

/** Byte size for streamed payloads: `812 B`, `12.4 KB`, `1.2 MB`. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
