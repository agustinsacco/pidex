# Connectors looked signed-out when they were signed in

**2026-09-01.** Reported as "every restart I have to re-auth my connectors."
Nothing was being lost. The UI was misreading the adapter's status vocabulary
and telling people to sign in to servers whose tokens were valid the whole
time.

## What was actually true

Four credentials sat in the macOS Keychain under service
`pi-mcp-adapter.oauth`, accounts hashed as `sha256-…`, surviving every
restart. (`~/.pi/agent/mcp-oauth/` was empty — per the adapter README that
path is only a legacy plaintext import location, not the store.)

`mcp({ connect: "linear" })` opened a live connection with **no OAuth round
trip**, and the gateway header went from `67 tools (not connected, cached)` to
`67 tools`. Reads against Linear, Notion and Fellow all succeeded on the
restored tokens.

## The misreading

The adapter's snapshot (`mcp-status.ts`) distinguishes six states, and only
one of them is about credentials:

| state           | meaning                                               | about auth? |
| --------------- | ----------------------------------------------------- | ----------- |
| `connected`     | live connection open                                  | no          |
| `needs-auth`    | the server rejected the credential                    | **yes**     |
| `failed`        | in failure backoff                                    | no          |
| `cached`        | tool metadata on disk, nothing connected this session | **no**      |
| `not-connected` | no connection, no cache                               | **no**      |
| `disabled`      | switched off                                          | no          |

The row rendered `state === 'connected' ? 'Reconnect' : 'Sign in'`, so `cached`
and `not-connected` both offered a sign-in. The label made it worse: `cached`
read as "Idle (cached tools)", which sounds like degradation rather than the
adapter's ordinary lazy-connect resting state.

So the honest reading of the reported bug is: a signed-in, idle connector was
indistinguishable from an expired one, and the only affordance offered was the
destructive-looking one.

## Two changes

**Say the right thing.** `connectorAction(state, hasSession)` now picks the
offer: `needs-auth` gets **Sign in** (primary), a live connection gets
**Reconnect**, and everything else gets **Connect** — which opens a connection
without re-authorizing. With no session only the headless sign-in path can
run, so that is what an unknown state offers. `cached` is now labelled plainly
as "Idle".

**Then make it stay connected.** The adapter's per-server `lifecycle` defaults
to `lazy`: connect on first tool call, drop afterwards. That default is why an
authenticated server rests in `cached` at all. New connectors are now written
with `lifecycle: "lazy-keep-alive"`, and every row carries a **keep connected**
checkbox so servers added before this can be upgraded without hand-editing
`mcp.json`.

`eager` was considered and rejected: it connects at session start, which would
pay four connection round trips on every spawn for servers a session may never
touch.

## Verification

`connectorAction` is pure and covered directly, including the regression:
`cached` and `not-connected` must resolve to `connect`, never `sign-in`.

The e2e that asserts Datadog's written config caught the shape change on its
own — it deep-equals the whole object, so `lifecycle` could not be added
silently. That is the test doing its job; its assertion now names the new
contract and says why.

`typecheck / lint / format / unit` green, 1787 unit tests. All three Connectors
e2e specs pass.

## Unrelated, still open

`sidebar groups sessions from several workspaces` fails under
`--reporter=dot` and passes otherwise. Pre-existing on main, reproduced there
with none of this work applied.
