# The architecture diagram described three classes that do not exist

`docs/` became the technical manual in
[2026-08-30-docs-specs-split.md](2026-08-30-docs-specs-split.md), but its
load-bearing documents had no diagrams — and the one picture that did exist was
wrong.

`architecture.md` carried an ASCII process model naming `WorkspaceManager`,
`SessionManager` and `FsService`. None of the three is in the codebase. The
real modules are `SessionRegistry` (`electron/pi/session-registry.ts`, held by
`electron/registry.ts` alongside `FleetHub`), `PiRpcClient`
(`electron/pi/rpc-client.ts`) and `PtyManager` (`electron/pty/pty-manager.ts`).
The same section claimed 13 IPC prefixes. There are 15, across 130 invoke
channels.

That is the failure mode a hand-drawn diagram has: nothing compiles it, so it
decays silently and is believed anyway, because a picture reads as more
authoritative than prose.

## What was added

Four Mermaid diagrams, each checked against the code it describes rather than
against the prose around it.

| Doc                 | Diagram                | Answers                                              |
| ------------------- | ---------------------- | ---------------------------------------------------- |
| `architecture.md`   | Process model          | Which process owns what, and what crosses the bridge |
| `architecture.md`   | One streamed prompt    | Why the command response and the stream are separate |
| `pi-integration.md` | Session lifecycle      | When a session is a process, and when it is a file   |
| `orchestration.md`  | Fleet tool call gating | Which mode refuses which command, and where          |

The prompt sequence exists to make one thing legible that prose kept failing to
convey: **the response to `prompt` and the turn it produces are two different
mechanisms.** The command is correlated by `id` and resolves once; the content
arrives afterwards as events that never carry an `id`. Reading only the command
path, it looks like `prompt` should return the reply.

Two facts sit on that diagram because they are where bugs come from:

- A protocol error resolves as `{success: false}`. Only a broken transport
  rejects. That asymmetry is why every renderer call goes through
  `piCall`/`piCallOk`.
- pi writes the session file **only** at turn end, so nothing from the current
  turn is on disk until the reply lands.

## Verifying a diagram

Mermaid fails soft. A syntax error renders as an error box on GitHub rather
than breaking any build, so a broken diagram can sit in `main` indefinitely.

Every block here was parsed with the real `mermaid.parse()` — loaded into a
Playwright page, each fenced block fed through it — not eyeballed. That caught
a failure eyeballing would not have: a semicolon inside a `Note over` label.
Mermaid treats `;` as a statement separator, so the note terminated early and
the rest of the diagram was a parse error. It is now an em dash.

Worth repeating when adding a diagram. The check is a dozen lines of Playwright
against `mermaid.parse`, and the class of bug it catches — punctuation that is
also syntax — is invisible on review.

## Corrections made along the way

- `architecture.md` process model: replaced, with the real module names.
- IPC prefix count: 13 → 15, with a per-prefix channel table (130 total).
- Added why `registry.ts` is separate from `ipc.ts`: handler modules need the
  registry, and importing their own composition root would be a cycle.
