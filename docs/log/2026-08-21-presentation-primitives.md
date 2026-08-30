# 2026-08-21 — Presentation primitives (cleanup plan, phase 5)

Phase 5 of [../CLEANUP_PLAN.md](../specs/backlog/cleanup-plan.md): the renderer's presentation
layer, where the same four shapes had been retyped once per feature. Nothing
here changes behaviour; the point is that the next component gets these for
free instead of copying a class string from whichever neighbour was closest.

## What is now shared

**`Button` and `TextInput` (`src/components/form.tsx`).** 37 hand-written
button class strings across 14 files, in three roles (primary / secondary /
danger) and — the actual problem — **nine different paddings** for the same
job. Padding is now a `size`, five steps, each carrying its own radius so a
size is self-contained:

| Size | Padding + type          | Radius | Used by                                      |
| ---- | ----------------------- | ------ | -------------------------------------------- |
| `xs` | `px-2 py-1 text-sm`     | md     | inline row actions (run-command, workspaces) |
| `sm` | `px-2.5 py-1 text-base` | md     | dense settings rows, popover actions         |
| `md` | `px-3 py-1.5 text-base` | md     | the default: modal footers, settings buttons |
| `lg` | `px-4 py-2 text-lg`     | md     | full-screen setup steps                      |
| `xl` | `px-5 py-2.5 text-lg`   | lg     | the workspace picker's hero CTA              |

Six one-off paddings were folded into a neighbouring step — `px-3.5 py-1.5`
into `md` and `px-2.5 py-1.5` into `md`, `px-3 py-1` and `px-2 py-1 text-base`
into `sm`. Every one of those moves is ≤2px and, in each case, makes a footer's
buttons match each other where they previously did not (the merge modal's
Cancel was `px-3` next to a `px-3.5` Commit). `danger` keeps `text-white`
rather than `text-accent-text`: the danger token is dark enough for white ink
in both themes, which is exactly what is _not_ true of the amber accent.

**`ModalPanel` (`src/components/Modal.tsx`).** `ModalOverlay` already owned the
portal, backdrop and depth-aware Escape, but not the panel — so six surfaces
repeated the width/border/shadow div plus a bordered header and a right-aligned
footer. Promoted from `MergeWorktreeModal`'s private `Shell`. It is
deliberately separate from the overlay: the extension dialog host runs its own
portal for arrow-key navigation and still wants the chrome.

**`useAsyncAction` (`src/components/useAsyncAction.ts`).** The
`busy`/`error` + try/catch/finally machine, six times over. One instance backs
several buttons that are sequential rather than concurrent — the merge modal's
commit and merge steps share a pair. Two details the call sites needed:
`setError` (not just `clearError`), because several actions get a
`{ok: false, reason}` result back instead of a rejection and it belongs in the
same slot; and an optional `onError`, because the branch picker also hands
thrown messages to its parent's banner. Failures set through `setError` do
_not_ fire `onError`, which is what the old code did.

**Eleven glyphs into `icons.tsx`.** The artifacts glyph was inlined three
times (sidebar nav, top bar, code block), the file glyph three, plus the bar
glyphs. `FileExplorer` had been inlining `d="m9 6 6 6-6 6"` next to an
`icons.tsx` `ChevronIcon` that renders exactly that. The sidebar's `ChevronDown`
is a genuinely different path (`m6 9 6 6 6-6`) and got its own component —
also deliberately un-animated, unlike `ChevronIcon`, so a static menu trigger
does not spin.

## Two duplicates that were really one component

`McpTab`'s `RawFileEditor` and `ConfigFileEditor` were the same editor with
different IPC pairs, so `ConfigFileEditor` now takes a `ConfigFileSource`
(`read` / `write` / fallback seed / optional toast) and `RawFileEditor` is
gone. `piConfigFile(name)` and `mcpConfigFile(scope, workspacePath)` are the
two sources.

This is the one place where the pixels move: editing an `mcp.json` used to be
an inline textarea under the config-files table and is now the same Monaco
modal Advanced already offered for `settings.json`. That is an upgrade (JSON
syntax checking, ⌘S, depth-aware Escape) rather than a like-for-like swap, and
it is what the plan asked for.

`JobOutput` also moved out of `ExtensionsTab` into
`src/features/settings/JobOutput.tsx`, beside the `usePackageJob` that feeds
it — `McpTab` had been importing a component from a sibling tab.

## Verification

`SKIP_E2E=1 npm run validate` (typecheck, lint, prettier, unit) green, plus
`npm run build`. `ModalPanel` and `useAsyncAction` carry their own unit tests.
The e2e suite is the real gate for the sidebar row indicator, which is the one
change with `data-testid` and `data-state` attributes asserted against it —
`SessionIndicator` emits the same four state values the two row types did.
