# Reading back in the transcript, without being dragged to the tail

2026-08-30

## Symptom

Scrolling up after a turn finished snapped the view back to the bottom and
jittered. The jump-to-bottom pill was visible the whole time — the app knew
the reader had stopped following, and moved them anyway.

## Cause

Two independent faults, both triggered by the same event: an activity group is
expanded while it runs and collapses the moment it settles.

1. **The collapse shrinks the transcript, and the browser clamps `scrollTop`
   to the new maximum.** Nothing in `MessageList` defended the reader's
   position against the content getting shorter underneath them. Measured with
   an e2e probe on the 40-tool `manyitems` run: reading back at `scrollTop`
   324 of a 444 range, the run settled and the reader was moved to 0.
2. **The scroll events that follow that clamp re-pinned the view.**
   `nextPinnedState` treated "this sample is within 24px of the bottom" as the
   reader landing at the tail. The `heightChanged` guard only covers the one
   sample that coincides with the resize; the clamp's later samples look
   exactly like intent. With the pin restored, the follow effect then scrolled
   to the tail on the next render — the "sticks to the bottom" part.

## Fix

- `nextPinnedState` is one-way: geometry may stop the follow, never start it.
  Resuming is a gesture — `isFollowIntent` (wheel down at the tail), the new
  `isFollowKey` (End, or PageDown/ArrowDown/space from the tail), a scrollbar
  drag that ends at the tail, a downward flick settled at `scrollend`, the
  pill, or sending a message. The flick needs `scrollend` because the scroll
  lands long after its last wheel event; the wheel direction is what keeps the
  clamp of a shrinking transcript — which fires `scrollend` too — from
  qualifying.
- `tailFloor` keeps the content box at least as tall as the reader's viewport
  bottom while unpinned, so a shrink reserves off-screen space instead of
  clamping. The floor is sampled when read-back starts and only ever lowers,
  because re-sampling it on the way down would make the tail recede ahead of
  the reader and no scroll could reach it.

## Coverage

- `src/features/chat/items/autoscroll.test.ts` — the one-way pin rule, the
  follow keys, the floor.
- `e2e/smoke.spec.ts` "a settling run cannot drag a reader back to the tail" —
  the measured regression end to end, plus proof the reserved tail is not a
  trap (the pill still lands on the real end).
- `e2e/smoke.spec.ts` "reading back through a finished transcript is never
  fought" — 25 wheel notches up a 12-turn transcript, no notch may move the
  viewport down. Backed by a new `manyturns` stub scenario: `longstream` is
  one giant row, so it never exercised many-row read-back.
