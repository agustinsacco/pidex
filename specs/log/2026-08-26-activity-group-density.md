# 2026-08-26 — Activity group density: one left edge, one vertical step

The tool group read as loose and detached from the prose around it. Four
separate causes, all in the group's own chrome rather than in what it says.

- **Three rules owned one gap.** `spacingFor` returned 12px, the summary
  button added `py-1`, the card added `mt-1` — 20px between a paragraph and
  the first tool row, before prose line-height (1.65) added its own half-
  leading on top. `STREAM_GAP` is now `pt-2` (8px) and the summary button is
  `py-0.5`; with the leading that lands on the ~16px the reference shows.
- **The card was 14px round.** `rounded-lg` maps to `--px-radius-lg`, which is
  14px in this theme, not Tailwind's 8 — far too round for a 26px row. Now an
  explicit `rounded-[7px]`.
- **The card shouted.** `bg-surface` (white) on `--px-bg` (grey) _plus_ a full
  border is two containment signals for one group. The fill is gone; the
  hairline alone contains it, which also keeps the run visually subordinate to
  the prose it sits between.
- **Nothing lined up.** The card's left edge sat at x=0 while the summary text
  sat at 23px and row text at 29px — three left edges in one unit. The group
  is now **title-anchored**: prose, summary label and card edge all start at
  the same x (measured in the running app: 408 / 408 / 408), and everything
  that indents does so inside the card at `ROW_INSET` (16px).

Two consequences worth knowing:

- **The ✳ reasoning mark floats.** It used to reserve a 20px column in front
  of _every_ row for the sake of the few rows that have reasoning. It is now
  absolutely positioned inside `ROW_INSET`, so it costs no layout and rows
  with no reasoning are not pushed right by it.
- **Status indicators trail, they never lead.** The summary's live dot and its
  settled caret share one trailing slot, and `ToolCard`'s in-flight dot moved
  after the label. Leading them moved the text sideways at the exact moment a
  run settled — invisible at the old spacing, a glitch at the new one. The dot
  stays (rather than leaving the shimmer to carry it) because
  `prefers-reduced-motion` turns the shimmer off.

## The message copy affordance

Same complaint, different element: the assistant hover pill was a bordered
`⧉ Copy · 8/3/2026` box at `-top-2 right-0`, so it landed on the first line of
the answer it belonged to. It is now a 20px icon-only button parked in the
transcript column's right padding (`-right-[22px]`, inside `MessageList`'s
24px `px-6` gutter), which cannot cover a word and still adds no layout
height. The timestamp moved into the tooltip — shown inline it was the widest
thing there, and the user message it answers already carries the turn's time.
`CopyButton` gained an `icon` size and a `title` override for this.

## Claude-provider sessions

One group renders four row shapes, and two of them exist only under
`@saccolabs/pi-claude-cli`: CLI-side tool markers and sub-agent launches
(see [12-extensions.md](../12-extensions.md#how-provider-transcripts-render)).
They are authored in four different places in `ActivityGroup.tsx`, so the
failure mode is drift — one inset changes and a mixed run shows two left
edges inside one card. `ROW_INSET` is now a single exported constant, the
external-tool row was re-typed to match a `ToolCard` row (same `text-lg`, same
secondary/primary split, instead of the smaller `text-base` that made one run
look like two stitched transcripts), and
`src/features/chat/items/activityGroupRows.test.tsx` renders the mixed group
and asserts all four shapes share it.

Existing e2e: the density test's thresholds still hold (a settled row measures
29px against its 40px ceiling). The spacing assertion in "tool run: grouping,
in-flight animation, and clean streaming" was checking `>= 12` — it now pins
the real invariant instead: every row leads with exactly one step or, being
first, with none.
