# Plan — pi session resource management

2026-08-31 · **All three phases shipped 2026-09-01** — Phase 1:
[session-scan-and-ipc-trims](../../log/2026-09-01-session-scan-and-ipc-trims.md),
Phases 2–3:
[session-reaper-and-live-stats](../../log/2026-09-01-session-reaper-and-live-stats.md)

How pidex manages pi sessions, audited on the three axes that actually cost
something: **memory** (live subprocesses), **filesystem** (session files read
and watched), and **per-turn wire traffic** (RPC round trips + IPC payloads).

Every item is labelled **MEASURED** (a number from this machine, today),
**VERIFIED** (read the code and confirmed the claim) or **REASONED** (an
argument, no number). Measurements are on pi 0.84.1, macOS, 112 real session
files.

This is deliberately narrower than
[perf-findings.md](perf-findings.md), which audits the whole streaming path.
Where the two overlap the finding is cross-referenced; where this audit
contradicts it, this one is newer and was re-derived from the running system.

---

## Baseline, measured today

| Quantity                                       | Measured                     |
| ---------------------------------------------- | ---------------------------- |
| RSS of one idle `pi --mode rpc`                | 197–207 MB                   |
| RSS of three idle sessions                     | 602 MB                       |
| Session files on disk (`~/.pi/agent/sessions`) | 112 files, 25 MB             |
| Largest session file                           | 3.56 MB                      |
| Full parse of that file                        | 12.6 ms (~450 MB/s)          |
| Bytes re-parsed over all session lifetimes     | **815 MB** for 25 MB on disk |
| `get_session_stats` round trips per user turn  | **26.0** (12 real sessions)  |

---

## Summary

| #   | Status    | Axis   | Finding                                                                       | Sev  | Evidence |
| --- | --------- | ------ | ----------------------------------------------------------------------------- | ---- | -------- |
| S1  | **fixed** | memory | Live pi subprocesses are uncapped and never reclaimed when idle               | high | MEASURED |
| S2  | **fixed** | memory | A renderer reload orphans every live pi, and no reclaim path exists any more  | high | VERIFIED |
| S3  | **fixed** | fs     | The scanner re-reads a whole session file on every append (O(n²) per session) | high | MEASURED |
| S4  | **fixed** | wire   | `agent_end.messages` / `turn_end.toolResults` cross IPC and are then dropped  | med  | VERIFIED |
| S5  | **fixed** | wire   | ~26 `get_session_stats` round trips per user turn                             | med  | MEASURED |
| S6  | **fixed** | fs     | `metaCache` is unbounded and never evicts deleted files                       | med  | VERIFIED |
| S7  | **fixed** | fs     | `sessionDirForCwd` does a synchronous `realpathSync` on every call            | low  | VERIFIED |
| S8  | **fixed** | fs     | `currentLeafId` reads and splits the entire file to find one id               | low  | VERIFIED |
| S9  | **fixed** | fs     | The session-dir watcher costs one fd per session file, unbounded              | low  | REASONED |
| S10 | **fixed** | fs     | A null meta was never cached, so headerless files re-parsed on EVERY scan     | med  | MEASURED |

**Checked and found healthy** — do not re-investigate:

- **Deleting a session already deletes both ledgers.** `session-deleter.ts`
  trashes pi's transcript _and_ the Claude CLI's parallel copy, resolving the
  CLI's own session id through `claude-session-map.ts`. MEASURED: pidex's 52
  worktree lanes hold 11 MB of pi ledgers against 46 MB of CLI transcripts, so
  the copy that delete used to miss is the larger one. It does not miss it now.
- **`get_session_stats` does no I/O.** It reads pi's in-memory state. S5 is a
  round-trip-count problem, not a disk problem.
- **The fleet hub is already zero-inference.** It derives phase and activity
  from events pidex receives anyway. S1's reaper can consume it for free.
- **pi writes a session file only at turn end**, not incrementally, so S3's
  cost is per turn and not per token.

---

## S1 — Live pi subprocesses are uncapped and never reclaimed

**high · MEASURED · `electron/pi/session-registry.ts`, `src/stores/sessions.ts`**

Three idle sessions measured 207 + 197 + 198 = **602 MB RSS**. History barely
moves the number; the floor is the Node/V8 runtime, so an idle session costs
almost exactly what a busy one does. Ten open lanes is ~2 GB.

Nothing reclaims them. `registry.dispose` is reached only by explicit user
action — the chat banner, the model picker, the tree modal, the sidebar's
"suspend", deleting a session — or by quitting the app. There is no cap, no
idle timer, and no memory-pressure response.

`suspendSession` (`src/stores/sessions.ts:738`) already does exactly the right
thing: dispose the subprocess, keep the sidebar row, remember the disk path so
reopening resumes. It is wired to one context-menu item and nothing else. The
mechanism exists; the **policy** does not.

## S2 — A renderer reload orphans every live pi

**high · VERIFIED · `electron/main.ts:88`, `electron/pi/session-registry.ts:50`**

The registry lives in the main process; the renderer's `live` map is ordinary
zustand state. A renderer reload — HMR in dev, a renderer crash, the packaged
app's own re-navigation — gives the renderer a fresh empty store while the
registry keeps every child process alive. At ~200 MB each, one reload with
five sessions open strands a gigabyte until quit.

perf-findings F16 described this and pointed at `pi:listLiveSessions` as the
unused fix. That channel **no longer exists** — it is absent from
`shared/ipc.ts` and from the handlers. `SessionRegistry.list()` survives with a
single caller, the fleet hub. So the leak is unchanged and the escape hatch is
now gone entirely.

`window.webContents.on('did-finish-load', …)` already exists in `main.ts` for
zoom, which proves reloads happen and gives the reaper its hook.

## S3 — The scanner re-reads a whole session file on every append

**high · MEASURED · `electron/pi/session-scanner.ts:44-58`**

`listSessionsInDir` caches meta on `(mtimeMs, size)`. pi appends at the end of
every turn, so both change every turn, so `parseSessionFile` re-reads the file
from byte 0 — every time. The work per turn is O(file), which makes the work
over a session's life O(n²).

MEASURED across all 112 real session files, counting one re-parse per
persisted assistant message:

```
25 MB on disk  →  815 MB re-parsed over their lifetimes
worst single session: 1.33 MB file, 132× amplification, 175 MB re-read
largest session:      3.56 MB file,  51× amplification, 182 MB re-read
```

The debounces (`awaitWriteFinish` 250 ms + a 300 ms notify debounce) coalesce
some bursts, so 815 MB is an upper bound — but the shape is O(n²) either way,
and the per-turn latency is real: 12.6 ms today for the largest file, growing
linearly with the session.

Session files are append-only, which is what makes the fix available: parse
only the bytes past the previous size.

## S4 — Two large event payloads cross IPC to be thrown away

**med · VERIFIED · `electron/ipc/pi-session-handlers.ts:189`, `src/features/chat/reducer.ts:82,111`**

`session.client.on('event', (ev) => push({ kind: 'event', event: ev }))`
forwards every pi event verbatim. Two of them carry the whole turn:

- `agent_end` — `{ messages: AgentMessage[], willRetry?: boolean }`. The
  reducer reads `event.willRetry` and **nothing else**.
- `turn_end` — `{ message: AgentMessage, toolResults: ToolResultMessage[] }`.
  The reducer's branch is `case 'turn_end': return state`.

Both are structured-cloned across the process boundary once per run, then
discarded. This is pure waste with no behavioural risk in removing it.

## S5 — ~26 `get_session_stats` round trips per user turn

**med · MEASURED · `src/stores/sessions.ts:15-29,197`**

`shouldRefreshStatsOn` fires on `agent_end`, `compaction_end`, `message_end`
and `tool_execution_end`. Counted across the 12 largest well-formed sessions on
this machine: 3 174 stats-triggering events over 122 user turns = **26.0 round
trips per user turn**, each one renderer → main → pi stdin → pi stdout → main →
renderer. Per session it ranges from 2 (a short chat with no tools) to 91 (a
tool-heavy run), so the cost tracks tool use, not conversation length.

`shared/rpc.ts:248` says `message_update` carries cumulative `usage`, which
would make most of these unnecessary — but only on **pi ≥ 0.84.2**. Installed
here is **0.84.1**; published is 0.84.4. Any fix needs a version gate and a
fallback, or it silently freezes the context meter for anyone on an older pi.

## S6 — `metaCache` is unbounded and never evicts

**med · VERIFIED · `electron/pi/session-scanner.ts:28`**

A plain `Map`, added to and never pruned. Deleted sessions keep their entry
forever, and every session ever scanned holds its `SessionMeta` (including a
200-char `firstUserText`) for the life of the process. Small per entry, but
unbounded in a long-running desktop app. Same finding as perf-findings F17.

## S7 — `sessionDirForCwd` does a synchronous `realpathSync` per call

**low · VERIFIED · `electron/pi/pi-paths.ts:62,70`**

Every `listSessions`, every `watchWorkspaceSessions`, every scan of every
workspace pays a blocking `realpathSync.native` on the main thread. A
workspace's real path does not change while the app runs, so the whole thing
is memoizable to one syscall per cwd.

## S8 — `currentLeafId` reads and splits the entire file

**low · VERIFIED · `electron/pi/session-writer.ts:17-28`**

`readFile(path, 'utf8')` then `.split('\n')` on the whole transcript, to find
the id of the last non-header entry. On a 3.5 MB session that is a 3.5 MB read
plus a full split to look at the tail. Called on every bookmark and branch
jump — low frequency, trivially bounded by reading a tail window instead.

## S9 — Session-dir watchers cost one fd per session file

**low · REASONED · `electron/pi/session-watcher.ts:36`**

`depth: 0` bounds recursion but not file count, and chokidar opens one fd per
watched **path** — the exact mis-bound that caused the 2026-08-31 EMFILE
incident on the workspace watcher. MEASURED: the busiest session directory here
holds 10 files, so this is not a problem today. It becomes one at thousands of
sessions in one workspace, and the fix is already written next door.

---

## Implementation

Three phases. Phase 1 is behaviour-preserving and independently shippable;
Phase 2 is the large win and the only one that changes what the user sees;
Phase 3 is gated on a pi upgrade.

### Phase 1 — Reclaim the waste that nothing depends on — SHIPPED 2026-09-01

No user-visible behaviour change. MEASURED end to end across ten real sessions
replayed turn by turn: **1160 ms → 209 ms (5.5×)**, scaling with turn count
(1.6× at 18 turns, 9.7× at 126). Write-up, including the two benchmarks that
were wrong first, is in
[log/2026-09-01-session-scan-and-ipc-trims.md](../../log/2026-09-01-session-scan-and-ipc-trims.md).

One finding was added during the work: **S10**, a null meta was never cached,
so a session file with no `type: "session"` header was fully re-parsed on every
scan rather than only when it changed — 3.2 MB per sidebar refresh in one real
workspace. Fixed with the rest.

The plan below is what was implemented, kept for the reasoning.

1. **S4 — strip the discarded payloads in the main process.** In
   `pi-session-handlers.ts`, replace the blanket forward with a projection that
   drops `agent_end.messages` and `turn_end.{message,toolResults}` before
   `push`. Keep the events themselves: the reducer's `willRetry` branch and the
   fleet hub both still need them.
   _Guard:_ a unit test asserting the projected event keeps `willRetry` and
   loses `messages`, plus a reducer test proving behaviour is unchanged.
   _Risk:_ `shared/rpc.ts` is a mirror of pi's protocol with compile-time drift
   guards. Do the stripping at the push boundary, not by narrowing the shared
   type, or the drift guards stop protecting anything.

2. **S3 — incremental tail parse.** Split the scanner cache in two:
   - `metaCache`: `path → {mtimeMs, size, meta}`, unchanged in purpose, now an
     LRU (fixes S6).
   - `resumeCache`: `path → {size, tailSignature, accumulators}`, a small LRU
     (~16 entries) holding the running counts, token sums, `seenParents` set,
     header and `firstUserText` needed to continue a parse.

   On a changed file: if `size > cached.size` **and** re-reading the 64 bytes
   ending at `cached.size` still matches `tailSignature`, parse only
   `[cached.size, size)` and fold into the accumulators. Otherwise fall back to
   a full parse. The signature check is what makes this safe against a rewrite
   rather than an append; a shrink or a mismatch simply costs one full read.

   _Why a second cache:_ `seenParents` is the only accumulator with unbounded
   size (~400 KB for a 3.6 MB session). Bounding it to the handful of sessions
   actually being appended to keeps the memory trivial while covering every
   file that benefits — a cold session that never changes never needs it.

   _Guard:_ a fixture session file, parsed whole, must equal the same file
   parsed in N incremental chunks — for counts, tokens, cost, `branchCount`,
   `firstUserText` and `lastActivityAt` alike. Plus a truncation case and a
   rewrite case, both asserting the full-parse fallback fires.

3. **S6 — bound `metaCache`.** LRU with an explicit cap, and drop entries whose
   file is absent during a directory listing.

4. **S7 — memoize `realCwd`.** One `Map<string, string>`, cleared never (a cwd's
   real path is stable for the process's life). Keep the try/catch fallback so
   a path that does not exist yet still resolves to itself and is **not**
   cached, or a workspace created later would be permanently mis-resolved.

5. **S8 — bounded tail read in `currentLeafId`.** Read the last ~64 KB, split,
   scan backwards; fall back to the full read only when no entry is found in
   the window.

### Phase 2 — An idle-session reaper in the main process — SHIPPED 2026-09-01

Implemented as planned (`electron/pi/session-reaper.ts`), with one deviation:
it ships **enabled by default** where the plan below said default-off. The
eligibility guards plus the double time guard bound the worst case to a
suspended idle session costing ~1 s to reopen, and a default-off reaper
reclaims nothing for anyone; the off switch stays (Settings → Advanced).
Details in the
[log](../../log/2026-09-01-session-reaper-and-live-stats.md).

The headline: turns "10 lanes open = 2 GB" into a bounded number.

**Put it in the main process, driven by the fleet hub.** The hub already
maintains, per live session, exactly the state a reaper needs — `phase`
(`streaming` / `awaiting-input` / `idle` / `error` / `exited`), `lastActivityAt`,
`idleSince`, `diskPath`, `isOrchestrator` — derived from events pidex receives
anyway, with no inference and no extra RPC. Consuming it costs nothing.

Main-process ownership is not a preference, it is the fix for **S2**: a reaper
that lives in the renderer dies with the renderer, which is the bug. A reaper
in the registry keeps working across a reload, and the same pass that enforces
the budget reclaims sessions the renderer has forgotten.

**Eligibility — a session may be reaped only if all of these hold:**

- not the active session,
- `phase` is `idle` (never `streaming`, never `awaiting-input`),
- no `pendingQuestion`,
- not an orchestrator,
- **no live PTY tabs** — see the risk below,
- `diskPath` is known, so it can actually be resumed,
- idle for longer than a grace period.

**Then, over the eligible set:** reclaim least-recently-active first until the
live count is back under budget.

**Policy decided 2026-09-01: cap + idle grace.** Keep at most N live sessions
(start at 4) and only ever reap one that has also been idle longer than a grace
period. Both conditions, not either. The cap alone gives the tightest memory
but can take a session the user touched seconds ago; the grace period alone
leaves ten rotating lanes holding ~2 GB. Requiring both means the ceiling is
predictable and a session you just used is never the one that goes. Both
numbers are settings, not constants.

Reaping calls the existing suspend path, so the sidebar row survives and
reopening resumes from disk. Surface it honestly: the row already renders a
"suspended" state, and `TranscriptSkeleton` already has copy for it.

**What reaping actually costs, and why the eligibility list is long.** Disposing
a session is not free — `disposeSession` kills every PTY tab it owns
(`pty:kill`), drops its artifacts, clears its extension UI and its layout
slice, and resuming re-spawns pi and replays history (~940 ms per the existing
comment). Artifacts and layout rebuild themselves; **a running shell command
does not**. Reaping a session with a live terminal would kill a build or a test
run with no warning. Hence the PTY exclusion, which needs a small main-process
query for "does this session have live PTYs" — `pty-manager` already keys its
sessions, so this is a lookup, not new bookkeeping.

**Sequencing:** land the reaper behind a setting defaulting to **off**, verify
on a real multi-lane day, then flip the default. The failure mode of a wrong
policy is destroyed user work, so it does not get to ship on reasoning alone.

### Phase 3 — Cut the per-turn round trips (gated on pi ≥ 0.84.2) — SHIPPED 2026-09-01

Implemented as planned (`src/lib/liveStats.ts` + the session-watcher budget),
capability-detected per session with the polling fallback intact. One thing
the plan did not know: `message_update.usage` is per-MESSAGE, not
session-cumulative (verified against pi 0.84.4's source), which is why the
implementation keeps a base+current ledger instead of reading deltas as
totals.

**S5.** When `message_update` carries cumulative `usage`, feed the context
meter and burn rate from the delta stream and drop `get_session_stats` back to
the turn boundary. Detect the capability from the first `message_update` that
carries `usage` rather than from a version string — pi is installed
independently of pidex and a version check is one more thing to keep in sync.
Keep the current polling as the fallback when no `usage` ever arrives.

**S9.** Apply the workspace watcher's `MAX_WATCHED_PATHS` budget to the
session-dir watcher. Cheap now that `createWatchFilter` exists; do it when
touching that file for another reason, not on its own.

---

## Risks and invariants

- **Never reap a session doing work.** Streaming, awaiting input, holding a
  pending question, or owning a live PTY — all disqualifying. A reaper that is
  wrong here destroys user work, which is strictly worse than the memory it
  saves.
- **The incremental parse must be provably identical to the full parse.** Not
  "close enough" — `branchCount` and the token sums feed the sidebar and the
  cost display. The equality test is the deliverable, not an extra.
- **Do not narrow `shared/rpc.ts` to implement S4.** It is a mirror of pi's
  protocol with deliberate compile-time drift guards; strip at the boundary.
- **S5 must degrade, not break.** On pi < 0.84.2 no `usage` arrives on deltas
  and the context meter must keep working via the existing polling.
- **Phase 1 changes no behaviour.** If any of it does, it is a bug in the
  change, not an accepted trade.

## Out of scope

- pi's own ~200 MB floor. It is a Node/V8 runtime cost in someone else's
  process; pidex can only run fewer of them.
- Retention or pruning of old session files. 25 MB of pi ledgers is not a
  problem, both ledgers are already deleted together, and a transcript is the
  only record of a conversation.
- The rest of perf-findings — the reducer and rendering findings (F1–F4, F11,
  F12) are a different hot path and a different plan.
