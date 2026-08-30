# 2026-08-30 — PR chip replaces cost on the lane row

The PR chip (`prChip.ts` + `PrBadge.tsx`) shipped with 8 states, but only ever
rendered when `gh` already had a confirmed PR — every other lane fell back to
showing session cost, which is what the chip was supposed to make unnecessary
to scan for. Two gaps closed:

- **`conflict` variant.** `gh` was already fetching `mergeable` into
  `GhPullRequest` and doing nothing with it. A conflicting PR can't merge no
  matter what its checks say, so it outranks `failing`/`pending` the same way
  terminal states already outrank check state — but loses to `draft`, which
  stays neutral on purpose.
- **`no-pr` fallback.** Inert (`↑ no PR`, no link, no create button — `gh-cli.ts`
  stays read-only), and gated tighter than a confirmed chip: `gh` never
  reports absence, so "no PR" is inferred from "a fetch for this repo
  completed and this branch wasn't in the result," which is indistinguishable
  from gh being broken unless the fetch is known to have succeeded
  (`fetchedAt > 0`). Restricted to worktree lanes — a non-worktree branch
  (usually the trunk) isn't "a lane" and the inference is wrong more often
  than right there.

## Cost and the chip now trade places, not stack

`LanePrefs.prStatus` (new, **default on**) — Settings → Workspaces → "PR
status instead of cost". `sessionSubtitle()` takes `{ showCost }`; the sidebar
passes `!showChip`, not `!prStatus` — cost steps aside only once a chip is
actually about to render (`pullRequest || confirmedNoPr`), caught in browser
verification: gating on the raw flag blanked the trailer entirely on a plain
non-worktree branch with no confirmed PR, losing cost with nothing to replace
it. On and a chip renders, a lane's trailer is its PR state; otherwise it's
cost, the behaviour from before the chip existed. They were never meant to
render together — two status signals on the densest line in the app is the
thing `specs/reference/lanes.md` already argued against for a second _chip_,
and it applies just as much to a chip plus a cost figure.

See [specs/reference/lanes.md](../reference/lanes.md#pr-status) for the
updated contract.
