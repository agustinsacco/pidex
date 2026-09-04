# Auditing every pidex Claude session against the 400k context window

Settings → Extensions → Claude Code → Context window was set to **400k**.
The question was whether real sessions honoured it. They did: across 37
pi-claude-cli sessions and 2,237 measured requests, **no request ever carried
more than 332,999 tokens**. The cap has never had to fire.

## What the setting actually does

`claudeAutocompact` (`electron/store.ts`) is read per spawn in
`electron/ipc/pi-session-handlers.ts` and passed as
`PI_CLAUDE_CLI_AUTOCOMPACT`. The provider's `src/autocompact.ts` turns that
into the CLI's `--autocompact <tokens>` flag. Confirmed live, with sessions
running:

```bash
ps -Ao args | grep -o '\-\-autocompact[= ][^ ]*' | sort | uniq -c
#    2 --autocompact 400000
```

Two things to know before reading a number here. The setting **applies only to
sessions started after it changed** — it is read at spawn, never re-read. And
the CLI's floor is 100k, so a smaller value is silently replaced by the
provider's 200k default; pidex rejects it in the UI
(`src/lib/claudeAutocompact.ts`) so a typed number never means something else.

## Method

pi's session file records the provider and the cwd but **not the CLI session
id**, so the two transcripts are joined by mangled cwd plus time overlap:

- pi sessions: `~/.pi/agent/sessions/*/*.jsonl` → `provider`, `cwd`, timestamps.
- CLI transcripts: `~/.claude/projects/<cwd with non-alnum → ->/<id>.jsonl`.
- Context per request = `input_tokens` + `cache_read_input_tokens` +
  `cache_creation_input_tokens` from each assistant entry's `usage`. Cache
  reads are the whole point — they are the context being re-read, and reading
  `input_tokens` alone reports a few hundred tokens for a 300k request.
- Compactions counted by `isCompactSummary`.

**cwd overlap alone over-reports, badly.** Four "sessions" came back at 998k.
All four were long-lived terminal Claude Code sessions in
`~/src/GoAugment/augment-services`, started 2026-07-22 and 2026-08-11, still
alive when a pidex session opened in the same repo root a month later. A
pidex-spawned CLI session cannot predate its own pi session, so the join drops
any transcript whose first entry is more than 2 minutes older than the pi
session's. That is what separates pidex's sessions from the ones that ran in a
terminal — of 1,272 transcripts on disk, only 61 belong to pidex.

## Result

| Peak context | pi session start  | Requests | CLI transcript | Worktree                                |
| ------------ | ----------------- | -------- | -------------- | --------------------------------------- |
| 332,999      | 2026-09-04T02:15Z | 319      | `b5201dfd`     | `do-a-thorough-critical-review-of-this` |
| 282,020      | 2026-08-29T15:48Z | 5        | `d12b8777`     | `/private/tmp` (a lifecycle test)       |
| 265,969      | 2026-09-04T03:09Z | 371      | `dbf13411`     | `i-want-your-help-updating-readme-of`   |
| 264,880      | 2026-09-04T02:15Z | 1        | `ce053e3d`     | `do-a-thorough-critical-review-of-this` |
| 178,326      | 2026-09-01T23:57Z | 141      | `857ab416`     | `couple-issues-with-pi-claude-cli-and`  |

Median peak across all 61 transcripts is 37,793 tokens. Four exceeded 200k;
none exceeded 400k, and `isCompactSummary` appears in zero of them, so no
pidex session has ever auto-compacted. The 400k window is a ceiling nothing has
reached, not a mechanism observed working — the flag reaching the CLI is what
is verified here, and the 282k session on 2026-08-29 predates the 400k choice.

31 further pi-claude-cli sessions have no CLI transcript at all. 24 ran in
`$TMPDIR` scratch directories whose `~/.claude/projects` entry no longer
exists; all 31 are 2-message throwaways.

## If a session ever does exceed the window

Check the installed provider first — the setting is a no-op below 0.5.0:

```bash
jq -r .version ~/.pi/agent/npm/node_modules/@saccolabs/pi-claude-cli/package.json
```

Then check whether the session predates the setting. A live session keeps the
window it spawned with; changing the pref does not reach it.
