# 2026-08-26 — the orchestrator gets controls, modes, and a way out

Four changes to the orchestration feature, all driven by it being unusable in
practice: a thread that had bricked itself, with no way to inspect, reset or
retarget it.

## The thing that was actually broken

A live orchestrator thread on MiniMax M2 (Bedrock) failed every turn with:

```
Validation error: Value at 'messages.3.member.content.2.member.toolUse.name'
failed to satisfy constraint: Member must satisfy regular expression pattern:
[a-zA-Z0-9_-]+
```

The model had emitted a tool call whose **name** was raw tool-call syntax:

```
toolCall.name === 'mcp({})<tool_call>find'
```

pi handled it fine at the time — the call just failed with "Tool ... not
found" — and then wrote it to the session file. That is where the damage was
done. Every later turn replays the transcript, Bedrock validates tool names on
the way in, and the whole session is rejected. One bad name bricks a thread
permanently.

`/new` did not help: `ensure()` resumes the session path pinned in
`orchestratorSessions` prefs, and nothing could clear that pointer. The only
escape was deleting the session file by hand.

Two fixes, because prevention and recovery are different problems:

- **`pi-ext/tool-name-guard.ts`** (bundled into every session) rewrites the
  finalized assistant message at `message_end`, turning a malformed tool call
  into plain text before pi persists it. The model's intent stays visible in
  the transcript; the poison does not. Conservative on purpose: only names no
  provider would accept, never arguments, never a well-formed call.
- **`orchestrator:reset`** abandons the thread and starts clean — clearing the
  prefs pointer, the digest, and the sweep state. The old session file stays on
  disk; it is pi's record and worth reading. There is also
  `orchestrator:restart`, which stops the process but keeps the thread, for
  picking up spawn-time changes (edited rules, a different model).

## Modes replace the autopilot boolean

`autopilot: boolean` conflated two questions — may it message sessions? may it
start them? — and it was **baked into the system prompt at spawn**, so toggling
it did nothing to a running orchestrator. There was no restart to make it
take effect either.

Now one axis, `OrchestratorMode`:

| mode                  | reads fleet | messages / stops / unblocks | starts work                |
| --------------------- | ----------- | --------------------------- | -------------------------- |
| `observe`             | yes         | no                          | no                         |
| `supervise` (default) | yes         | yes                         | proposes only              |
| `autopilot`           | yes         | yes                         | yes, up to `maxConcurrent` |

**Enforced in `bridge.ts` at call time**, not in the prompt. `BridgeDeps.modeFor`
is a function rather than a value precisely so a switch binds on the very next
tool call — no respawn, and no window where the prompt and the rules disagree.
The preamble still states the posture (so the model does not waste turns
attempting refusals), and a sweep re-states the current mode, because the
preamble was fixed at spawn and mode can change mid-thread.

Old prefs migrate: `orchestratorModeOf()` maps a stored `autopilot: true` to
`autopilot` rather than silently downgrading someone to `supervise`.

The picker lives in the orchestrator's composer, next to the model picker —
the same kind of decision, made where you are talking to it — and in Settings.

## The sidebar

The orchestrator used to render as a row _inside_ the group's session list, and
only while the group was expanded: the one thread that manages work sat in the
same column as the threads that are work.

The workspace header now carries three **permanent** controls — options (`⋯`),
new session (`+`), orchestrator (`✳`). The first two existed but were
`opacity-0` until hover; a control you cannot see is a control you do not know
exists. `OrchestratorRow.tsx` is deleted.

Right-clicking the orchestrator opens what was missing entirely — it was the
only row in the sidebar with no context menu: open, brief, review,
orchestration settings, restart, reset.

## Unread

The badge counts **orchestrator turns you have not seen**, incremented on
`agent_end`/`agent_settled` when the thread is not the active session, cleared
on activation. Deliberately not the digest's attention count: that answers
"what needs you?", while a sidebar badge has to answer "has it said anything
since you looked?".

## Verification

`npm run typecheck`, `npm run lint`, `prettier --check` clean. Unit: 1071 pass
(22 new across mode capabilities/migration, bridge mode enforcement including
that it is read per call, and the tool-name guard). E2E: 29 pass, including the
fixed header controls and the composer mode picker (and that a _work_ session
does not offer one).

One pre-existing failure on `main` is untouched by this change:
`electron/fs/__tests__/git-worktrees.test.ts > renameBranch (real git)`.

Verified by hand in the browser harness: three workspace headers each render
one always-visible orchestrator control, the right-click menu opens with
Restart correctly disabled while nothing is live, and switching to Autopilot
updates the composer label and persists.
