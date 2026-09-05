# Removing automerge

2026-09-05

The automerge feature is gone: the `Automerge` workflow, its 15-minute cron
poll, `scripts/automerge-prs.mjs`, that script's test suite, and the
`npm run automerge` entry point.

## Why

The premise was wrong. Automerge treated "nobody commented" as "nobody
objected", so a green PR merged itself on a timer whether or not a person had
read the diff. Green CI is evidence the code builds, not evidence the change is
correct. On a repo where lanes open PRs faster than they can be read, that
removes the only remaining review step rather than speeding it up.

The rest was cost with no return:

- **It never merged anything.** All four runs failed on the token check, and
  the repository still has no secrets at all — `AUTOMERGE_TOKEN` was never set.
  The feature was two days old and had a lifetime merge count of zero.
- **It needed a PAT with `Contents: write` and `Pull requests: write`**, held
  as a repository secret, used unattended on a schedule. That is a standing
  write credential to main, kept alive for a convenience.
- **A fine-grained PAT expires**, and every 15 minutes after that the job went
  red — so keeping it working was recurring manual work.
- **It polled every 15 minutes, all day**, plus a `workflow_run` trigger on
  every CI completion, to do nothing most of the time.

Merging is a person's call again. Open PRs are merged by hand.

## What went with it

Nothing else depended on it. The window logic (`isWithinWindow` / `parseWindow`,
the `AUTOMERGE_WINDOW` override) and the merge-eligibility rules (`decide`) were
used only by this script, so they went too. CI, Continuous Release and the
release workflows are untouched — none of them referenced automerge.

The two earlier write-ups
([2026-09-04-automerge-quiet-prs.md](2026-09-04-automerge-quiet-prs.md) and
[2026-09-05-automerge-window-and-token.md](2026-09-05-automerge-window-and-token.md))
stay as history and are marked removed at the top. Nothing in `docs/` described
automerge as current behaviour, so no living contract changed.
