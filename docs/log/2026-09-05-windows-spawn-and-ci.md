# Windows, step 1: runnable npm shims and a CI job that tells the truth

**2026-09-05.** pidex has never shipped for Windows and has never been tested
on it. This lands the subprocess fix that Windows needs and a non-blocking CI
job to find out what else is broken. It does **not** publish a Windows build.

## What was actually wrong

Two separate things, and only one of them is code.

**Nothing was ever built.** `electron-builder.yml` has an NSIS target and
`.github/workflows/release.yml` has a `windows-latest` job, so the repo looks
Windows-ready. That workflow has never run once. It triggers on a pushed `v*`
tag, but the per-merge `release-continuous.yml` creates its tags through the
GitHub API with `GITHUB_TOKEN`, and GitHub deliberately does not start a
workflow from a token-created event. So the tags exist, the tagged workflow
does not fire, and every release comes from the continuous workflow — whose
matrix is macOS and Linux only. Result: **143 releases, zero Windows assets.**
The README claimed a `.exe` was present on tag-cut releases; every release is
tag-cut and none had one.

**And it would not have run.** `pi`, `claude` and `npm` are all installed by
npm, which on Windows writes a `.cmd` shim rather than an executable. Node's
`child_process.spawn` refuses to run a `.cmd` without a shell (`EINVAL`, from
the CVE-2024-27980 hardening). `electron/pi/rpc-client.ts` spawns `pi` for
every session, so the failure would have been at the first spawn, before any
UI existed to report it.

Both of pidex's own dependencies had already solved this: pi 0.84.1 and
`@saccolabs/pi-claude-cli` 0.7.0 each depend on `cross-spawn`, and the latter
even switches its handoff broker to a named pipe on Windows. pidex was the
only unported layer in the chain.

## The change

`electron/pi/spawn.ts` is now the single place any npm-installed binary is
launched from. It exports `spawn` (cross-spawn), `spawnPiped` (the same, typed
for callers that read all three streams without null checks), and
`execFileAsync` (a `promisify(execFile)` replacement built on it).

Six modules moved onto it: `rpc-client`, `print-mode`, `auth-status`,
`claude-login`, `health`, `packages`. None of them imports
`node:child_process` any more, which is what `spawn.test.ts` asserts — the
regression is catchable on macOS, where it would otherwise pass silently.

Two decisions worth keeping:

- **Used unconditionally, not behind a `win32` branch.** cross-spawn's
  `parseNonShell()` returns its input untouched when `process.platform !==
'win32'` (verified against 7.0.6 — no PATH lookup, no shebang read), so this
  is a literal passthrough on macOS and Linux. A platform branch would have
  made the Windows path the one nothing ever exercises.
- **`execFileAsync` keeps `execFile`'s error contract**, because call sites
  depend on the details: `health.ts` prefers `stderr` over `message`, and
  `packages.ts` parses `stdout` off a **non-zero** exit, since
  `claude auth status` prints its JSON and then exits 1 when logged out. The
  one deliberate difference is SIGKILL rather than SIGTERM on timeout — a shim
  wrapped in `cmd.exe` can outlive a SIGTERM aimed at the wrapper.

A side effect: the e2e stub (`e2e/fixtures/pi-stub.cjs`) is a `#!/usr/bin/env
node` script, which Windows cannot execute directly either. cross-spawn reads
the shebang and re-invokes through `node`, so the stub works there for free.

## CI

`windows-latest` joins the e2e matrix, running the **full unit suite** as well
as the e2e shard — the `checks` job is ubuntu-only, so every cwd-mangling test
in `pi-paths` and `claude-paths` has so far only been asserted against POSIX
separators.

It is `continue-on-error: true`, and that is load-bearing rather than lazy:
`release-continuous.yml` triggers on CI **success**, so a red Windows job
would stop publishing the macOS and Linux builds that do work. The job is
there to produce evidence, not to gate. Whoever turns on the Windows release
build flips this to blocking in the same PR.

## What the first Windows run actually found

Run [33973076365](https://github.com/agustinsacco/pidex/actions/runs/33973076365).
`npm ci`, the node-pty rebuild and `npm run build` all succeeded. Then:

- **Unit: 1799 of 1825 passed** (148 of 159 files).
- **E2E: 30 of 36 passed.** pidex boots on Windows, spawns the stub pi,
  streams an answer, renders diffs and artifacts, opens a real PowerShell
  terminal with replayed scrollback, and drives the worktree, connector,
  model-picker and skills flows.

Nothing in the spawn layer failed, which is the result this PR was after: the
whole spawn → RPC → stream chain works.

**Two real product bugs**, both narrow:

1. **Session discovery is broken by the drive letter.**
   `sessionDirNameForCwd` splits on `[/\\]` and rejoins with `-`, so
   `C:\Users\x\proj` becomes `--C:-Users-x-proj--`. A `:` is illegal in a
   Windows filename (NTFS reads it as an alternate data stream), so the
   directory can be neither created nor found —
   `session-watcher.test.ts` fails with `ENOENT … --C:-Users-RUNNER~1-…--`.
   This is the single cause of **all six** e2e failures, every one of which
   needs a session row scanned off disk: late-landing session file, last
   session on relaunch, multi-workspace sidebar grouping, lane filtering,
   renderer re-adoption, per-session right pane. The fix has to **match
   whatever pi itself writes on Windows** — `pi-paths.ts` mirrors pi's
   layout and must not invent its own scheme.
2. **gitignore filtering silently fails.** `checkIgnored` in `fs-service.ts`
   sends git backslash paths and matches against git's forward-slash output,
   so the `Set` lookup never hits and nothing is filtered — the test sees
   `secret.txt` in a listing that should have excluded it. Ignored files
   would show in the explorer on Windows.

The other 20 unit failures are **POSIX assumptions in tests, not in code**:
`sandbox.test.ts` and `packages.test.ts` assert `/`-joined strings against a
correct `join()` result; `mac-installer.test.ts` and `spawn-helper.test.ts`
assert macOS/POSIX-only behaviour that the code already skips on win32; the
`should-skip-release` and `install-sh-portability` suites shell out to `sh`.
All want a platform gate.

## Still open

- The two bugs and the test gates above, before the Windows job can block.
- **No auto-update on Windows.** `release-continuous.yml` stamps
  `pidexSigned=true` only for signed-macOS and Linux, so a Windows build would
  land on `'manual'` in `updater.ts`. NSIS self-updates fine unsigned; this is
  a small change to that flag's logic, not a design problem.
- **SmartScreen.** An unsigned NSIS installer warns on every download. Only a
  code-signing certificate clears it. Cost, not code.
