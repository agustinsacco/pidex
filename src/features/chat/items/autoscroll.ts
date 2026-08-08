/**
 * Auto-scroll ("follow the stream") policy for the transcript.
 *
 * Deriving "is the user pinned to the bottom?" from geometry alone is what made
 * scrolling up during a stream impossible: the virtualizer keeps correcting its
 * estimated row heights while content arrives, so `scrollHeight` shrinks, the
 * browser clamps `scrollTop`, and the resulting scroll event looks exactly like
 * "the user is at the bottom again" — which re-pinned the view and yanked the
 * reader back down mid-sentence.
 *
 * The fix is to treat a scroll event whose `scrollHeight` changed as layout, not
 * intent, and to require an explicit gesture (or landing at the very bottom) to
 * change the pin state. Pure so it can be tested without a DOM.
 */

/** Landing this close to the bottom counts as "follow again". */
export const REPIN_PX = 24
/** Scrolling at least this far from the bottom counts as "stop following". */
export const UNPIN_PX = 96

export interface ScrollSample {
  /** `scrollHeight - scrollTop - clientHeight`. */
  distanceFromBottom: number
  /** True when `scrollHeight` differs from the previous sample. */
  heightChanged: boolean
}

/**
 * Next pin state for a scroll event. Keeps the current state when the event was
 * (or may have been) produced by re-measurement rather than by the user, and in
 * the dead band between the two thresholds.
 */
export function nextPinnedState(current: boolean, sample: ScrollSample): boolean {
  if (sample.heightChanged) return current
  if (sample.distanceFromBottom <= REPIN_PX) return true
  if (sample.distanceFromBottom >= UNPIN_PX) return false
  return current
}

/** Wheel/trackpad gestures that mean "I want to read back". */
export function isScrollBackIntent(deltaY: number): boolean {
  return deltaY < 0
}

/** Keys that move the viewport away from the tail. */
const SCROLL_BACK_KEYS = new Set(['PageUp', 'ArrowUp', 'Home'])

export function isScrollBackKey(key: string): boolean {
  return SCROLL_BACK_KEYS.has(key)
}
