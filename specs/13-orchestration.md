# Orchestration (workspace agents managing session agents)

A workspace runs many sessions at once. Today nothing in pidex knows that:
each session is an island, the home screen is a greeting, and "what is
everything doing right now?" is answered by clicking through the sidebar.

This spec adds three layers, in strict order of cost:

| Layer                | What it is                                                    | Inference cost   |
| -------------------- | ------------------------------------------------------------- | ---------------- |
| **1 · fleet hub**    | Main-process state: what every session is doing, mechanically | **zero, always** |
| **2 · orchestrator** | One pi session per project that can read and drive the fleet  | only when asked  |
| **3 · rules**        | Standing instructions, memory, and an opt-in autopilot        | bounded by rules |

The ordering is the design. Layer 1 answers most of "surface the latest work
across workspaces" with no model in the loop at all; Layer 2 exists for
judgment, not for plumbing; Layer 3 is off by default.

## Rules

- **The hub never runs inference.** It is a projection of events pidex already
  receives. Nothing in Layer 1 spawns a process or spends a token.
- **The orchestrator wakes on demand, not on events.** A sweep runs when the
  user asks (or, opt-in, once when a workspace opens). There is no per-event
  agent. See [Sweeps](#sweeps-the-only-inference-trigger).
- **No hidden hand.** Every action the orchestrator takes on a session appears
  in that session's transcript, live. See [The visible-hand rule](#the-visible-hand-rule).
- **Autonomy is opt-in and capped.** Without autopilot the orchestrator may
  _propose_ work; only with autopilot may it start a session, and never more
  than `maxConcurrent` at once.
- **The orchestrator is a session like any other.** It is spawned through
  `SessionRegistry`, speaks the same RPC, renders in `ChatView`. It is not a
  second agent runtime.

## Explicitly cut

- **Burn-rate circuit breaker.** The 2026-08-21 runaway was a
  `@saccolabs/pi-claude-cli` resume-prompt bug, fixed in 0.4.6 — not a property
  of normal subscription use. Automating aborts around token rate would be
  building a control system for a defect that no longer exists. `burnRate.ts`
  stays as passive display. Do not re-add this without new evidence.
- **Per-event inference.** Considered and rejected: it makes an always-on
  model the price of opening the app.
- **Autonomous dispatch queue.** The orchestrator gets memory and a _propose_
  action instead; unattended spawning lives behind autopilot only.

---

## Layer 1 — the fleet hub

`electron/orchestrator/fleet.ts`. Subscribes to every live session's
`PiRpcClient` and maintains one normalized record per session. The registry
gains `created` / `disposed` events so the hub attaches without
`pi-session-handlers.ts` having to remember to tell it (any future creation
path is covered for free).

### State

```ts
// shared/models.ts
export type FleetPhase = 'streaming' | 'awaiting-input' | 'idle' | 'error' | 'exited'

export interface FleetQuestion {
  requestId: string
  method: 'select' | 'confirm' | 'input'
  title: string
  message?: string
  options?: string[]
  askedAt: number
}

export interface FleetSession {
  sessionId: string
  workspacePath: string
  diskPath?: string
  title?: string
  phase: FleetPhase
  /** Last assistant prose line, truncated to 160 chars. */
  lastLine?: string
  /** Tool executing right now, if any. */
  currentTool?: string
  /** Best-effort paths this session's tools touched; bounded to 50. */
  filesTouched: string[]
  pendingQuestion?: FleetQuestion
  lastActivityAt: number
  /** Set when phase became 'idle'; powers "waiting 14 min". */
  idleSince?: number
  turns: number
  isOrchestrator: boolean
}

export interface FleetSnapshot {
  sessions: FleetSession[]
  updatedAt: number
}
```

### Event mapping

The reducer is a **pure function** (`fleetReducer(state, event) → state`) so it
is unit-testable without Electron or a subprocess.

| Input                                     | Effect                                                   |
| ----------------------------------------- | -------------------------------------------------------- |
| `agent_start`                             | `phase: 'streaming'`, `turns++`                          |
| `tool_execution_start`                    | `currentTool`, harvest path-ish args into `filesTouched` |
| `tool_execution_end`                      | clear `currentTool`                                      |
| `message_end` (assistant, has text)       | `lastLine` = last non-empty prose line, truncated        |
| assistant `stopReason: 'error'`           | `phase: 'error'`                                         |
| `agent_end` / `agent_settled`             | `phase: 'idle'`, `idleSince: now`                        |
| extension-UI `select`/`confirm`/`input`   | `pendingQuestion`, `phase: 'awaiting-input'`             |
| a reply sent via `pi:extensionUiResponse` | clear `pendingQuestion`                                  |
| `exit`                                    | `phase: 'exited'`                                        |

Cost and token totals are deliberately **not** recomputed here — `SessionMeta`
already carries them from the scanner, and a second cost pipeline is a second
thing to get wrong.

`filesTouched` is best-effort: string args named `path` / `file_path` /
`filePath`. It is a signal, never a claim, and the UI labels it as such.

### Transport

- `fleet:state` (invoke) → `FleetSnapshot`, for first paint.
- `fleet:changed` (push) → `FleetSnapshot`, broadcast to every window with
  `BrowserWindow.getAllWindows()`, matching `fs:changed` and `pty:status`.
  Debounced ~150 ms: a streaming session emits per-token events and the home
  screen must not re-render at that rate.

### Collision detection (free, no model)

Two sessions with the same entry in `filesTouched` is a pure function over the
snapshot — and this repo has the scar to justify surfacing it (P11's log: two
concurrent sessions destroyed each other's uncommitted work). It renders as a
mechanical inbox warning. No orchestrator involvement.

---

## Layer 2 — the orchestrator agent

One pi session per **project** (keyed by `mainRepoPath`, so a worktree and its
main repo share one orchestrator, exactly as the sidebar groups them).
Lazy: nothing spawns until the user clicks the spark.

### Spawning

`electron/orchestrator/manager.ts` calls `registry.create()` with:

- `cwd` = the project's main repo path.
- `extensions` = `bundledExtensions()` **plus** `pi-ext/orchestrator.ts`.
- `appendSystemPrompt` = a fixed preamble (what the fleet is, what the tools
  do, the visible-hand and autonomy rules) **concatenated in main** with the
  contents of the rules file. pi's `--append-system-prompt` accepts text _or_ a
  file path; passing composed text removes the ambiguity and lets the preamble
  exist.

### Identifying an orchestrator session

Two mechanisms, belt and braces, because a missed identification shows up as
the orchestrator masquerading as ordinary work:

1. **Prefs are the fast path.** `orchestratorSessions: Record<string, string>`
   maps main-repo path → the orchestrator's session **file path**. Written once
   the session's path is known, and it doubles as the resume target: `ensure()`
   resumes that path if it still exists, else creates a fresh session. That
   reuses `CreateSessionOptions.sessionPath`, which pidex already does for every
   reopened session — no `--session-id` semantics to depend on.
2. **A name sentinel is the durable fallback.** The session's pi name is set
   (`set_session_name`) to a reserved prefix. The scanner already reads `name`
   into `SessionMeta`, so an orchestrator session stays identifiable after a
   prefs reset, and the prefix is re-applied if a user renames it.

Both feed **one exported predicate**, `isOrchestratorSession(meta)`, which is
the single choke point every consumer must use. Missing one is the bug this
section exists to prevent — see [Differentiation](#differentiation).

### Context hygiene

The orchestrator is **one long-lived session per project**, not a pool and not
a rotating set. Sweeps run in that same thread. Its context is kept honest by
the mechanisms pi already has, both of which pidex already ships:

| Mechanism       | Effect                                      | Status in pidex           |
| --------------- | ------------------------------------------- | ------------------------- |
| auto-compaction | summarizes at threshold, thread continues   | ships; on by default      |
| `/compact`      | summarize now, optionally with instructions | ships (menu + `/compact`) |

That is deliberately the whole list. pi has **no `/clear`** (verified against
0.84.2's `BUILTIN_SLASH_COMMANDS`), and its `/new` — which starts a _different_
session rather than clearing this one — is **not** wired up and should not be:
`new_session` rebinds the live process to a new session file, which would
invalidate the prefs pointer above and strand the renderer's per-session state.
Compaction is sufficient. Continuity that must outlive compaction belongs in
the memory file, not in context.

### The control channel

The orchestrator's tools run inside pi and need to reach main. **They do not
open a socket.** pi's `ExtensionUIContext.input(title, placeholder, opts)`
returns `Promise<string | undefined>` and, in RPC mode, round-trips through the
`extension_ui_request` / `extension_ui_response` pair pidex already implements
(verified against pi 0.84.2: `dist/core/extensions/types.d.ts`, and
`examples/rpc-extension-ui.ts` demonstrates the full loop). So:

```
extension → pidex   extension_ui_request { method: 'input',
                      title: 'pidex-fleet:v1:<command>',
                      placeholder: '<json args>' }
pidex → extension   extension_ui_response { id, value: '<json result>' }
```

`electron/orchestrator/bridge.ts` intercepts requests whose title carries the
sentinel **and whose session is the registered orchestrator for its project**,
handles them, and does not forward them to the renderer. Every other session's
sentinel request is forwarded as an ordinary dialog, so it cannot be used as a
covert channel.

Why this over a local socket: no new listening surface, no token to leak, no
`app.isPackaged` gate to get wrong (compare the standing warning about
`PIDEX_PI_STUB`), and the transport is already exercised by every extension
dialog in the app. Authorization is structural — main knows which session id it
spawned as an orchestrator.

Each call passes `opts.timeout` (20 s) so a wedged main resolves `undefined`
rather than hanging a tool forever. Failures come back as
`{"ok":false,"error":"…"}` and become tool errors, never exceptions.

### Tools

| Tool             | Args                                         | Does                                                       |
| ---------------- | -------------------------------------------- | ---------------------------------------------------------- |
| `fleet_status`   | —                                            | the snapshot, plus on-disk sessions for this project       |
| `session_read`   | `sessionId`, `limit?`                        | recent transcript tail (`get_messages` on the live client) |
| `session_send`   | `sessionId`, `text`, `mode: steer\|followUp` | speak to a running agent                                   |
| `session_stop`   | `sessionId`                                  | `abort`                                                    |
| `session_answer` | `sessionId`, `requestId`, `value`            | resolve a pending clarifying question                      |
| `git_status`     | `sessionId \| path`                          | branch, dirty count, PR state (wraps `git:*` / `gh:*`)     |
| `propose_work`   | `title`, `prompt`, `workspacePath?`          | queue an inbox suggestion — or spawn, under autopilot      |
| `memory_read`    | —                                            | the memory file                                            |
| `memory_write`   | `content`                                    | replace it (whole-file; the model owns its own notes)      |
| `publish_digest` | `DigestPayload`                              | what the home screen and sidebar render                    |

`session_send`, `session_stop`, `session_answer` and `propose_work` are
mutations and are the ones autopilot governs.

### Sweeps: the only inference trigger

A sweep is a prompt main injects into the orchestrator session. Kinds:

- **`brief`** — "what happened, what needs me". The snapshot rides in the
  prompt (a few hundred tokens); tools are available for drill-down.
- **`review`** — the per-session pass: read what each session has been doing,
  check git/PR state, and recommend — _this feature merged, archive the chat_,
  _this one stalled_, _this one drifted from its charter_. This is the case
  that motivated the design: judgment applied deliberately, not continuously.
- **`question`** — a free-form user message; an ordinary prompt.

Triggers: the "Brief me" button, a per-group "Review" action, and (opt-in)
once when a workspace opens. Guards: a minimum interval between automatic
sweeps, and a skip when nothing in the snapshot changed since the last one.
The orchestrator's own session is excluded from the fleet it reports on, so a
sweep cannot trigger itself.

### The digest wire contract

The orchestrator publishes through `ctx.ui.setStatus` — the **same channel**
the context meter already uses ([12-extensions.md](12-extensions.md#the-status-channel-is-a-wire-contract)),
so no new plumbing. Key: `pidex-orchestrator`.

```ts
export interface DigestItem {
  kind: 'attention' | 'suggestion' | 'note'
  sessionPath?: string
  text: string
  action?: {
    label: string
    kind: 'open' | 'resume' | 'archive' | 'merge' | 'start'
    payload?: string
  }
}

export interface OrchestratorDigest {
  workspacePath: string
  updatedAt: number
  headline: string
  items: DigestItem[]
}
```

Same rules as every other status payload: JSON in a string, the parser returns
`null` on garbage rather than throwing, a missing key renders nothing (never an
empty section), and the emitter swallows its own errors so a status push can
never break a turn.

---

## Layer 3 — rules, memory, autopilot

Both files live in `<mainRepo>/.pidex/`:

- `orchestrator.md` — standing rules, compiled into the system prompt at spawn.
- `orchestrator-memory.md` — the orchestrator's own notes, read and rewritten
  through its memory tools.

**These are personal, not team-shared.** `electron/fs/git-worktrees.ts` adds
`/.pidex/` to `.git/info/exclude`, so anything there is invisible to git. That
is the right default (no repo pollution, no PR noise), but the doc must not
pretend the rules are code-reviewable. A team that wants shared rules commits a
file elsewhere and points the setting at it.

Rules are prose, not config — "if a session idles more than 30 minutes with
uncommitted work, tell me"; "never steer a session that is mid-refactor";
"prefer proposing over acting". They are appended to the preamble verbatim.

```ts
export interface OrchestratorWorkspacePrefs {
  /** False until the user first opens the orchestrator for this project. */
  enabled: boolean
  /** May mutate sessions and spawn work without asking. */
  autopilot: boolean
  /** Cap on autopilot-spawned live sessions. */
  maxConcurrent: number
  /** Run one `brief` sweep when this workspace opens. */
  sweepOnOpen: boolean
  /**
   * Model for the FIRST spawn only. After that the orchestrator's own picker
   * owns it: pi records `model_change` in the session file and restores model
   * and thinking level on resume, so the choice persists with no pidex state.
   */
  model?: string
}
```

Defaults: `enabled false`, `autopilot false`, `maxConcurrent 2`,
`sweepOnOpen false`. Stored per main-repo path in `AppPrefs`.

---

## Differentiation

An orchestration thread manages work; a normal session _is_ work. They must
never be mistaken for each other, in either direction.

**The orchestrator, in the sidebar.** It does not sort among work sessions.
It renders as a single distinct row pinned above its group's list: spark glyph
instead of a status dot, the label "Orchestrator", no branch/worktree subtitle
(it always runs on the main repo), and an attention count when its digest holds
unresolved items. Visible enough to be discoverable, shaped differently enough
that it never reads as a task.

**The orchestrator, when open.** `OrchestratorChat` keeps `ChatView` but changes
its chrome: an accent rail, a header naming the project it manages and the
sessions in scope, its own cost, and a composer placeholder that asks about the
fleet rather than about code. Fleet tool calls render as fleet actions, not as
generic tool cards.

**The other direction — inside worker sessions.** Anything the orchestrator
injected carries an explicit badge in that session's transcript, per
[the visible-hand rule](#the-visible-hand-rule). A user reading a session must
always be able to tell which messages they wrote and which the manager did.

**Everywhere else, one predicate.** `isOrchestratorSession()` gates the sidebar
list, `groupSessionsByProject`, `workspaceStats()` (home tiles + heatmap) and
`usageSummary()`. In Usage the orchestrator is shown as its own labelled line
rather than filtered out — hiding what it costs would be worse than showing it.

---

## Surfaces

### Home becomes mission control

`src/features/home/WorkspaceHome.tsx`, rebuilt. It renders **across
workspaces**, reusing `groupSessionsByProject` so home and sidebar can never
disagree about what a project is.

1. **Header** — greeting, one line of mechanical truth ("3 agents working · 2
   need you · $4.12 today"), and **Brief me** (sweeps the active workspace).
2. **Needs you** — the inbox. Pending clarifying questions rendered with their
   real options as buttons (answering posts `pi:extensionUiResponse`, exactly
   what `ExtensionDialogHost` does today); finished sessions with a mergeable
   branch; errored sessions; collision warnings. Items with `enabled`
   orchestrators also offer _let the orchestrator decide_.
3. **Per-project groups** — each headed by the digest headline (absent until a
   sweep has run), then session cards: phase dot, title, `lastLine`, cost, and
   an **inline composer** that maps to `steer` while streaming and `follow_up`
   when idle, plus stop/open. Dormant sessions show _Resume_ instead.
4. **Composer** — the existing one, unchanged in behavior.

The stats card and heatmap move below the fold; they are a flourish, and the
fleet is the point.

### Sidebar

The workspace group header (name + caret + plus, in
`src/features/sessions/Sidebar.tsx`) gains a third control: a spark that opens
that project's orchestrator chat. Its state doubles
as a light — quiet when idle, filled with a count when the digest holds
attention items. `WorkspaceSwitcher` carries the same control for the active
project.

### The orchestrator chat

`src/features/orchestrator/OrchestratorChat.tsx` wraps the ordinary `ChatView`
with a distinct header: scope (sessions under watch), its own cost, an
autopilot switch, and a rules editor. Sweep prompts appear in the transcript as
ordinary user messages, which is honest — they _are_ what was sent.

### The visible-hand rule

A message main injects into a session bypasses the renderer, so that session's
open transcript would not show it until reload. `SessionPush` gains
`{ kind: 'injected'; text: string; source: 'orchestrator' }`; `stores/sessions.ts`
turns it into a user message with an orchestrator badge. pi persists it either
way — this only fixes what the live UI shows.

---

## Build order (one PR, ordered commits)

Each commit leaves the app runnable, per TRACKER's standing rule.

1. **Contracts.** Fleet/digest/prefs types in `shared/models.ts`, channels in
   `shared/ipc.ts`, `SessionPush.injected`, `onFleetChanged` in `PidexApi`,
   preload wiring, `mockPidex` cases.
2. **The hub.** `registry` create/dispose events; `fleet.ts` + pure
   `fleetReducer`; broadcast; `fleet:state`. **Unit tests on the reducer.**
3. **The bridge.** Sentinel interception in `pi-session-handlers.ts`,
   `bridge.ts` dispatch table. **Unit tests with a fake registry**, including
   the authorization case (a non-orchestrator session's sentinel is forwarded,
   not executed).
4. **The manager.** Spawn, prefs pointer + name sentinel,
   `isOrchestratorSession()` and every consumer it gates (sidebar, home stats,
   usage), system-prompt composition, rules and memory resolution,
   `orchestrator:ensure|sweep|rules`.
5. **The extension.** `pi-ext/orchestrator.ts` — tools over the bridge, digest
   publisher.
6. **Renderer plumbing.** `src/stores/fleet.ts`, digest parser (garbage →
   `null`), sidebar orchestrator row, `OrchestratorChat` chrome.
7. **Mission control.** The home rebuild: inbox, group digests, session cards,
   inline composer. Collision detection lands here (pure function + card).
8. **Notifications.** Native notification on attention items while unfocused
   (coalesced per sweep, never per event), app badge count, mute switch. Today
   the app has **no** notification code at all — this is new ground, not polish.
9. **Rules, autopilot, settings.** Rules editor, prefs surface, `propose_work`
   gating, autopilot rails (depth cap, daily ceiling, no resume-on-launch).
10. **Single-instance lock.** `requestSingleInstanceLock()` in `main.ts`. Two
    pidex instances would mean two orchestrators writing one memory file.
11. **Proof and docs.** e2e stub support + specs; this file finalized; a dated
    `specs/log/` entry.

**Minimum shippable core is 1–2 and 7.** If the PR has to be cut, the hub plus
mission control delivers "surface the latest work and speak to each agent" with
no model in the loop at all, and the orchestrator lands second.

## Verification

`npm run validate` (typecheck, lint, prettier, unit, build, e2e) must be green.
Specifically:

- **Pure unit:** `fleetReducer` phase transitions and `filesTouched` bounding;
  digest parser on malformed input; `isOrchestratorSession` across both the
  prefs pointer and the name sentinel; sweep-prompt composition; bridge
  dispatch + authorization; collision detection.
- **DOM unit:** inbox renders a pending question's real options; a session card
  routes to `steer` vs `follow_up` by phase.
- **Filtering regression:** an orchestrator session is excluded from
  `groupSessionsByProject` and from `workspaceStats()`, and labelled rather
  than dropped in `usageSummary()`. This is the leak that would otherwise ship
  silently.
- **e2e:** (a) the spark opens an orchestrator chat and its digest renders in
  the group header; (b) a stubbed clarifying question appears in the home
  inbox and answering it clears it from both inbox and session.
  `e2e/fixtures/pi-stub.cjs` needs to emit an extension-UI request on a magic
  prompt and to answer sentinel `input` requests. Note the stub is spawned
  **without** bundled extensions today, so orchestrator tool behavior under
  e2e is simulated by the stub, not exercised for real — say so in the test.

## Sharp edges

- **The control channel rides a UI primitive.** If pi ever makes RPC-mode
  `input` require real interaction, the bridge breaks. The sentinel is
  versioned (`v1`) and the extension surfaces a clear error rather than
  hanging. Re-verify against pi on every protocol bump, alongside
  `shared/rpc.ts`.
- **Authorization is by session id, not by secret.** Keep it that way; a
  sentinel that any session could use would be a covert channel into main.
- **Recursion.** The orchestrator's own session must stay out of the fleet it
  reports on, or a sweep observes itself.
- **Sweeps cost real tokens, and they accumulate in the one thread.** That is
  the accepted trade for keeping a single orchestrator session. Auto-compaction
  bounds it automatically and `/compact` is the manual escape. Sweeps
  are user-initiated by default, rate-floored when automatic, and skipped when
  nothing changed. The orchestrator's context meter and cost are shown in its
  header so neither is invisible.
- **A model with no tool support silently breaks the orchestrator.** Its tools
  simply never get called. The picker must say so; `modelAvailability.ts`
  already handles the separate case of uninvocable Bedrock rows.
- **The first spark click must not spend money.** It opens the chat with an
  explainer and a separate "Run first brief" — never a silent sweep behind a
  button whose label doesn't say it costs.
- **Overlapping sweeps are refused, not queued**, with the running one
  surfaced.
- **Non-git workspaces** have no `mainRepoPath`, so keying falls back to the
  folder and `.pidex/` is not git-excluded there (there is no git).
- **No new unbounded watchers.** The hub listens to processes that already
  exist; it must not add per-file or per-repo watching.
- **`.pidex/` is git-excluded** by pidex itself — rules and memory are personal
  by default. Do not describe them as shared.
- **YOLO still holds.** [00-overview.md](00-overview.md) forbids approval
  gates on tool calls. Autonomy is tuned through rules and the autopilot
  switch, never by adding per-action confirmation dialogs.

## Deferred

Feature board derived from session + git + PR state; cross-session pre-briefs;
watch expressions; scheduled sweeps beyond workspace-open; a cross-workspace
(global) orchestrator; scope-drift detection as a mechanical signal rather than
a `review` finding.
