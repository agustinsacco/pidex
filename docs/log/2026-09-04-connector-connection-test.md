# A connector row can now prove it works

Settings → Connectors could not answer "is this connector up?". Per-server
state comes from the adapter running inside a session, so the row read
`state unknown` with nothing open, and `Signed in · idle` with a session — true,
and silent about whether the server answers right now.

Added a **Test** button per row. It runs the adapter's own
`/mcp reconnect <server>` in a throwaway `pi --mode rpc --no-session`
(`electron/pi/connector-check.ts`, IPC `mcp:checkServer`), the same machinery
the headless OAuth flow uses. Reconnect closes the connection, opens a fresh
one and reports the outcome as a notify, so the verdict is an observation, not
an inference:

| adapter line                                         | badge               |
| ---------------------------------------------------- | ------------------- |
| `MCP: Reconnected to linear (67 tools, 0 resources)` | `Up · 67 tools`     |
| `MCP: linear requires OAuth...`                      | `Needs sign-in`     |
| `MCP: Failed to reconnect to linear: ...`            | `Down` + the error  |
| `MCP: linear is disabled...`                         | `Disabled`          |
| `Server "linear" not found in config`                | `Not in config`     |
| anything else, refused, or a timeout                 | `Test inconclusive` |

The row prefers a fresh test over the status chip. `Test inconclusive` is
deliberate: an unparseable answer must never render as up or down, so
`parseReconnectNotice` in `shared/connectors.ts` is narrow and fails closed
(`shared/connectors.test.ts`).

Two constraints carried over from `connector-auth.ts`:

- **No tokens.** `/mcp reconnect` is an extension command, so pi runs it
  without an LLM call.
- **Never answer an extension input request.** A reconnect only notifies today,
  but answering a future prompt would win the race against the adapter's
  loopback callback and abort an OAuth flow that had already succeeded. The
  guard is a test (`electron/pi/connector-check.test.ts`).

E2E: the sign-in test now clicks Test and asserts the verdict; the stub answers
`/mcp reconnect` with the adapter's real notify shape.
