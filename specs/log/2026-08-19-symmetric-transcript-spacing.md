# 2026-08-19 — Symmetric transcript spacing: one step at every boundary

Follow-up to P13's row-based spacing rewrite: the two-step scheme (`pt-1`
inside a turn + the "final prose gets a full beat" rule after an activity
card) left each tool group asymmetric — 4px from the text above and 12px from
the text below, and every mid-turn prose block 12px above and 4px below.
Reviewing the transcript made the mismatch visible; the gaps above and below
a message or tool group should be equal.

`spacingFor` is back to one step (`STREAM_GAP`, `pt-3`) at every non-first
boundary; `STREAM_GAP_TIGHT`, the divider special case and the
`isAssistantSide` helper are deleted — `buildTranscriptRows` merges tool
rounds into one activity row, so the in-turn step had nothing left to
differentiate. Grouping is carried by ink, not air: the activity card's
border and surface, the user bubble, weight/colour contrast. This also
restores P11 Phase 1's documented intent ("one class for all non-first
boundaries"), which P13's rework had quietly departed from.

Coverage: `spacing.test.ts` asserts the symmetry property directly — for
every interior row of a mixed turn, the leading space it owns equals the
leading space its successor owns, and both sides of a mid-turn tool group
match. 659 unit tests, typecheck, lint and prettier green.
