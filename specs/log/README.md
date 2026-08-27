# specs/log

One dated write-up per shipped change, for work that isn't advancing a numbered
phase in [../TRACKER.md](../TRACKER.md) — which is most day-to-day fixes and
features now that P0–P14 have landed.

New entry: `YYYY-MM-DD-slug.md`, dated the day the work shipped, with a
top-level `#` heading that reads like the change. Write down what broke and
_why_, not just what was edited — most of these exist because the cause was
non-obvious.

These were appended to the end of `TRACKER.md` until 2026-08-20. They all
landed at the same spot in one shared file, so two PRs open at once conflicted
there even when their code never overlapped; a new file per change has nothing
to collide with.

**There is no index table here.** There was one until 2026-08-26, and it had
drifted 16 entries behind — a single shared list is the same append point that
moved these write-ups out of `TRACKER.md` in the first place, so it collided and
nobody kept it current. The filenames are the index: they carry the date and a
slug, and `ls specs/log` sorts them chronologically. `grep` the headings when a
slug is not enough.
