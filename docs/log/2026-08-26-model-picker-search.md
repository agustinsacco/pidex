# The model picker searches routes, not models

Date: 2026-08-26

## The problem

pi's catalogue is a list of **routes to** models, not a list of models. "Claude
Opus 5" can be five rows at once:

| provider         | id                           |
| ---------------- | ---------------------------- |
| `anthropic`      | `claude-opus-5`              |
| `pi-claude-cli`  | `claude-opus-5`              |
| `amazon-bedrock` | `anthropic.claude-opus-5`    |
| `amazon-bedrock` | `us.anthropic.claude-opus-5` |
| `amazon-bedrock` | `eu.anthropic.claude-opus-5` |

The old menu rendered all five as one line each — display name only, no
provider, no id — grouped under a provider header, filtered by a subsequence
matcher over `"${name} ${id} ${provider}"`. Three things were wrong with that:

1. **Term order leaked into the result.** A subsequence must appear in query
   order, so `opus bedrock` matched and `bedrock opus` did not. Users do not
   know the field order and should not have to.
2. **Separators were load-bearing.** `opus-5`, `opus 5` and `opus5` are the same
   intent and matched three different sets.
3. **The rows were indistinguishable.** Five identical strings, and the only
   way to reach a specific one was to already know how its id was spelled.

## What changed

### `src/lib/modelSearch.ts` — a lexical matcher

Terms AND together in any order. Separators are noise on both sides. Each term
is scored per field by how good the hit is — exact token (100), token prefix
(78), separator-insensitive prefix (66), token infix (52), squashed infix (44),
subsequence (≤20) — weighted name > id > provider, and the whole query is
scored against the name again so `opus 5` puts the Opus 5 family on top.

Two rules earn their keep:

- **Short terms must land on a boundary.** `us` inside `cla-ude-op[us]-5` is
  coincidence; without a 3-character floor on infix and subsequence hits,
  `id:us.` returned the entire Opus family instead of the one US profile.
- **Providers answer to aliases.** Nobody types `amazon-bedrock` (they type
  `aws`) or `pi-claude-cli` (they type `claude code`). Aliases are search-only:
  the UI always prints `model.provider` verbatim, so no alias can make the menu
  claim something untrue about what will serve the session.

Also: `provider:` / `id:` / `name:` qualifiers, `is:` flags
(`reasoning`, `available`, `unavailable`, `starred`, `recent`), `-negation`,
and `"quoted phrases"`. A colon inside an id (`amazon.nova-pro-v1:0`) is left
alone — only the known prefixes are treated as qualifiers.

### Family grouping

`familyKey()` strips the Bedrock region prefix, the vendor namespace, a release
date stamp and a build suffix, so every route above keys to `claudeopus5`. The
menu then asks "which Opus 5?" once, with the routes underneath, instead of
scattering five near-identical rows through a ranked list. Under a family
header a row leads with its **provider** plus whatever the name adds beyond the
family (`(US)`, `(EU)`) — the only things that differ. A family of one renders
as a plain name-led row; a header over a single row would double the height of
most of the list to restate the row's own name.

Provider grouping is still there behind a toggle, because it is the better read
of an unsearched catalogue. The choice persists (`AppPrefs.modelPicks`).

### Everything else on the row

Provider and id now render on every row, always. Two providers serving the same
display name is the normal case here, not an edge one. Where the catalogue
supplied it, the row also carries context window, `vision`, and input price.

Where it did **not** supply it, the row says nothing: `toCatalogueModels` omits
absent metadata rather than defaulting it, because the `models.json` fallback
(pi unavailable) knows an id, a name and a provider, and a `0` context window
or a `$0` price would read as fact.

### Stars, recents, provider chips

`AppPrefs.modelPicks` keys on `provider/id`, never the id alone — starring
"Opus 5 via Bedrock US" is a statement about the route. Star with the row
control or ⌘D on the highlight (deliberately not Enter-adjacent: starring must
never be one slip away from switching the model mid-turn). Starred and Recent
sections appear only while idle; during a search they would print the same
model twice for no gain.

Provider chips filter by clicking, for the same reason `provider:` exists in
the query language: one of them is discoverable and the other is fast.

## Sharp edges left behind

- **`MenuRow`'s `trailing` slot is a sibling, not a child.** The row is a
  `<button>`; a nested button is invalid HTML that browsers recover from by
  hoisting it out, breaking both controls. The star overlays the row's right
  edge and the row takes extra right padding.
- **`opacity-0` and `opacity-100` must never both be emitted.** Tailwind
  resolves a conflict by stylesheet order, not by the order of the class
  string, so which one wins would be an accident.
- **The old `ModelMenu` search test was passing vacuously.** It set
  `input.value` directly and dispatched `input`; React keeps a per-input value
  tracker and skips `onChange` when the tracked value already matches, so the
  list never filtered and the assertion held for the wrong reason. Tests here
  now go through the prototype's value setter.

## Coverage

- `src/lib/modelSearch.test.ts` — 44 cases over the matcher, family keys,
  grouping and highlighting, driven by the real five-route catalogue shape.
- `src/features/chat/composer/ModelMenu.test.tsx` — 28 cases; the Bedrock
  availability regressions from before are intact.
- `e2e/smoke.spec.ts` — the picker end to end against the pi stub, whose
  `get_available_models` now returns four routes to one model.
