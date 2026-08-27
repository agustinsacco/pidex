# specs

Four kinds of document live here, and they are **not** interchangeable. Before
you trust a file, check which folder it is in.

| Folder                   | Genre                                                           | Trust it?                                   |
| ------------------------ | --------------------------------------------------------------- | ------------------------------------------- |
| [reference/](reference/) | Living contracts. Describe how pidex behaves **now**.           | **Yes** — fix it if the code disagrees.     |
| [build/](build/)         | Original pre-implementation requirements, kept for intent.      | **No** — historical. Reference wins.        |
| [backlog/](backlog/)     | Audits with open findings. Each finding carries its own status. | Only per-finding; check the status column.  |
| [log/](log/)             | One dated write-up per shipped change. Says what broke and why. | As history, yes. Not as current-state docs. |
| [TRACKER.md](TRACKER.md) | Phase state and the few remaining open boxes.                   | Yes, for status. Not for behaviour.         |

Two rules that keep this workable:

1. **One fact, one home.** If `reference/` and anything else disagree,
   `reference/` is right and the other file gets fixed or deleted.
   The exception is visual identity, where
   [reference/style-guide.md](reference/style-guide.md) is the authority even
   over other reference docs.
2. **No shared index that has to be maintained.** `log/` deliberately has none
   (see [log/README.md](log/README.md) for why); the table below covers only
   the small, stable folders.

## reference/ — living contracts

| File                                             | Covers                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| [overview.md](reference/overview.md)             | Product definition, non-negotiables, engineering quality bar     |
| [architecture.md](reference/architecture.md)     | Process model, IPC design, cross-cutting requirements            |
| [pi-integration.md](reference/pi-integration.md) | pi's RPC protocol and session format — the load-bearing document |
| [style-guide.md](reference/style-guide.md)       | The Phosphor visual identity. Authoritative on all colour/type   |
| [ui-shell.md](reference/ui-shell.md)             | Window chrome, top bar, sidebar, pane system, theming            |
| [chat.md](reference/chat.md)                     | Transcript rendering, composer, tool cards                       |
| [terminal.md](reference/terminal.md)             | PTY panes, clipboard, scrollback, per-session ownership          |
| [settings.md](reference/settings.md)             | The settings window and which config file each tab writes        |
| [worktrees.md](reference/worktrees.md)           | Git worktree lifecycle and the branch control                    |
| [mcp.md](reference/mcp.md)                       | MCP servers via the pi-mcp-adapter config chain                  |
| [extensions.md](reference/extensions.md)         | The five bundled pi extensions; provider transcript shapes       |
| [orchestration.md](reference/orchestration.md)   | The orchestrator session, fleet hub, and its three modes         |
| [cli-providers.md](reference/cli-providers.md)   | Running sessions on external CLI providers (Claude Code)         |

## build/ — historical requirements

The four survivors of the original `00`–`10` build set, kept because they record
intent that the code still reflects. Everything else from that set was either
promoted into `reference/` or has been superseded. See
[build/README.md](build/README.md).

## backlog/ — open findings

[cleanup-plan.md](backlog/cleanup-plan.md) (duplication and dead code) and
[perf-findings.md](backlog/perf-findings.md) (memory and CPU on the streaming
path). Both are per-finding status tables now, not prose backlogs. See
[backlog/README.md](backlog/README.md).

## Writing a new document

- Shipped a change? `log/YYYY-MM-DD-slug.md`, and update any `reference/` file
  it makes wrong. That is the common case.
- Changed how a subsystem behaves? The matching `reference/` file is part of the
  diff, not a follow-up.
- Wrote a plan? Keep it out of here until it lands, then fold what is still
  true into `reference/` and delete the plan. **There is no archive.** There was
  one until 2026-08-27, holding nine landed plans that nothing read and that
  quietly contradicted the live docs; git already keeps history, and a folder of
  documents nobody trusts is worse than no folder. Write the durable part into
  `reference/`, the story into `log/`, and let the plan go.
