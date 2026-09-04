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

Two deliberate choices in that list:

- **A bot comment does not hold a PR.** A release or coverage bot would
  otherwise stall every PR forever.
- **The author's own comment does hold it.** Strict is the safe direction: a
  held PR costs one interval, a wrongly merged one costs a revert on main.

Every gate fails closed. `mergeable: UNKNOWN` (GitHub still computing the merge
commit) and a check still running both hold, so an interval that fires mid-CI
merges nothing and the next one decides on real data.

## Shape

`decide(pr)` is a pure function over one `gh pr view --json` object, and every
rule above is a case in `automerge-prs.test.ts` — no network, no fixtures to
refresh. Only `main()` runs `gh`. There is no `authorAssociation` field in
`gh`'s PR JSON, which is why the trust gate is `isCrossRepository`: a branch
inside the repo already implies push access.

## Running it every ten minutes

The script needs no model, so anything can drive it:

```
*/10 * * * * cd ~/pidex && /usr/bin/env node scripts/automerge-prs.mjs >> /tmp/automerge.log 2>&1
```

Inside a Claude Code session, `/loop 10m npm run automerge` does the same for
the life of that session. `--dry-run` prints the verdicts and merges nothing;
run that first after changing any rule.
