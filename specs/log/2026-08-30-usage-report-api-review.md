# 2026-08-30 — Review: always-on Claude usage stats (Admin usage report API)

Claude Desktop shows account usage all the time — bars for how much of the
5-hour and weekly allowance is spent, per session and per week. pidex shows
the `claude-rate-limit` state only once the CLI's warning threshold has been
crossed, which is the moment the number is least useful for planning: you
want to see yourself approaching the wall, not the wall.

This is a review of what each available data source can honestly power, a
detailed read of the Admin API endpoint
([retrieve_claude_code](https://platform.claude.com/docs/en/api/admin/usage_report/retrieve_claude_code)),
and a concrete design for the two surfaces we want to feed: the context
meter's popover (next to the input) and the Claude Code tab in Settings.

## What the sources actually give us

### 1. The CLI's `rate_limit_event` — every turn, but percent-gated

Verified empirically against Claude Code 2.1.231 / provider 0.4.16, under
threshold, print mode:

```
{"type":"rate_limit_event","rate_limit_info":{
  "status":"allowed","resetsAt":1788115800,"rateLimitType":"five_hour",
  "overageStatus":"rejected","isUsingOverage":false}}
```

The event **does arrive every turn** — the "only after 90%" gating applies to
`utilization`, not to the event. Under the threshold the payload carries the
binding window's type and reset, but no fraction. The fraction lives in
response headers (`anthropic-ratelimit-unified-{claim}-utilization`,
`-reset`, `-surpassed-threshold`) that the CLI parses inside its own process
and only forwards once a warning step (`allowed_warning` →
`surpassedThreshold`) has tripped. pidex never sees those headers, and no
fork change can surface them before the CLI decides to.

So from this stream, always-on, we can know: which window binds (5h → 7d →
7d-overage → credits) and when it resets. We cannot know "42% used" until the
CLI starts warning.

### 2. The Claude Desktop bars themselves — an internal endpoint we cannot reach

The CLI's own `/usage` panel (what Claude Desktop's numbers mirror) fetches
`GET https://api.anthropic.com/api/oauth/usage` with the logged-in user's
OAuth token, auto-refreshed on 401. That is undocumented, first-party-only,
and the OAuth token belongs to the `claude` binary in the OS keychain —
pidex never holds it, by design (the account row in Settings says exactly
this: the credential is the CLI's, not pidex's).

**Rejected:** reading the token out of the keychain to poll this endpoint
ourselves. Undocumented wire, credential the user never gave us, and it
breaks the day Anthropic changes the shape. Not worth it when there is a
documented alternative below.

### 3. The Admin API — documented, always-on, but different data

`GET /v1/organizations/usage_report/claude_code` is the documented org
endpoint for Claude Code analytics. It does not give plan-limit utilization
(no percent-of-weekly-allowance anywhere in the public API — the Spend Limits
API is Enterprise-only and monthly-spend, not the 5h/7d windows), but it gives
everything else: daily tokens by model, estimated cost, session counts,
commits, PRs, LOC. Full detail below.

## The endpoint in detail

**Request** (all params required unless noted):

- `starting_at` — `YYYY-MM-DD` UTC date. Returns metrics for **that single
  day only**; a week is 7 requests (or one per day as needed).
- `limit` — records per page, default 20, max 1000.
- `page` — opaque cursor from the previous response's `next_page`.

Headers: `anthropic-version: 2023-06-01`, `x-api-key: $ANTHROPIC_ADMIN_KEY`
(an Admin API key, `sk-ant-admin01-…`, created by an org admin in the
Console; an OAuth bearer token with `org:admin` scope also works). Docs ask
integrations to set a `User-Agent: pidex/<version>`.

**Response** — one row per (actor, `is_remote`) for the day:

- `actor` — `user_actor` with `email_address`, or `api_actor` with
  `api_key_name`. Rows are per user, **not per session**.
- `model_breakdown[]` — per model: `tokens.{input, output, cache_read,
cache_creation}` and `estimated_cost` in **minor units** (cents when USD —
  `amount: 186` is $1.86, not $186; the naive parse is a 100× bug).
- `core_metrics` — `num_sessions`, `commits_by_claude_code`,
  `pull_requests_by_claude_code`, `lines_of_code.{added, removed}`.
- `tool_actions` — accepted/rejected per edit tool.
- `customer_type` (`api` | `subscription`), `subscription_type`
  (`team`/`enterprise`/null), `terminal_type`, `is_remote` (Claude Code on
  the web is a separate row), `organization_id`.
- Pagination: `has_more`, `next_page` (null at the end). Don't change params
  mid-sequence; cursors are bound to the issuing query.

**Operational facts:**

- Data is **~1 hour behind** — only activity older than an hour is included,
  for pagination stability. This is a trailing dashboard, not a live meter.
- The Admin API is **unavailable for individual accounts** (Pro/Max personal
  logins have no org and no admin key). This feature is necessarily
  org-gated; the UI must say so rather than show a permanently empty widget.
- Free to call; 7 requests per weekly refresh is negligible, but we should
  still cache (see below) and never poll on a timer tighter than the data's
  own freshness.

## Design

Three sources, three honest renderings — never let a bar imply a denominator
it doesn't have:

| Question                      | Source                            | Rendering                                                    |
| ----------------------------- | --------------------------------- | ------------------------------------------------------------ |
| How full is this session?     | pi `get_session_stats` (have)     | context % ring (have)                                        |
| Am I near the plan wall?      | `claude-rate-limit` status (have) | window + reset, % bar only when `utilization` present (have) |
| How much did I use this week? | Admin usage report (new)          | 7-day usage bars, tokens + est. cost                         |

### Main process — `electron/claude/usage-report.ts`

Pure aggregation module + thin fetcher (network in `electron/`, per repo law):

- `fetchUsageReport(key, emails, now)`: 7 parallel GETs for the trailing
  7 UTC days, `limit=1000`, follows `next_page` while `has_more`; maps 401/403
  to "key rejected or account has no organization", 429 to "back off".
- Aggregation sums rows matching the signed-in account's email
  (`packages:claudeStatus` already exposes `auth.email` — same account the
  Claude Code tab reports). If no email matches, return everything with
  `scope: 'organization'` so the dashboard says whose numbers they are.
- Cache in-memory: 15-minute TTL. The upstream data is 1h stale; anything
  faster is waste, anything slower hides a day boundary unnecessarily.
- Key storage: Electron `safeStorage` (OS-encrypted blob in electron-store,
  lazy-constructed as `electron/store.ts` requires), key never enters the
  renderer, never into the debug log.

**IPC** (`shared/ipc.ts`, handlers in `electron/ipc/claude-handlers.ts`,
mock case in `src/dev/mockPidex.ts`):

```ts
'claude:usageReport':   { args: []; result: ClaudeUsageReport }  // cached-or-fetch
'claude:setUsageKey':   { args: [key: string]; result: { ok: true } | { ok: false; error: string } }
'claude:clearUsageKey': { args: []; result: void }
```

`ClaudeUsageReport` in `shared/models.ts`: `fetchedAt`, `scope`, `days[]`
(per day: tokens, costUsd, sessions, commits, PRs, LOC ±, remote split),
`totals`, `models[]`. Costs stored in the model as **major units** (divide by
100 at the parse boundary; minor units never leave the fetcher).

### Surface 1 — the popover (ContextMeter, next to the input)

A new section under `PlanLimits`, rendered whenever a report is available
(i.e. the user configured a key):

- Seven thin day-bars (height = estimated cost; the number users actually
  budget by), today on the right, hover title with the day's detail.
- One summary row: `Σ 7 days · {tokens} · {cost} · {sessions} sessions`.
- A "manage in Settings → Claude Code" affordance — the popover stays a
  glance, the tab is the dashboard.
- `PlanLimits` itself gains nothing new from this work: it already shows the
  binding window and reset every turn, and a percent bar exactly when the
  CLI deigns to send one. What changes is that it is no longer the _only_
  always-on account signal — the weekly usage bars carry the "how much am I
  using" question the percent never answered.

Fetch lazily: the popover's first open invokes `claude:usageReport`; the
15-min TTL means most opens are instant. No timer, no polling — a hidden
popover fetching hourly data on a schedule would be pure noise in the debug
log.

### Surface 2 — Settings → Claude Code (the extension's own pane)

Extends `ClaudeProviderTab.tsx` with a "Usage" section:

- **Connection row**: Admin API key state — not set / saved / rejected —
  with the field to set or clear it, and a one-line pointer that the key is
  created in the Console by an org admin (Teams/Enterprise/API orgs only;
  individual Pro/Max accounts cannot use this).
- **Weekly dashboard**: the same 7-day bars, larger, plus per-model token and
  cost breakdown, and the core metrics that exist nowhere else (commits, PRs,
  LOC ±, sessions). This is the pidex equivalent of Claude Desktop's usage
  screen, minus the plan-percentile bars it gets from the internal endpoint.
- Caveat line, always: "daily UTC buckets, ~1 hour behind".
- The "When it fails" list gains the key failures: 401/403 (wrong key, no
  org, individual account), 429 (back off), and the empty state for a
  signed-in email with no rows (usage on a different account or Bedrock/Vertex
  deployments, which this API does not cover).

### Tests

- `electron/claude/usage-report.test.ts` against a captured fixture in
  `__fixtures__/` (a real response shape, both actor kinds, a remote row, two
  pages): minor-unit → dollar conversion, email scoping, pagination merge,
  missing-day handling (no row ≠ zero usage — leave the day out), and the
  error mappings.
- `shared/ipc.ts` compile-time drift guards cover the new channels; the mock
  case keeps `npm run dev:web` honest.

## What we are not doing, and why

- **No synthesized plan-percentage from the report.** There is no public
  denominator for the 5h/7d windows; Spend Limits is Enterprise monthly
  spend. A bar labelled "42% of weekly" built from tokens/limit would be an
  invented number, and inventing the one number users plan around is worse
  than omitting it.
- **No `/api/oauth/usage` polling** (Claude Desktop's real source): the
  token is the CLI's, the endpoint is undocumented.
- **No local transcript math** (`~/.claude/projects` JSONL, ccusage-style):
  viable as a future fallback for Pro/Max users without an org — it can
  reconstruct weekly token totals — but it estimates cost per model locally
  and misses remote sessions. Worth its own lane if org-less users want
  weekly bars; noted here so the option isn't rediscovered.
- **No fourth bar for a fourth window.** One event still carries one window
  (Aug 22 log); the Admin report doesn't change that.

## Sequencing

1. Main-process module + IPC + settings key row and dashboard (the data
   plumbing and the richer surface, valuable alone).
2. Popover mini-section (pure consumer of the cached report).

Both are small; neither touches the provider package or a status-key wire
contract, so nothing here waits on `@saccolabs/pi-claude-cli`.
