# Lane search in the workspace header

**Shipped**: 2026-08-30 · **Surface**: sidebar (`src/features/sessions/`)

## What changed

Each workspace group header gained a magnifier. It opens a search field under
the header, pushing that group's lanes down, and Enter filters them by **title,
branch, or PR (number and title)**. `x` and Escape both retract the filter and
close the bar.

The contract is in [docs/lanes.md](../lanes.md#finding-a-lane).

## Why the header, and why per group

The sidebar is the fleet view: a project with a dozen lanes scrolls, and the
thing you know about the lane you want is one of three strings — what you named
it, the branch it runs on, or the PR it became. So the haystack is all three,
and the control lives beside the other per-workspace controls rather than in a
global palette. A global search would have to name the project on every row and
would answer a question nobody asked ("which project?") ahead of the one they
did ("which lane?").

## Four decisions worth keeping

- **Enter commits, typing does not.** The rows are the navigation here. A
  per-keystroke filter makes the list jump under someone still typing.
- **Closing always retracts.** A closed bar with a live filter is an
  unexplained empty sidebar, and the only cue would be one scroll off screen.
- **Substring, not subsequence.** `lib/fuzzy.ts` exists, but on branch-shaped
  text a three-letter subsequence matches nearly everything, which reads as a
  filter that did nothing. Terms are ANDed and order-free instead, so
  `130 rebase` and `rebase 130` agree.
- **Selection follows the filtered list.** `selectWholeGroup` and the
  shift-range in `toggleLaneSelection` now take the visible lanes. Passing
  `group.metas` would let "Select all lanes" sweep in lanes the filter is
  hiding, and the next stop is a bulk delete.

## What it cost elsewhere

Select-all moved out of the header into the workspace `⋯` menu. The toolbar was
already four icons in a 208px-minimum sidebar and the group name truncates
first; search is the more frequent act, so it took the slot. The old
`workspace-group-select` testid moved with it onto the menu row.

`.lane-search-field` opts the input out of the global `:focus-visible` ring
(`styles/index.css`), the same trade `.composer-field` already makes: the
bordered row around the input is the focus signal, and the ring drew a second
box inside the first that covered the match count.

## Verification

- `laneSearch.test.ts` — 10 cases over the matcher, including the
  no-subsequence guard and a lane with neither branch nor PR.
- `smoke.spec.ts` — "filters lanes on Enter and restores them on Escape":
  typing alone filters nothing, Enter empties the list, `x` and Escape both
  restore it. The fixed-controls test now asserts four header controls and
  finds select-all in the menu.
