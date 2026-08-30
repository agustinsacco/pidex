# 2026-08-27 — A banner for the plan-limits warning, not just the popover

Follow-up to
[2026-08-22-context-and-account-visibility.md](2026-08-22-context-and-account-visibility.md).
That work got the `claude-rate-limit` payload onto the context meter's
popover — accurate, but opt-in: you only see it if you click in and check.
A user hitting the warning threshold had no reason to look, so the state that
matters most (you're about to get capped) was the easiest one to miss.

## What shipped

`composer/RateLimitBanner.tsx`, mounted in `ChatView.tsx` above the composer
next to `LaneBanner`. Same data as the popover (`composer/rateLimit.ts`), a
second consumer of it — no new status key, no new wire contract.

Gated by a new pure predicate, `needsAttention`: fires at the same ≥75%
warn threshold and hard-cap condition the popover already colors red/orange,
so the two surfaces read the same account state and can't disagree about
what counts as urgent. Everything under that line renders nothing, on
purpose — `LaneBanner`'s own history is the reason why: its first version was
a fixed block that couldn't be dismissed, and that turned out to be the wrong
trade twice over. An always-on bar for a number that's fine the overwhelming
majority of the time is exactly the alarm-fatigue failure ISA-101 warns
about, just for a different signal.

One correctness detail worth calling out: `resetsAt` gates staleness. The
provider only pushes a fresh event when something happens worth reporting, so
a warning read once can otherwise sit in `stores/extensionUi.ts` untouched
long after the window actually reset. `needsAttention` treats a past
`resetsAt` as "this reading no longer describes reality" and goes quiet,
rather than showing a stale cap warning for up to 5-7 days.

Dismiss is keyed to the exact reading (`windowType:status:percent`), not a
boolean — a later event that's worse than what was dismissed reopens the
banner instead of staying suppressed.

## Verified

`npm run typecheck`, `lint`, `prettier --check .`, and the full unit suite
(1332 tests, including new `needsAttention` cases against the same live
captures `rateLimit.test.ts` already asserted on) — all green. Not verified
against a live account actually crossing the threshold this session; the
existing captures plus the popover's already-proven parsing path are the
coverage today.

## Consequences for later work

`specs/reference/chat.md` and `specs/reference/extensions.md` now list two
consumers for `claude-rate-limit`; keep both in sync if a third one shows up.
No change to the underlying limitation from the Aug 22 log: this is still
account state relayed by the CLI's own warning threshold, not a live
always-on percentage — see that log for why polling Anthropic's rate-limit
headers directly was rejected.
