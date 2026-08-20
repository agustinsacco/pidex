# Chat transcript spacing + 6 reported defects — audit and plan

Reference = light screenshots (Claude Desktop, production). Subject = dark screenshots (pidex).
Every claim is tied to a file I read, or explicitly flagged as a hypothesis.

---

# PART A — Spacing audit

## A1. What the reference actually does (the insight we got wrong)

| Boundary                   | Claude Desktop   | pidex today                     |
| -------------------------- | ---------------- | ------------------------------- |
| prose paragraph → tool row | ~14px            | 8–16px + the block's own `my-2` |
| tool row → tool row        | ~14px            | 8px + `my-2` ×2                 |
| tool row → prose           | ~14px            | 16px + margins                  |
| assistant text → CTA row   | ~6px, same block | `mt-0.5` + `h-5` reserved       |
| CTA row → next turn        | ~18px            | 16px on top of the reserved row |
| turn → turn                | ~20px            | 16px + inner margins, unbounded |

**Claude Desktop uses one vertical step for the whole stream and encodes grouping with
color and weight, not variable gaps.** pidex took the opposite bet in
`src/features/chat/items/spacing.ts` (boundary-aware 8 vs 16px) and then every block adds
its own margin: tool group `my-2`, `ThinkingBlock` `my-1.5`, `DividerShell` `my-1`,
`.md-content p` `0.65em`, code `my-3`, tables `my-3`. **4–6 independent owners of vertical
space**, so the effective gap varies by block type even when `spacingFor` returns the same
class.

## A2. Code-level findings

1. **Double-owned spacing** (above). Nobody owns the total.
2. `spacingFor` returns `pb-0.5` on **every** branch — dead 2px on every item.
3. The reserved CTA row (`h-5 mt-0.5`) renders **only when `fullText` is non-empty**, so
   tool-only turns lose 22px → turn-to-turn rhythm alternates.
4. User CTAs float in the gutter at `-left-14`; assistant CTAs sit in a row. Two models for
   one action, and the gutter variant clips inside `max-w-3xl px-6`.
5. `.tool-card` is referenced in `ToolCard.tsx` and **defined nowhere** in `src/styles/`.
6. Chat body `--px-chat-font-size: 14.5px` at `line-height: 1.65`; reference ≈15px at ≈1.55.
   We have _smaller text with looser leading_ — worst case for scanning.
7. Font-size sprawl: `10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 13.5 / 14 / 14.5px` across six files.
8. `ThinkingBlock` collapsed row: 12.5px italic + `py-0.5` inside `my-1.5` ⇒ ~40px for one line.

## A3. The giant gaps (images 3–4) — virtualizer, not CSS

No CSS here can produce 100–180px; our margins cap at ~28px. `MessageList.tsx`:
`estimateSize: () => 96` vs a ~30px collapsed tool row, items placed by
`transform: translateY(start)`, and a scroll-follow `useEffect` **with no dep array** that
writes `scrollTop` on every render. Any row whose measurement doesn't replace the 96px
estimate leaves ~66px of dead air and shifts everything below.

**Still a hypothesis — must be measured first (Phase 0).** Tuning 8px margins under a 66px
layout bug would "fix" the symptom for the wrong reason and regress on any virtualizer
state change.

---

# PART B — The six reported defects

## B1. "Running unknown" / "unknown arguments" — CONFIRMED BUG, wrong tool identity

`reducer.ts:299–326` (`toolcall_start`): when `delta.partial.content[contentIndex]` isn't a
`toolCall` block yet, we **fabricate** both fields:

```ts
const toolCallId = … : `pending-${item.id}-${delta.contentIndex}`
const toolName   = … : 'unknown'
```

`summarizeTool`'s `default:` branch then prints `Running unknown`, and
`GenericDetail` prints `{tool.toolName} arguments` → `unknown arguments`.

The real damage is not the label — it's the **key**. The subsequent
`tool_execution_start` (`reducer.ts:95–111`) carries the true `toolCallId` _and_
`toolName`, but writes to `state.tools[event.toolCallId]` — a **different key** from our
`pending-…` one. So:

- a **second, orphaned** tool entry is created;
- the rendered block still points at `pending-…`, which stays `status: 'starting'`,
  `toolName: 'unknown'`, `argsText: ''` → the card in image 1 sits on "Running…" forever;
- `tool_execution_update` / `_end` also land on the real key, so **output never reaches the
  visible card**. Only `toolcall_end` remaps ids (`reducer.ts:342+`) — after the fact.

Why now: providers that don't include the tool name in the first partial (Bedrock-routed
Claude, per the model chip in the screenshots) hit this path every call. On direct
Anthropic the name is in the partial, so it never showed.

**Fix:** (a) make `toolName` optional (`string | null`) and render "Preparing tool…" instead
of inventing `'unknown'`; (b) in `tool_execution_start/update/end`, if the id is unseen but
the current assistant item has a `pending-*` tool block, **adopt** it — reuse the id-remap
already written for `toolcall_end` instead of inserting a duplicate. Reducer tests are pure
and already exist (`reducer.test.ts`), so this is directly testable: feed a
`toolcall_start` with no partial name + `tool_execution_start` and assert **one** tool entry
with the real name.

## B2. Can't scroll up while thinking streams — same root cause as A3

`MessageList.tsx` re-derives `pinned` **purely from geometry** on every scroll event:

```ts
const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64
```

While streaming, the virtualizer keeps correcting measurements _downward_ (96px estimate →
~30px actual), so `getTotalSize()` **shrinks**. The container gets shorter, the browser
clamps `scrollTop`, the clamp puts you within 64px of the bottom, `setPinned(true)` fires,
and the dep-less `useEffect` slams `scrollTop = scrollHeight`. You get yanked back mid-scroll.

**Fix:** intent-based pinning. Unpin on explicit user intent (`wheel`, `touchmove`,
`keydown` on PageUp/Home/↑) and **only** re-pin when the user hits "Jump to bottom" or
scrolls to within a small threshold _without_ the total size having changed in that frame.
Plus give the effect a dep and an rAF so it can't fight measurement. This is
UI-observable ⇒ e2e assertion: during a streamed reply, scroll up, assert `scrollTop`
doesn't return to the bottom.

## B3. Header says "New session" forever — CONFIRMED, missing fallback

`ChatView.tsx:44` uses only `meta?.sessionName`. Per pi's `docs/rpc.md:789`, `sessionName`
is **only** set by `set_session_name` or `pi --name` — _pi never auto-titles a session_.
Meanwhile `Sidebar.tsx:368` has the fallback chain: `meta.name || meta.firstUserText ||
'Untitled session'`, sourced from `electron/pi/session-scanner.ts` (`session_info.name`,
first user text). So the sidebar shows a title while the header shows "New session".

**Fix:** two parts. (1) Header uses the same chain, with the live transcript's first user
message as the in-memory source (no disk round-trip). (2) Optionally auto-name: after the
first assistant turn, if no name exists, `set_session_name` with a truncated first-prompt
title — that also fixes the on-disk name and the sidebar. Extract the chain to one
`sessionTitle()` helper in `src/lib/` so header and sidebar can't drift, and unit-test it
(pure function).

## B4. Vertical rule left of the floating pane — CONFIRMED, it's the resize handle

`RightPane.tsx` is already a correct floating card (`py-2 pl-1 pr-2`, `rounded-xl`,
`shadow-sm`). The line is `.pane-handle::after` in `src/styles/`:

```css
.pane-handle::after {
  content: '';
  position: absolute;
  inset: 0 2px;
  background: var(--px-border);
}
```

An always-on full-height divider in the gutter — the one thing that breaks the floating read.

**Fix:** `::after` transparent by default, `--px-border` on `:hover` /
`[data-resize-handle-active]` (the hover/active rules already exist, so this is a 1-line
default change). Keep the 5px hit area for grabbability.

## B5. Artifact pane doesn't scroll — CONFIRMED, one missing `flex` on PaneShell

`PaneShell.tsx` ends with:

```tsx
<div className="min-h-0 flex-1">{children}</div> // ← not a flex container
```

`ArtifactViewer` (`ArtifactsPane.tsx`) is `flex min-h-0 flex-1 flex-col` and its scroller is
`min-h-0 flex-1 overflow-y-auto`. With a non-flex parent, `flex-1` **does nothing**: the
viewer's height becomes `auto` (full content height), the scroller is never height-
constrained, so `overflow-y-auto` never engages — and the overflow is silently cut off by
`overflow-hidden` on the card in `RightPane`. Long artifacts are simply **unreachable**,
exactly as reported.

`FilesChangedPane` escapes this only because it happens to use `h-full` instead of `flex-1`
(`FilesChangedPane.tsx:70`) — the bug is latent for every future pane.

**Fix:** `<div className="flex min-h-0 flex-1 flex-col">` in `PaneShell`, then audit each
pane for `h-full` vs `flex-1` consistency. Also `ArtifactsPane` passes a **fragment**
(tab strip + viewer) into that slot, so the strip must stay `shrink-0` — it already is.
E2E: open a long markdown artifact, assert the scroller's `scrollHeight > clientHeight` and
that scrolling changes `scrollTop`.

## B6. Is cost correctly attributed? — YES, and I verified the arithmetic

We don't compute cost at all: pi does. `shared/rpc.ts` mirrors `Usage.cost` with
per-component fields `{input, output, cacheRead, cacheWrite, total}` and `ModelCost`
`{input, output, cacheRead, cacheWrite}` per 1M tokens; pi's `dist/core/cache-stats.js`
and `compaction.js` treat all four components separately. We display
`usage.cost.total` (`MessageItem.tsx:256`) and `stats.cost` (`ContextMeter.tsx:73`).

Checked against your own popover (image 4): input 50, output 14.9k, cache read 706k, cache
write 115k, cost **$1.4410**. At $5 / $25 / $0.50 / $6.25 per 1M:

```
0.000_25 + 0.372_5 + 0.353 + 0.718_75 = $1.4445
```

≈ $1.4410 — the residual is exactly the display rounding of `14.9k / 706k / 115k`. So
**cache-read and cache-write are priced separately and included**; attribution is right.
(Note what that reveals: cache _write_ is ~50% of this session's spend.)

Two real gaps, both ours, both display-side:

- `pi/dist/core/provider-composer.js:71` defaults `cost` to `{0,0,0,0}` for models from
  custom endpoints/`models.json` without pricing. We'd then render **`$0.0000`**,
  indistinguishable from genuinely free. → show `—` + "pricing not configured" when the
  active model's `ModelCost` is all-zero. We already have `models` in the chat store, so
  this needs no new RPC.
- The usage popover lists **tokens** by component but only a single **Cost** line, so "why
  is this session expensive?" is unanswerable in-app. → break cost out by component
  (data already present per message in `usage.cost`).

---

# PART C — Revised plan

### Phase 0 — Correctness gate (blocking, ~½ day)

Independent, low-risk bug fixes that the styling work depends on or would mask.

- **B5** `PaneShell` flex fix (1 line) + pane height audit. _Unblocks seeing artifacts at all._
- **B4** `.pane-handle::after` default transparent (1 line).
- **B1** reducer tool-identity fix + adoption of `pending-*` entries; new `reducer.test.ts`
  cases (no partial name; out-of-order `tool_execution_*`).
- **A3 diagnostic**: dev-only overlay comparing `virtualizer.measurementsCache[i]` against
  `getBoundingClientRect().height` per row. Decides whether the 96px estimate is the
  gap source before any margin is touched.
- **B2** intent-based pinning in `MessageList` (depends on the A3 finding — same mechanism).

Exit: artifacts scroll; no `unknown` tool cards; scrolling up during a stream stays put;
measured-vs-actual heights agree within a few px.

### Phase 1 — One spacing scale, one owner

- Tokens: `--px-stream-gap: 12px`, `--px-stream-gap-tight: 6px`.
- `spacing.ts` returns **one** class for all non-first boundaries; drop `pb-0.5` and the
  tool-only-continuation branch. `isToolOnlyTurn` survives as a _grouping_ input (Phase 3).
- Delete duplicate block margins: tool group `my-2`, `ThinkingBlock` `my-1.5`,
  `DividerShell` `my-1`, tool detail `mb-2 mt-0.5`.
- `spacing.test.ts` asserts the new invariant (identical gap for every non-first boundary) —
  a stronger assertion than today's, not a weakened one.

### Phase 2 — Type scale

`--px-fs-body: 15px`, `--px-fs-meta: 12.5px`, `--px-fs-micro: 11px`, `--px-fs-mono: 12.5px`;
`.md-content` line-height 1.65 → 1.55. Replace all nine hardcoded sizes. Net: larger body
text in less vertical space.

### Phase 3 — Grouping via ink, not air

Consecutive tool rows of one turn render as a block (`py-1` rows, no inter-row gap), gray
label + emphasized object. Replaces the deleted tight/generous logic.

### Phase 4 — Unify CTA rows + header title

- One `MessageActions` (`h-[18px]`, `gap-0.5`, `mt-1`, 14px icons, `Tooltip` each) used by
  **both** user and assistant messages; deletes the `-left-14` gutter variant. Renders
  always, so the turn rhythm stops alternating.
- **B3**: `sessionTitle()` helper in `src/lib/` (unit-tested) shared by header and sidebar;
  optional `set_session_name` auto-title after the first turn.

### Phase 5 — Notice primitive + cost honesty

- `<Notice tone level actions>` replacing `CrashBanner`, `NoModelsBanner`, `RetryStrip`, and
  the inline assistant error + Retry.
- **B6**: `—` / "pricing not configured" for all-zero `ModelCost`; per-component cost rows
  in the usage popover.

### Verification per phase

`npm run typecheck && npm run lint && npm test` every phase. E2E for Phase 0 (artifact
scroll, stream-scroll pinning) and Phase 4 (transcript DOM). Screenshot diff of a fixture
transcript before/after — `src/features/chat/__fixtures__` already exists.

### Ordering rationale

Phase 0 is first because B5 and B1 are _functional_ data-loss bugs (unreachable artifacts,
tool output routed to an orphan key) that outrank any styling, and because A3/B2 can
invalidate the premise of Phases 1–3. Phases 1–2 are mechanical and test-guarded; 3–5 are
behavioral and want e2e.

### `specs/TRACKER.md`

Per repo convention this lands as one dated entry when Phase 0 ships, plus a spec note for
the reducer tool-identity change (it alters an invariant other code reads).

---

# OUTCOME (2026-08-08)

Phase 0 shipped, plus Phase 1 pulled forward. What the measurement changed about the plan:

## A3 was wrong, and the gate caught it

The plan said the 100px+ gaps were probably `estimateSize: 96` and required a measurement
before any restyle. That measurement (a 40-tool-turn harness scenario, `manyitems` in the pi
stub) **refuted the hypothesis**:

| Condition                 | Rendered rows | Row height | Max gap between rows |
| ------------------------- | ------------- | ---------- | -------------------- |
| `estimateSize: 96` (pre)  | 20–29         | 63px       | **0.1px**            |
| `estimateSize: 44`        | 20–29         | 63px       | 0.1px                |
| after Phase 1 (gap owner) | 29            | **33px**   | 0.1px                |

TanStack's dynamic measurement corrects every mounted row, so the estimate never showed up
as a gap. The real cause was the thing Part A described: **a tool row's wrapper was 63px
tall for ~20px of text** — `pt-4` (16) + `pb-0.5` (2) + tool-group `my-2` (16) + row `py-1`
(8) = 42px of stacked padding from four owners. At 2× that reads exactly like the holes in
the screenshots.

Consequence: `estimateSize` is now 40 (matching measured reality, affecting scrollbar
proportions only), and **Phase 1 was the actual fix**, so it was pulled into this PR.

## Measured results

- Tool row: **63px → 33px (−48%)**
- 40-tool transcript: **2676px → 1468px (−45%)**
- Gaps between measured rows: 0.1px (unchanged — they were never the problem)

## Non-vacuous guard

`transcript rows are dense and sit flush` asserts `tallestToolRow < 44px`. Verified it fails
on regression: restoring the single `my-2` on the tool group takes the row to 48.9px and the
test fails. (The first version of this assertion — gaps only, on a short transcript — passed
with the bug present. It was replaced.)

## Deltas from the plan as written

- **Phase 1 landed here** (see above), including `isToolOnlyTurn` surviving as a grouping
  input for consecutive tool-only turns (`pt-1` instead of `pt-3`).
- **B2's fix is not the one the plan described.** Threshold tuning was not enough: the pin
  state had to become a synchronously-written ref (React state lost the race against
  streaming renders), and our own follow-the-tail scroll had to be suppressed so its scroll
  event isn't read as "the user is at the bottom".
- **`MessageList` listeners attach via a callback ref**, not an effect: the empty-transcript
  branch returns a different tree, so a mount-only effect found no scroll element and never
  attached anything. Found by e2e, not by review.
- **Artifact UX went beyond the plan**: `ArtifactDetail` replaces the generic JSON dump for
  `artifact_create` / `artifact_update` with identity + "Open in panel", and unidentified
  streaming tools show a live byte counter instead of a fabricated name.

## Still open

Phases 2–5 (type scale, further ink-based grouping, unified CTA rows, `Notice` primitive) and
B6's display honesty for models with no configured pricing.
