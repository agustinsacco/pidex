import { describe, expect, it } from 'vitest'
import {
  isScrollBackIntent,
  isScrollBackKey,
  nextPinnedState,
  REPIN_PX,
  UNPIN_PX,
} from './autoscroll'

describe('autoscroll pin policy', () => {
  it('keeps the current state when scrollHeight changed', () => {
    // The core regression: the virtualizer re-measuring rows during a stream
    // shrinks scrollHeight, which clamps scrollTop to the bottom and used to
    // re-pin the view and yank the reader down.
    expect(nextPinnedState(false, { distanceFromBottom: 0, heightChanged: true })).toBe(false)
    expect(nextPinnedState(true, { distanceFromBottom: 4000, heightChanged: true })).toBe(true)
  })

  it('re-pins only when a real scroll lands at the bottom', () => {
    expect(nextPinnedState(false, { distanceFromBottom: REPIN_PX - 1, heightChanged: false })).toBe(
      true,
    )
    expect(nextPinnedState(false, { distanceFromBottom: REPIN_PX, heightChanged: false })).toBe(
      true,
    )
  })

  it('unpins once the user is clearly reading back', () => {
    expect(nextPinnedState(true, { distanceFromBottom: UNPIN_PX, heightChanged: false })).toBe(
      false,
    )
    expect(nextPinnedState(true, { distanceFromBottom: 5000, heightChanged: false })).toBe(false)
  })

  it('holds state in the dead band between thresholds', () => {
    const middle = (REPIN_PX + UNPIN_PX) / 2
    expect(nextPinnedState(true, { distanceFromBottom: middle, heightChanged: false })).toBe(true)
    expect(nextPinnedState(false, { distanceFromBottom: middle, heightChanged: false })).toBe(false)
  })

  it('reads wheel direction and paging keys as read-back intent', () => {
    expect(isScrollBackIntent(-3)).toBe(true)
    expect(isScrollBackIntent(0)).toBe(false)
    expect(isScrollBackIntent(12)).toBe(false)
    for (const key of ['PageUp', 'ArrowUp', 'Home']) expect(isScrollBackKey(key)).toBe(true)
    for (const key of ['PageDown', 'End', 'a']) expect(isScrollBackKey(key)).toBe(false)
  })
})
