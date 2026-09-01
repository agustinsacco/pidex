# The PR chip never rendered in the installed app

**Date:** 2026-09-01

## Symptom

Every lane row in the sidebar showed session cost, never a PR chip — including
lanes whose branch had an open PR. `LanePrefs.prStatus` was on (its default),
and the feature had shipped in #110/#116/#136.

## Cause

`electron/fs/gh-cli.ts` shelled out with a bare `execFile('gh', …)`, inheriting
`process.env`. A macOS GUI app gets launchd's PATH
(`/usr/bin:/bin:/usr/sbin:/sbin`), and `gh` is at `/opt/homebrew/bin/gh`. So
`gh --version` failed with ENOENT in the installed app.

Two things made that total rather than intermittent:

- `ghAvailable()` caches its promise for the process lifetime, so one miss at
  startup disabled chips until the next app restart.
- Every failure mode of `gh` is deliberately silent (no toast, no log), which
  is right for "no GitHub remote" and wrong for "we can't find the binary" —
  the two are indistinguishable from the UI.

It worked in `npm run dev` because a terminal launch inherits the developer's
own PATH. Every other subprocess in the app already resolved this through
`electron/pi/shell-env.ts`; `gh-cli.ts` was the one module that didn't.

## Fix

`ghEnv()` returns `piProcessEnv({ GH_PROMPT_DISABLED, GH_NO_UPDATE_NOTIFIER })`
and both the probe and every `gh` call use it. `electron/fs/gh-cli.env.test.ts`
pins the probe and the list call to the upgraded PATH.
