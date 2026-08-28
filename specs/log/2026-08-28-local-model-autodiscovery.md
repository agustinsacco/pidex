# 2026-08-28 — a local GGUF server's models come from the server, not from models.json

The ask was about pidex: _"my local start model is hardcoded, I want it to
autodiscover the models available."_ It wasn't pidex's list. It was one
hand-written entry in `~/.pi/agent/models.json`:

```jsonc
"local-stark": { "baseUrl": "http://stark:8086/v1", "api": "openai-completions",
  "models": [{ "id": "Qwen 3.5 122b", "contextWindow": 128000, "maxTokens": 16384 }] }
```

Both pickers already autodiscover whatever pi reports — the home screen asks a
throwaway `pi --mode rpc --no-session` for `get_available_models`
([model-catalogue.ts](../../electron/pi/model-catalogue.ts)), the composer asks
a live session. So nothing in the renderer had a list to remove; the list had
to grow upstream of pi, and pi has no `discover` key in its `models.json`
provider schema.

## pi already ships the discovery — as a built-in llama.cpp provider

`dist/extensions/index.js` loads `llama.cpp` unconditionally
(`builtInExtensions`, `hidden`), and its `refreshModels` reads the server's own
`/models` catalog: only entries with `status.value === "loaded"`, with the
context window taken from `meta.n_ctx`. The server URL resolves from
`LLAMA_BASE_URL` (or from the `auth.json` entry `/login llama.cpp` writes).

Verified against a router-shaped `/models` on localhost, over the exact call
the home picker makes:

```
llama.cpp  qwen3.5-122b-a10b-q4_k_xl.gguf   contextWindow: 262144   ← meta.n_ctx
```

Two consequences worth knowing before switching a server over:

- **Router mode is required.** A server started with `-m` (single-model)
  returns `/models` entries with `status: null`, and pi's client rejects the
  whole catalog: _"Server is not running in llama.cpp router mode"_. stark was
  exactly this — `/health` fine, `/models` populated, no `status` field. Start
  `llama-server` with `--models-dir` and no `-m` (see pi's
  `docs/llama-cpp.md`); `/llama` then loads and unloads GGUFs, and can download
  from Hugging Face.
- **Only loaded models are listed**, and the catalog is cached in
  `models-store.json`. A warm boot answers `get_available_models` with them
  immediately; the very first boot after pointing pi at a new router can answer
  before the refresh lands, so the first picker open may not show them. The
  next open does — pi answers from the cache at t=0 once it exists.

## Deleting the entry is not a safe intermediate state

"What if we just remove the hardcoded model?" Tested all three shapes — `"models": []`, no
`models` key, whole provider block deleted — and pi reports **zero** local models for each: a
plain `openai-completions` custom provider prints exactly what it was declared, it never asks
the server. Removal is only safe once the discovered provider already exists, for a nastier
reason than an empty list: `settings.json` still named `local-stark` / `"Qwen 3.5 122b"`, and pi
does not complain about a missing default — it silently resolves another provider. Measured here:
`get_state.model` came back `amazon-bedrock / us.anthropic.claude-opus-4-6-v1` and then
`agent_start`. A prompt intended for the LAN would have billed Opus, and pidex's composer shows
only an unselected picker in that state.

## What pidex was missing: one prefix

`LLAMA_BASE_URL` never reached a pi session launched from the GUI, so the
built-in provider could never resolve a server there — packaged pidex had no
local models even with a correct router running. `FORWARDED_ENV_PREFIXES` in
[shell-env.ts](../../electron/pi/shell-env.ts) imports provider config the
login shell exported but a launchd-started app did not inherit; `LLAMA_` joins
it. Unlike the rest of that list it is a capability, not a credential: what it
buys is the model list, not an auth header.

Not in scope, and worth a look if local servers become a common setup: a
router-URL field in Settings → Providers (so the config is pidex-owned rather
than shell-profile-owned), and refreshing the home catalogue when its provider
list is missing a configured router.
