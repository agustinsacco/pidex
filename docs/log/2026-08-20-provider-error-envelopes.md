# 2026-08-20 — Provider errors show the sentence, not the JSON

Reported from a live session. A turn failed and the transcript rendered:

```
Error — 400 {"type":"error","error":{"type":"invalid_request_error","message":
"Third-party apps now draw from your extra usage, not your plan limits. Add
more at claude.ai/settings/usage and keep going."},"request_id":"req_011Ce…"}
```

Providers hand pi back an HTTP status and a JSON envelope; pi forwards the
whole thing verbatim as `errorMessage`; `ErrorBlock` printed what it was given.
The one sentence that tells you what to do sat in the middle of it.

`features/chat/errorMessage.ts` unwraps the envelope. It slices from the first
`{` to the last `}` — neither end of the string is reliably the envelope, since
providers prefix a status and pi sometimes appends its own context — and walks
`message` / `error` / `detail` / `description` for a string, `message` first so
`{message, error:{message}}` yields the summary rather than the detail. Nothing
parses, or nothing in it is a sentence? The raw text renders exactly as before.
A guessed summary is worse than no summary, and `matchErrorRemedy` still runs
against the _raw_ string, because some patterns it keys on ("data retention
mode") live in fields the human sentence does not carry.

The payload is kept one click away rather than discarded. The type and request
id are precisely what a provider asks for when you report a failure, and they
exist nowhere else in the app — so the collapsed toggle carries them inline
(`HTTP 400 · invalid_request_error · req_011Ce…`) and expands to the raw body
with a copy button.

Added a remedy for the failure that prompted this: it is not an auth problem
and not retryable, so it offers claude.ai/settings/usage plus the model-switch
pointer — running the session on another provider is the thing that unblocks
you in the next thirty seconds.

Coverage: 9 tests on the parser (Anthropic and OpenAI envelope shapes, a
string-valued `error`, truncated JSON, JSON with no sentence, nesting
precedence) and 4 on the rendering, including that a plain-text error grows no
toggle.
