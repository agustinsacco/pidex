# Deleting a session deletes both of its ledgers

2026-08-22

## Why

A session on the Claude Code provider is written to disk twice: pi's own
transcript, and the CLI's parallel copy at
`~/.claude/projects/<mangled-cwd>/<sessionId>.jsonl`. `sessions:delete` only
ever trashed the first one, so every Claude session deleted from the sidebar
left its larger half behind with nothing pointing at it.

Measured on the dev machine before the fix: sessions
`01a0272a-7be5-76ed-b420-36b363924622` and
`01a0272c-51c7-712d-936b-c3cb4905703c` had been deleted — their pi transcripts
were in the trash — while their CLI ledgers were still live at 8.2 MB and
13.8 MB. 22 MB orphaned by two deletes.

## What changed

`electron/pi/session-deleter.ts` owns the delete. It reads pi's transcript for
the session's id, cwd and provider **before** trashing it (that file is the only
thing that knows them), then trashes the CLI copy when the session ran on
`pi-claude-cli` and the copy is still there. `sessions:delete` now calls it; the
IPC contract is unchanged.

Both go to the trash, never `unlink` — a transcript is the only record of a
conversation, and deleting one from the sidebar should be as recoverable as
deleting a file in a file manager.

The CLI copy is strictly best-effort: absent is the normal case (other
providers, and sessions older than the provider itself), so a miss is silent
and can never fail the delete.

## The CLI's mangling rule, exactly

`claudeProjectDirName` in `electron/pi/pi-paths.ts` is now the main-process
source of truth. The rule is **not** "replace separators":

```
name = cwd.replace(/[^a-zA-Z0-9]/g, '-')
if (name.length > 200) name = name.slice(0, 200) + '-' + base36(hash(cwd))
```

where `hash` is `h = (h << 5) - h + charCode | 0` over the _unmangled_ cwd.

Two corrections to what we previously believed:

- **Dots become dashes.** `/home/u/proj/.claude/wt` →
  `-home-u-proj--claude-wt`, not `-home-u-proj-.claude-wt`. This is not an edge
  case: worktrees under `.claude/` are where most of these sessions run, so the
  separators-only rule missed almost exactly the population we care about.
- **Names over 200 characters are truncated** and disambiguated with a hash of
  the original path. A prefix match alone would resolve two sibling deep paths
  to the same directory.

Transcribed from the CLI's own implementation (2.1.238) and checked against
every directory under a real `~/.claude/projects`, truncated ones included:
42 of 44 reproduce exactly, and the two misses are sessions resumed under a
different cwd than the one they were created in, not rule failures.

`claudeConfigDir()` honours `CLAUDE_CONFIG_DIR`, which is the CLI's own
documented override and relocates `projects/` with it.

This is someone else's rule, so it can drift. The failure mode if it does is a
lookup that misses — an orphan, the status quo ante — never one that hits the
wrong file.

## Notes

- `src/lib/sessionDebugInfo.ts` carries a display-only copy of the character
  substitution for the **Copy debug info** block. It had the same dot bug and
  is corrected; it still does not resolve symlinks or apply the length cap,
  since it has no fs access and its output is a pointer for a human.
  See [2026-08-22-session-debug-info.md](2026-08-22-session-debug-info.md).
- Provider detection scans the transcript rather than reading the header:
  the provider is not in the header, and a session that switched providers
  mid-run is only recognisable by looking at every `model_change`. The scan
  stops at the first hit, which for a Claude session is line 2.
- Tests: `electron/pi/__tests__/pi-paths.test.ts` for the mangling rule
  (including the real truncated directory name), and
  `electron/pi/__tests__/session-deleter.test.ts` for the delete behaviour —
  copy trashed, copy absent, other provider skipped, provider switched
  mid-session, malformed transcript, and a failing trash call.
