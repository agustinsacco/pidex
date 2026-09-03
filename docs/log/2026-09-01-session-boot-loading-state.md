# Session boot has a loading state now

**2026-09-01**

Starting a task showed nothing. The user's bubble landed, the composer went
back to its idle placeholder, the send button flipped back to an arrow, and
the sidebar row sat with a static "live" dot. Everything on screen said idle
while pi was spawning a provider CLI, resuming a session and waiting on a
first token — seconds of real work, rendered as a frozen app.

`WorkingIndicator` only starts at `agent_start`, so it covers none of that
window. Nothing else did either.

## What changed

- `ChatSessionState.promptSentAt` marks the window: set in
  `addUserMessage`, cleared by the reducer on `agent_start` / `agent_end` /
  `agent_settled`, on `setError`, and by `clearPromptSent` on abort (an abort
  before pi ever starts gets no agent event back, so nothing else would clear
  it).
- `BootingIndicator` renders in the same slot as `WorkingIndicator`, above the
  composer: a `PiSpark` plus a rotating phrase from `bootPhrases.ts`, seeded
  by session id so two lanes booting together do not chant in unison.
- The composer keeps its spinner and switches its placeholder to
  `Starting pi…` while booting.
- Sidebar rows (`SessionRow` and `PendingSessionRow`) treat booting as
  streaming for the indicator dot, so the row pulses instead of looking parked.

`useSessionBooting` is the one definition of "booting", shared by the chat and
the sidebar — the row and the transcript must never disagree about whether a
lane is doing something.

The phrases are rude to the machine, never to the user: every line blames pi,
the GPUs, the model or the bill. Keep it that way when adding more.
