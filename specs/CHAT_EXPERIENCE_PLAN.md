# Chat / streaming / tool-call experience — review & plan

Audit of the RPC → reducer → render path against Claude Desktop, covering
the eight focus areas. Findings first, then the build order.

Reference shots: `chat-tool-calls.png`, `chat-file-chips.png`,
`chat-full-width.png`.

---

## What is already correct

Worth stating so we don't rebuild it:

- **RPC event coverage is complete** — all 16 events, all 12
  `assistantMessageEvent` delta types, verified by a replay test over a
  real 228-record captured session.
- **`tool_execution_update.partialResult` is replaced, not appended** —
  the one subtle protocol rule that's easy to get wrong.
- **Incremental reduction** — deltas touch one item; no whole-list rebuild.
- **Diff colouring exists** (`DiffView`, `bg-success/12` / `bg-danger/10`)
  and parses pi's display-diff format correctly.
- **Hover copy exists** on both user and assistant messages.

The gaps are in _presentation and motion_, not in protocol handling.

---

## 1 · Running-tool animation — **partially there, wrong shape**

Today: a generic `<Spinner/>` (rotating SVG) sits left of the collapsed row
while `status === 'running'`.

Reference: the row itself is **alive** — the label shimmers/pulses, and the
spinner is not a spinning circle but a subtle indeterminate state on the
text. Static rows and running rows should be distinguishable at a glance
without a hard spinner competing with the ✳ spark.

Plan:

- replace the per-row `Spinner` with a **shimmer on the verb label** (reuse
  `.thinking-shimmer`, already defined for thinking blocks)
- keep a small leading dot that pulses, drop the rotating circle
- when a tool ends, animate the row settling (150 ms colour/opacity ease),
  so completion is perceptible

Files: `tools/ToolCard.tsx`, `styles/index.css`.

## 2 · Tool-call grouping — **the biggest gap**

Today: `groupBlocks()` groups consecutive tool blocks into one array, but
each tool still renders as its **own independently-expanding row**. Five
tool calls = five separate collapsible rows stacked.

Reference: a run of tool calls collapses into **one summary line** —
`Edited IMPLEMENTATION_PROMPT.md, ran a command  +2 -2  ›` — and clicking
it expands to reveal **every call and every response** in that run.
`chat-file-chips.png` shows the same for creates: `Created 2 files, ran a
command +175 -207 ›`.

Plan:

- new `ToolRunGroup` component owning a run of tools
- collapsed state: one line, verbs summarised (`Edited 3 files, ran 2
commands`), aggregate `+N −M`, single chevron
- expanded: the existing per-tool cards, indented, with hairline separators
- a run containing a _running_ tool stays expanded and shows live output
- keep single-tool runs rendering as today (no wrapper chrome)

Files: new `tools/ToolRunGroup.tsx`, `MessageItem.tsx`, `tools/
toolSummaries.ts` (add an aggregate summariser).

## 3 · Streaming smoothness — **adopt `streamdown`**

Today: `react-markdown` + a hand-rolled `splitOpenFence()` that hides
trailing unclosed code fences. That handles fences and nothing else — an
unterminated `**bold`, a half-written table row, or a partial `[link](`
renders as raw punctuation mid-stream, then snaps.

`streamdown` (v2.5.0, "drop-in replacement for react-markdown, designed
for AI-powered streaming") ships `remend`, which repairs _all_ incomplete
markdown constructs per-token, plus `rehype-harden` for safety.

Plan:

- swap `Markdown.tsx`'s internals to `streamdown`, keeping our component
  overrides (Shiki code blocks, mermaid, chart, html preview, KaTeX)
- delete `splitOpenFence()` and its test once `remend` covers it
- keep the memoised wrapper: streamdown re-parses per token, so
  `React.memo` on the block boundary still matters
- **verify bundle impact** — it pulls its own mermaid; dedupe or alias to
  ours

Risk: moderate (swaps the core renderer). Gate behind the full e2e run.

Files: `components/markdown/Markdown.tsx`, `package.json`.

## 4 · pi "working" animation — **placeholder today**

Today: a literal `✳` glyph with a 1.6 s opacity pulse.

Reference: Claude's spark is a **drawn mark with staged motion** — rays
animating with slight rotation and scale, feeling alive rather than
blinking.

We ship `build/icon.svg` (the pidex/pi mark) — use it as the source rather
than a text glyph.

Plan:

- new `PiSpark.tsx`: inline SVG from the pi mark
- animate rays on staggered delays (rotate ~8°, scale 0.92→1, opacity
  0.55→1), 1.8 s loop, `ease-in-out`
- honour `prefers-reduced-motion` (static mark, no loop) — the global
  media query already covers this once it's CSS-driven
- reuse it for the empty-streaming state _and_ the retry strip

Files: new `components/PiSpark.tsx`, `MessageItem.tsx`, `styles/index.css`.

## 5 · Hover copy + timing — **copy present, timing missing**

Today: hover reveals a copy button. There is **no timestamp anywhere** —
the reducer never stores one (`grep timestamp reducer.ts` → 0 hits), even
though every `AgentMessage` from pi carries `timestamp`.

Reference: hover reveals `copy · pin · speaker · "1 minute ago"`.

Plan:

- carry `timestamp` from `AgentMessage` into `UserItem`/`AssistantItem`
- hover row shows relative time (reuse `relativeTime()` from Sidebar,
  move it to `lib/`), with absolute time as `title`
- add "copy as markdown" alongside plain copy
- keep the row reserved-height so hovering doesn't shift layout

Files: `reducer.ts`, `MessageItem.tsx`, new `lib/time.ts`.

## 6 · Edit diffs in-message — **works; needs the reference's restraint**

Today: expanding an `edit` shows a full `DiffView` with line numbers and
±markers, collapsed beyond 40 lines.

Reference: same idea, but the diff sits **inside the expanded group** with
tighter leading, no outer card border, and the file path as a clickable
header. Ours already does the path link.

Plan: fold into #2 — inside `ToolRunGroup` the diff loses its own border
and inherits the group's, with `leading-[1.45]`.

## 7 · Animations generally

Missing, in reference-visible order:

- **message entry**: new messages fade+rise 8px over ~180 ms
- **tool row expand/collapse**: height transition, not an instant snap
- **chevron rotation**: exists (150 ms) ✓
- **streaming caret**: exists ✓
- **jump-to-bottom pill**: fade+scale on show/hide

All must sit behind `prefers-reduced-motion` (already wired globally).

Files: `styles/index.css`, `MessageItem.tsx`, `MessageList.tsx`.

## 8 · Vertical spacing — **measurably too tight**

Today: `py-2` per item (16 px between messages) inside a virtualized row.

Reference measurement (`chat-tool-calls.png` at 2× → CSS px):

- user bubble → next assistant block ≈ **28 px**
- assistant paragraph → tool row ≈ **12 px**
- between consecutive tool rows ≈ **4 px** (tight, they're one run)
- last message → composer ≈ **32 px**

So: more space _between_ messages, less _within_ them. Ours is uniform,
which is exactly why it reads flat.

Plan: spacing scale by boundary type — `--px-space-msg: 28px`,
`--px-space-block: 12px`, `--px-space-tool: 4px`. Note the virtualizer
measures dynamically, so padding changes must live **inside** the measured
element or `estimateSize` drifts.

Files: `MessageList.tsx`, `MessageItem.tsx`, `styles/index.css`.

---

## Build order

| Batch  | Contents                                      | Risk                                   |
| ------ | --------------------------------------------- | -------------------------------------- |
| **C1** | #8 spacing, #7 animations, #1 tool-run motion | low, high visual payoff                |
| **C2** | #2 tool grouping (+ #6 diff nesting)          | medium — new component, needs e2e      |
| **C3** | #5 timestamps + hover row                     | low                                    |
| **C4** | #4 PiSpark                                    | low, self-contained                    |
| **C5** | #3 streamdown swap                            | highest — do last, alone, gated on e2e |

## e2e coverage to add

The current stub streams 4 text deltas and 2 tool calls with no timing. To
exercise this work it needs:

- a **multi-tool run** (3+ consecutive calls) → asserts grouping collapses
  to one summary row and expands to all calls
- a **slow tool** (delayed `tool_execution_end`) → asserts the running
  animation appears and clears
- **incomplete markdown mid-stream** (`**bold`, half table) → asserts no
  raw punctuation is visible while streaming (guards the streamdown swap)
- assertions on **computed spacing** between message boundaries

Files: `e2e/fixtures/pi-stub.cjs`, `e2e/smoke.spec.ts`.
