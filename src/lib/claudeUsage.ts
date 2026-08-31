/**
 * Pure presentation helpers for the live plan-usage windows
 * (`claude:usageSnapshot`), shared by the context meter's popover and the
 * Settings → Claude Code tab so the two surfaces can't disagree about what
 * a window is called or what its bar means.
 */
import type { ClaudeUsageWindow } from '@shared/models'
import { resetLabel } from '@/features/chat/composer/rateLimit'

/** A bar's colour class by the thresholds every other meter in pidex uses. */
export function usageBarClass(percent: number): string {
  if (percent >= 100) return 'bg-danger'
  if (percent >= 75) return 'bg-warning'
  return 'bg-accent'
}

/** A percent's text colour, matching the bar. */
export function usageTextClass(percent: number): string {
  if (percent >= 100) return 'text-danger'
  if (percent >= 75) return 'text-warning'
  return 'text-text-secondary'
}

/**
 * The CLI renders labels for humans ("Current session" is the 5-hour block,
 * "Current week (all models)" the weekly window); pidex names them for what
 * they are, and passes unknown labels through verbatim rather than guessing.
 */
export function windowTitle(window: ClaudeUsageWindow): string {
  switch (window.kind) {
    case 'five_hour':
      return '5-hour window'
    case 'weekly':
      return 'Weekly window'
    case 'weekly_model': {
      const model = /^Current week \((.+)\)$/.exec(window.label)?.[1]
      return model ? `Weekly · ${model}` : window.label
    }
    default:
      return window.label
  }
}

/** "Resets in 2 hr 24 min" from a Unix-ms reset, or null once it has passed. */
export function windowResetLabel(resetsAt: number | null): string | null {
  if (resetsAt === null) return null
  return resetLabel(Math.floor(resetsAt / 1000))
}
