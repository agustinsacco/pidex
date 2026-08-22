/**
 * Runaway-burn detection from session token stats.
 *
 * A provider can bill enormously while accomplishing nothing: a tool loop that
 * re-sends context it already delivered spends its whole budget on input and
 * cache tokens, and the only visible symptom is that the numbers climb. On
 * 2026-08-21 that pattern consumed ~46M tokens across three concurrent pidex
 * sessions in roughly twenty minutes, peaking at 3.5M tokens/minute, and
 * nothing in the stack remarked on it.
 *
 * Two signals together, because neither alone is trustworthy:
 *
 *   - RATE. Healthy minutes in that day's data ran 27k–200k billed tokens;
 *     the runaway burst ran 1.4M–3.5M. The thresholds sit in the gap.
 *   - YIELD. Output tokens as a share of billed. Healthy sessions ran a few
 *     percent; the runaway ones ran 0.28% and 0.53%. Rate alone would flag a
 *     legitimate large-context session that is genuinely working, so a warning
 *     needs both a high rate and near-zero yield.
 */

/** One observation of a session's cumulative counters. */
export interface BurnSample {
  /** Epoch milliseconds. */
  at: number
  /** Cumulative billed tokens: input + output + cacheRead + cacheWrite. */
  billed: number
  /** Cumulative output tokens. */
  output: number
}

export interface BurnAssessment {
  /** Billed tokens per minute across the sampled window. */
  tokensPerMinute: number
  /** Output tokens as a fraction (0–1) of billed tokens in the window. */
  yield: number
  level: 'normal' | 'elevated' | 'runaway'
}

/** Trailing window. Long enough to smooth one slow turn, short enough to react. */
const WINDOW_MS = 90_000

/** Ignore windows shorter than this — two fast samples make any rate look huge. */
const MIN_SPAN_MS = 20_000

const ELEVATED_TPM = 400_000
const RUNAWAY_TPM = 1_000_000

/** Below this share of output, the session is spending without producing. */
const STALLED_YIELD = 0.02

/**
 * Assess the trailing window. Returns null when there is not yet enough
 * history to say anything honest — callers should render nothing, not "normal".
 */
export function assessBurn(samples: readonly BurnSample[], now: number): BurnAssessment | null {
  const window = samples.filter((s) => now - s.at <= WINDOW_MS)
  const first = window[0]
  const last = window[window.length - 1]
  if (!first || !last || first === last) return null

  const spanMs = last.at - first.at
  if (spanMs < MIN_SPAN_MS) return null

  // Counters are cumulative and monotonic; a decrease means the session was
  // reset or compacted, so the window is not comparable.
  const billed = last.billed - first.billed
  const output = last.output - first.output
  if (billed <= 0 || output < 0) return null

  const tokensPerMinute = (billed / spanMs) * 60_000
  const tokenYield = output / billed

  let level: BurnAssessment['level'] = 'normal'
  if (tokensPerMinute >= RUNAWAY_TPM && tokenYield < STALLED_YIELD) {
    level = 'runaway'
  } else if (tokensPerMinute >= ELEVATED_TPM && tokenYield < STALLED_YIELD) {
    level = 'elevated'
  }

  return { tokensPerMinute, yield: tokenYield, level }
}

/**
 * Per-session sample history. Samples arrive from `get_session_stats` polling,
 * which fires on every completed sub-step of a turn, so the buffer is trimmed
 * to the window on write rather than growing for the life of a session.
 */
const history = new Map<string, BurnSample[]>()

export function recordBurnSample(sessionId: string, sample: BurnSample): void {
  const kept = (history.get(sessionId) ?? []).filter((s) => sample.at - s.at <= WINDOW_MS)
  kept.push(sample)
  history.set(sessionId, kept)
}

export function burnSamples(sessionId: string): readonly BurnSample[] {
  return history.get(sessionId) ?? []
}

export function clearBurnSamples(sessionId: string): void {
  history.delete(sessionId)
}
