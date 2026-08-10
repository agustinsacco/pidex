/** Pure pref helpers, separate from electron-store so tests can import them. */

/**
 * Drop the oldest seen-markers once the map outgrows `max`, keeping the
 * `keep` newest. Hysteresis (500 → 400 by default) so the prune doesn't
 * rewrite the map on every mark.
 */
export function pruneSeenSessions(
  seen: Record<string, number>,
  max = 500,
  keep = 400,
): Record<string, number> {
  const entries = Object.entries(seen)
  if (entries.length <= max) return seen
  entries.sort((a, b) => b[1] - a[1])
  return Object.fromEntries(entries.slice(0, keep))
}
