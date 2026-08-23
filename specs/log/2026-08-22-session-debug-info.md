# Copy debug info: pointing at both of a session's ledgers

2026-08-22

## Why

Diagnosing a pi session after the fact means reading two files, not one:

- **pi's transcript** (`~/.pi/agent/sessions/<mangled-cwd>/<ts>_<uuid>.jsonl`),
  which carries per-message `usage` — the authoritative token and cost numbers.
- **the provider's transcript**, when the session ran on the Claude Code CLI
  (`~/.claude/projects/<mangled-cwd>/<uuid>.jsonl`). The CLI keeps its own
  parallel copy of the conversation.

Comparing the two is what exposes duplication. The 2026-08-21 burn was
diagnosed exactly this way: a pi transcript of 473 KB against a CLI copy of
13.8 MB for the same conversation is the whole finding.

Both live under mangled directory names, and — the part that wastes time — the
two harnesses mangle differently. pi wraps in double dashes
(`--home-dev-proj--`); the CLI does not (`-home-dev-proj`). Deriving these by
hand during a debugging session is tedious and easy to get wrong.

## What changed

`src/lib/sessionDebugInfo.ts` derives both paths from a session's cwd and id
and formats them as a plain-text block. Sidebar context menu → **Copy debug
info** puts it on the clipboard, with a toast confirming; if the clipboard is
denied, it falls back to a prompt the user can select from, because text that
is neither copied nor shown is useless.

Output:

```
pi session
  id:       01a02bb0-a041-7109-9d1c-8333ecea33c4
  cwd:      /home/dev/proj
  file:     /home/dev/.pi/agent/sessions/--home-dev-proj--/2026-…jsonl
  provider: pi-claude-cli / claude-opus-5
  claude:   ~/.claude/projects/-home-dev-proj/01a02bb0-….jsonl
```

The `claude:` line appears only for `pi-claude-cli` sessions — for any other
provider there is no such file, and pointing at a path that cannot exist is
worse than saying nothing. Provider and model come from the live session when
there is one; a disk-only session still yields its pi pointers, which are the
part that always exists.

## Notes

- The renderer's mangling is a read-only display copy;
  `electron/pi/pi-paths.ts` remains the source of truth on the main side and is
  the one that resolves symlinks. The copy here deliberately does not — it has
  no fs access, and the value is a pointer for a human rather than a lookup key.
- **Correction (2026-08-22):** the CLI rule stated above is incomplete — it
  dashes _every_ non-alphanumeric, dots included, and caps names at 200
  characters. Both copies are fixed; see
  [2026-08-22-delete-both-ledgers.md](2026-08-22-delete-both-ledgers.md) for the
  exact rule and the evidence behind it.
- Verified against real files: the derived paths for a known session resolve to
  the actual `.jsonl` on disk in both trees.
