# 2026-08-28 — A new session showed a raw model id, then an empty picker

Two symptoms, three causes, all in the same place.

## The raw id

`HomeModelPicker` rendered `current?.name ?? modelId`. `modelId` comes from
`pi:agentSettings`, a file read. `current` needs `pi:catalogueModels`, which
spawns a whole `pi --mode rpc --no-session` process. The first resolves in
milliseconds and the second in hundreds of milliseconds to seconds, so the
gap between them rendered `us.anthropic.claude-...` as if it were a name.

The same expression also hid a second, permanent case: when the configured
`defaultProvider`/`defaultModel` pair is not in the catalogue at all, the id
stays forever, indistinguishable from "still loading".

Both are now `modelChipLabel`, which is explicit about which of the three
states it is in and never renders a bare id as a name. An unavailable
configured model is labelled as such rather than disguised.

## The empty picker

`ModelMenu` had no `loading` prop, so `models.length === 0` meant "none
configured" — and an in-flight fetch rendered the definitive copy
_"No models configured — sign in via the terminal"_ as an answer to a question
it had not asked yet. Both pickers now pass `loading`, and the session picker
gets `modelsLoaded` on the chat store for the same reason (an empty
`models: []` before `bootstrapSession` answers is not an empty catalogue).

The empty text itself now names the signed-in providers, from
`pi:subscriptionAuth`, instead of guessing at the cause.

## Nothing was cached

`pi:catalogueModels` spawned pi on every invoke, and `checkPiHealth()` ran
`pi --version` uncached on the way there — two processes per picker open. Each
renderer caller kept its own `useState`, so the home screen paid again on
every mount.

- `createTtlCache` (`electron/pi/ttl-cache.ts`): one value, a TTL, in-flight
  dedupe, and **failures are not cached** — a picker opened while pi was still
  installing must be able to succeed on the next try. `cachedPiHealth` uses
  the same cache by rejecting on `!ok`.
- Invalidated on `pi:patchAgentSettings` and on a completed sign-in.
- One shared `src/stores/modelCatalogue.ts`, hydrated from `App.tsx` at boot,
  so by the time a picker opens the list is usually already there. The
  preload spawns pi with `--no-session` and spends no tokens.

One bug found while testing the store: clearing the in-flight slot inside the
promise body meant a **synchronous** throw ran the whole body before the
assignment landed, parking a settled promise in the slot forever and wedging
every later refresh. It is cleared on a microtask, guarded by identity.

Tests: `src/stores/modelCatalogue.test.ts`, `electron/pi/ttl-cache.test.ts`.
