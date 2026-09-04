# 2026-09-04 — merge the PRs nobody had anything to say about

Lanes open PRs faster than a person clicks Merge. Three sat open on this date,
all green, all unread. The queue, not the work, was the bottleneck.

`scripts/automerge-prs.mjs` (`npm run automerge`) squash-merges an open PR when
all of these hold, and holds it with a printed reason otherwise:

- not a draft, and its branch is in this repo (not a fork)
- `mergeable: MERGEABLE` — no conflicts
- `mergeStateStatus: CLEAN` — GitHub would accept the merge right now, so
  branch protection and an out-of-date branch both hold it
- no `CHANGES_REQUESTED`, no `REVIEW_REQUIRED`
- zero comments from a human, and zero reviews other than approvals
- at least one check reported, every check completed, every conclusion
  `SUCCESS`/`SKIPPED`/`NEUTRAL`
- its head is not behind the base branch

Three deliberate choices in that list:

- **A bot comment does not hold a PR.** A release or coverage bot would
  otherwise stall every PR forever.
- **The author's own comment does hold it.** Strict is the safe direction: a
  held PR costs one CI cycle, a wrongly merged one costs a revert on main.
- **A green-but-behind PR is updated, not merged.** `main` has no branch
  protection, so GitHub reports a stale branch as `CLEAN` and would merge a
  combination no CI run ever saw — which is exactly what happened the first
  time this ran, when two PRs landed back to back. `gh pr update-branch`
  pushes the base in, CI reruns against the real target, and the completion
  event brings the PR back here with nothing behind it.

Every gate fails closed. `mergeable: UNKNOWN` (GitHub still computing the merge
commit) and a check still running both hold, so a run that fires mid-CI merges
nothing and the next one decides on real data.

## Shape

`decide(pr)` is a pure function over one `gh pr view --json` object, and every
rule above is a case in `automerge-prs.test.ts` — no network, no fixtures to
refresh. Only `main()` runs `gh`. There is no `authorAssociation` field in
`gh`'s PR JSON, which is why the trust gate is `isCrossRepository`: a branch
inside the repo already implies push access.

The merge itself is `PUT /pulls/{n}/merge`, not `gh pr merge`. That command
also runs local git — checkout the base, delete the local branch — which fails
in a worktree checkout and on a CI runner, _after_ the remote merge has already
happened. The first live run reported two successful merges as failures for
exactly that reason.

## What drives it

`.github/workflows/automerge.yml`, on `workflow_run` from CI. That single
trigger closes the loop in both directions: CI finishing on a PR is what makes
that PR eligible, and CI finishing on **main** — after a merge lands — is what
re-evaluates everything still open. The queue drains one PR per CI cycle with
no schedule, no polling, and nothing running on a laptop.

`workflow_dispatch` runs it by hand, defaulting to a dry run.

**`AUTOMERGE_TOKEN` must be a PAT.** A push made by `GITHUB_TOKEN` does not
trigger workflows, so merging with it would land on main without running CI:
no Continuous Release, and no event to evaluate the next PR. The loop would
stop dead after one merge. The workflow fails loudly when the secret is
missing rather than half-working.

Locally, `npm run automerge -- --dry-run` prints the verdicts and changes
nothing. Run that after changing any rule.
