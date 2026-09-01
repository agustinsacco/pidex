# Tool-call and MCP row UI

Audit of how a tool call renders in the transcript, on both the pi-native and
the `pi-claude-cli` provider. Measured against one real session
(`01a0548d-9f3a-7f50-aa3f-d8e0d70071a9`, Claude provider, 163 unique bash
calls).

**Headline.** The row label is 64 characters and it is spent on setup. 96% of
the session's bash calls are multi-line scripts and 94% open with `cd`, `echo`
or a variable assignment, so the command that the row actually ran is past the
truncation point. MCP is worse: every gateway call renders as `Used mcp`
regardless of which of its nine modes ran.

Status column is re-verified against the code, never inferred from this file.

| #   | Finding                                               | Status as of 2026-09-01 |
| --- | ----------------------------------------------------- | ----------------------- |
| F1  | Multi-line scripts collapse to their setup line       | open                    |
| F2  | `cd <ws>` strip only matches `&&`, not newline        | open                    |
| F3  | Every MCP gateway call renders as `Used mcp`          | open                    |
| F4  | A failed tool hides its arguments two clicks deep     | open                    |
| F5  | Raw `mcp__server__tool` names leak into the label     | open                    |
| F6  | `ToolSearch` rows show the machine query              | open                    |
| F7  | Structured MCP chip degrades silently to prose        | open                    |
| F8  | `mcp({})` fails on every Claude session (not pidex)   | open — `pi-claude-cli`  |
| F9  | A regex backslash defeats marker unescaping wholesale | open                    |
| F10 | The UI advertises that the provider is Claude Code    | open                    |

## F1 — Multi-line scripts collapse to their setup line

`cleanCommandForDisplay` (`src/features/chat/tools/toolSummaries.ts`) flattens
whitespace, so every line of a script joins into one string, and
`truncate(display, 64)` then keeps only the head of it.

Reproduced byte-for-byte from the session:

```
Ran cd ~/.pi/agent/npm/node_modules/pi-mcp-adapter echo "=== adapte…
```

The `grep` this row ran is invisible. Same code path serves both providers, so
`summarizeTool` and `summarizeExternalTool` are equally affected.

**Proposed.** Label the _operative_ line. Split on newline / `&&` / `;`, drop
`cd`, `export`, `set`, `VAR=`, `echo` and `#`, take the first survivor, and
suffix `+N more` when other real commands follow. Replaying the rule over all
163 commands changes 95% of labels, every one of them toward the actual verb:

```
TODAY     Ran cd ~/.pi/agent/npm/node_modules/pi-mcp-adapter echo "=== adapte…
PROPOSED  Ran grep -n "mcp.json\|\.mcp\.json\|scope\|XDG" config.ts   +9 more

TODAY     Ran echo "=== global mcpServers in ~/.claude.json ===" jq -r '.mcpS…
PROPOSED  Ran jq -r '.mcpServers // {} | keys[]' ~/.claude.json
```

**Trade-off.** Picking an operative line is a heuristic, and a script whose
intent genuinely is its `echo` gets a worse label. The expanded detail keeps
the full command and `+N more` stops the row claiming to be the whole script,
so the failure mode is a vaguer label, never a wrong one.

## F2 — The `cd <ws>` strip only matches `&&`

The prefix regex requires `&&`. Models write `cd <ws>` followed by a newline,
which never matches, so the workspace path only degrades to its basename and
still spends ~30 of the 64 characters. Accept `&&`, `;` and newline.

## F3 — Every MCP gateway call renders as `Used mcp`

Both summarizers drop MCP to `default:`, which emits the tool name and nothing
else. The gateway's mode lives entirely in its arguments and the arguments are
not on the row, so a status check and a write render identically:

| Call                                | Renders as | Actually does             |
| ----------------------------------- | ---------- | ------------------------- |
| `mcp({})`                           | `Used mcp` | server status             |
| `mcp({server:"linear"})`            | `Used mcp` | lists 67 tools            |
| `mcp({connect:"linear"})`           | `Used mcp` | performs an OAuth connect |
| `mcp({tool:"linear_save_issue",…})` | `Used mcp` | writes to Linear          |

**Proposed.** Read the mode off the args — `MCP status`, `Listed linear tools`,
`Searched MCP tools for issue`, `Connected linear`, `linear · list teams` — and
carry the server name as a gutter chip, reusing the `cc` mark pattern already
in `ActivityGroup`.

## F4 — A failed tool hides its arguments two clicks deep

`GenericDetail` puts arguments behind a nested toggle. For the F8 failure the
argument (`""`) _was_ the whole diagnosis. Default `argsExpanded` to `true`
when `tool.isError`.

## F5 — Raw `mcp__server__tool` names leak

`Used mcp__linear__save_issue`. The string is already delimited; split it into
a server chip plus a humanised operation.

## F6 — `ToolSearch` rows show the machine query

`Searched tools for select:mcp__custom-tools__mcp,mcp__custom-tools…` — a
protocol string truncated mid-identifier. Strip the `select:` prefix and the
`mcp__custom-tools__` namespace, then list the tool names.

## F7 — The structured MCP chip degrades silently to prose

`src/features/connectors/mcpStatus.ts` parses six real per-server states and
`McpChip` renders them well. When the snapshot is absent the adapter's own
sentence (`MCP: 4 servers enabled`) falls through the generic status strip
instead, so the footer can show prose that disagrees with the chip. Suppress
the prose whenever `parseMcpStatus` returns a snapshot.

Related cosmetic issue in the adapter's own output:
`linear (67 tools (not connected, cached))` — doubled parentheses, and two
states that read as contradictory.

## F8 — `mcp({})` fails on every Claude-provider session

Not a pidex bug; recorded here because it is what a user hits first when
debugging MCP from a pidex session.

```
mcp({})  →  Validation failed for tool "mcp":
              - root: must be object
            Received arguments:
            ""
```

**Root cause.** `pi-claude-cli` 0.5.1, `src/event-bridge.ts` (the `tool_use`
branch of the block-end handler). A tool call with no arguments emits zero
`input_json_delta` events, so the accumulator stays `""`. `JSON.parse("")`
throws, the catch hands pi the raw empty string, and pi rejects it against the
schema.

**Fix.** `JSON.parse(block.partialJson || "{}")`. Implemented in
[pi-claude-cli #31](https://github.com/agustinsacco/pi-claude-cli/pull/31)
(0.5.2, unmerged/unpublished as of 2026-09-01).

**Blast radius.** Every zero-argument handoff tool on every Claude session —
`mcp({})` and `artifact_list()`. Needs a publish and a reinstall to go live;
see the version-floor note in [CLAUDE.md](../../../CLAUDE.md).

## F9 — A regex backslash defeats marker unescaping wholesale

`unescapeJsonFragment` (`src/features/chat/items/transcriptRows.ts`) recovers a
marker field by re-parsing it as a JSON string: `JSON.parse('"' + value + '"')`.

A shell command containing a regex backslash — `\s`, `\|`, `\d`, `\.` — is not a
valid JSON escape, so the parse throws. The catch returns the string **raw**,
which means _every_ escape in that command stays literal, including the ones
that were fine. A `\n` then renders as two visible characters in the middle of
the label:

```
Ran cd review-this-session-and-tell-me-how-we\ngrep -n "^\s*--color-…
```

Reproduced in isolation: the same command with the regex removed unescapes
correctly, so the failure is the invalid escape and nothing else. `grep` and
`sed` commands are precisely where this lands, which is most of them.

The fix is to unescape per recognised escape sequence rather than by
round-tripping the whole value through `JSON.parse` — one bad escape should cost
that escape, not the entire string.

## F10 — The UI advertises that the provider is Claude Code

Every CLI-side tool row carries a `cc` chip in its gutter, and the group header
reads `claude code 4 tools` rather than `ran 4 commands`. Which process executed
a tool is an implementation detail of the provider; the transcript should read
the same on a pi-native session and a Claude session.

**Removing the mark has a prerequisite, and it is the real work.** These rows
are not expandable: the provider forwards the invocation and never the result,
so there is nothing behind the chevron. Today the `cc` chip is what explains
that asymmetry. Remove it first and the rows become indistinguishable from pi's
own while still going nowhere when clicked — a worse state, not a better one.

`pi-claude-cli`'s `docs/ARCHITECTURE.md` already names the fix and calls it "the
natural starting point if a front-end ever wants richer Claude-Code-side UX":
the `user` envelopes between cycles carry `tool_result` blocks for tools the CLI
ran itself, and `provider.ts` ignores them. Pairing each result to its
`tool_use_id` and forwarding it is what earns one vocabulary.

Order matters: forward the results, then drop the mark. Not the reverse.

The provider side is implemented in
[pi-claude-cli #32](https://github.com/agustinsacco/pi-claude-cli/pull/32)
(0.6.0, unmerged/unpublished as of 2026-09-01): behind
`PI_CLAUDE_CLI_TOOL_RESULTS=1`, call markers gain `#<toolUseId>` and each
result arrives as `[Claude Code · result #<toolUseId> {status, preview,
length, truncated?}]`. pidex's consumer lane sets the env var for Claude
sessions, parses both shapes, pairs by id, renders the rows expandable — and
only then removes the `cc` mark.

## MCP functional verification, 2026-09-01

Every gateway path exercised live against the four configured servers.

| Path                       | Result                                        |
| -------------------------- | --------------------------------------------- |
| `mcp({})`                  | fails — F8                                    |
| `mcp({server})`            | ok — linear 67, fellow 20, notion, braintrust |
| `mcp({search})`            | ok — 17 matches for `issue`                   |
| `mcp({describe})`          | ok — returns parameter shape                  |
| `mcp({tool, args})`        | ok — live `linear_list_teams`                 |
| `mcp({connect})`           | ok — reports OAuth needed for braintrust      |
| `mcpScript` `tools.search` | ok — cross-server, 22 hits for `page`         |
| `mcpScript` `tools.call`   | ok — chained calls, `emit()` output           |
| linear / notion / fellow   | ok — live calls returned real data            |
| braintrust                 | configured, needs OAuth — correct state       |

Aside from F8, MCP works on all four servers. One DX note:
`tools.search({query: ""})` returns 0 rather than listing the server, so an
empty query matches nothing instead of everything.

## Sequencing

F1+F2+F9, then F3+F5+F6, then F4+F7 — three independent lanes, mostly against
`toolSummaries.ts` / `transcriptRows.ts` and covered by their existing sibling
test files.

F8 and F10 are cross-repo and ordered. F8 is a one-line fix plus a publish. F10
needs `tool_result` forwarding to land in `pi-claude-cli` **before** the `cc`
mark comes out of pidex, or the rows lose the one thing that currently explains
why they do not open.
