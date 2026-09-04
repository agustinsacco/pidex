# Connector rows read "Idle" next to "Connect", and people re-authorized

Settings → Connectors showed every lazily-connected server as `Idle` with a
`Connect` button, even with `keep connected` ticked. Four servers signed in and
working (braintrust, fellow, linear, notion — all verified live against their
APIs on 2026-09-04) looked unconfigured.

The state was right. The words were wrong. `cached` means the adapter holds the
server's tools from an authenticated connection it has since dropped, because
it connects per call. Nothing about the credential is missing.

Changed, in `src/features/connectors/mcpStatus.ts`:

- `cached` label: `Idle` → `Signed in · idle`.
- `connect` button: `Connect` → `Connect now`, so it reads as an action on a
  working server rather than setup.
- `keep connected` tooltip no longer claims the row reads Connected between
  calls. It stays idle until a tool is used in the session.

No behaviour change: the same `/mcp reconnect` and headless sign-in paths run.
See [mcp.md](../mcp.md) for the connector model.
