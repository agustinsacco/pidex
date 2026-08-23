# Every rename menu was broken: `window.prompt` is a throw in Electron

2026-08-23

## What happened

Rename from the sidebar's left-menu context menu did nothing. Neither did
rename from the session kebab menu, the composer command, file-explorer
create/rename, tree-view labels, or the compaction-instructions prompt. Every
one of those flows funnels through `window.prompt`, and Electron does not
implement `window.prompt`: its renderer setup overrides the global to
`synchronously throw` Error: prompt() is not supported.`
(electron/lib/renderer/window-setup.ts). The call sites were all written and
exercised in the browser dev harness (`npm run dev:web`), where prompt is a
real dialog, so nothing surfaced the gap until the flows were used in the
actual app.

The failures were silent in a particularly nasty way: the throws happened
inside fire-and-forget `void action()` menu handlers, so there wasn't even a
visible error — the menu closed and that was that.

## The fix

An app-owned imperative prompt, shaped like the extension dialog queue:

- `src/stores/prompt.ts` — a FIFO zustand queue plus `promptText(options)`
  (resolves the text, or `undefined` on cancel — the shape native prompt's
  `null` had at every call site) and `presentText(options)` for the
  clipboard-denied fallback that only needs to _show_ selectable text.
  `allowEmpty` preserves the native ''-submit semantics where they were
  load-bearing (blank compaction instructions, clearing a tree label).
- `src/components/PromptHost.tsx` — renders the queue head with the standard
  `ModalOverlay` + `ModalPanel` chrome, mounted once in `App.tsx` next to the
  extension dialog host. Works from context-menu actions, which live outside
  the React tree, exactly like the toast host.

All five `window.prompt` call sites moved over: session rename (shared by the
sidebar, kebab menu and composer command), file create/rename, compaction
instructions, tree labels, and the debug-info copy fallback.

## Keeping it dead

Two guards, because this failure mode is invisible until someone clicks the
menu in the packaged app:

- ESLint `no-restricted-syntax` in `src/` rejects
  `MemberExpression[object.name='window'][property.name='prompt']` with a
  message pointing at `promptText`.
- A note in CLAUDE.md's conventions next to the modal rules.

Unit tests cover the queue semantics (submit, cancel, FIFO, display kind).
Full `npm run validate` is green, e2e included.
