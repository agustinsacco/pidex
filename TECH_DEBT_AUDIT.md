# Tech Debt Audit — pidex

Scope: `src/` (73 files, 12,564 lines), `electron/` (24 files, 2,664), `shared/` (3 files, 809), `pi-ext/`.

## Baseline (verified before any changes)

| Check | Result |
| --- | --- |
| `npm test` | 70 passed / 9 files |
| `npm run typecheck` | clean |
| `npm run lint` | clean |

The codebase is in better shape than typical: **zero** `any`, `@ts-ignore`, `eslint-disable`,
`TODO`/`FIXME`, or commented-out code blocks. No orphaned files or unrendered components.
The debt here is **duplication and module size**, not rot.

---

## Findings

### A. Correctness bugs found during the audit

These change behavior when fixed, so they are called out separately from the pure refactors.

| # | Issue | Evidence |
| --- | --- | --- |
| A1 | **`formatTokens` has 3 divergent copies.** The `MessageItem` copy lacks the `M` tier, so a 1.5M-token compaction renders `1500000.0k` instead of `1.5M`. | `MessageItem.tsx:379`, `ContextMeter.tsx:91`, `WorkspaceHome.tsx:228` |
| A2 | **`ConfigFileEditor` has no Escape handler**, so Escape inside it propagates to the outer `SettingsModal` listener and closes the whole modal, discarding unsaved JSON. | `SettingsModal.tsx:612-683` vs `:43` |
| A3 | **`FilesChangedPane` reads only `result?.details`**, not `output?.details` like the other 4 call sites, so a still-streaming edit shows no patch. Bridged today by an `as never` cast. | `FilesChangedPane.tsx:58,63` |
| A4 | **Session watchers are never disposed on quit.** `unwatchAll` / `unwatchAllWorkspaces` are exported but never called; `before-quit` calls only `ptyManager.killAll()` + `registry.disposeAll()`. | `session-watcher.ts:41`, `workspace-watcher.ts:58`, `main.ts:62-69` |
| A5 | **~7 of 14 `piCommand` call sites silently swallow RPC errors** (no `else` branch on `!success`). | `SessionMenu.tsx:44-52`, `Sidebar.tsx:330-332`, others |

### B. Dead code (verified 0 references repo-wide)

- `shared/rpc.ts:461` `PiOutbound`, `:286` `RpcCommandType` — unused types.
- `electron/pi/shell-env.ts:87` `resetShellPathCache` — documented "test seam", no test imports it.
- `electron/pi/session-registry.ts:25-28` — `client.on('exit', () => {})` no-op subscription.
- `electron/pty/pty-manager.ts:12` — `PtyManager` class exported beside its own singleton; no second instantiation.
- **~22 `export` keywords that are dead** (symbol used only inside its own file): `reducer.ts:94,112`,
  `treeLayout.ts:9,12,38,45`, `fuzzy.ts:3,8`, `stores/sessions.ts:11,88`, `stores/artifacts.ts:5,7`,
  `highlighter.ts:25,27`, `Markdown.tsx:20`, `session-scanner.ts:23,27`, `rpc-client.ts:47`, and others.
- `agent-settings.ts:14` `agentDir()` and `session-scanner.ts:23` `piAgentDir()` are byte-identical duplicates.

`src/dev/mockPidex.ts` (493 lines) is **correctly gated** — `import.meta.env.DEV` + dynamic import means
Vite drops it and its 290 KB fixture from production bundles. Not debt. Leaving it alone.

### C. Duplication worth extracting

| # | Pattern | Sites | Proposed home |
| --- | --- | --- | --- |
| C1 | Inline SVG icons — 6 glyphs, 20 copies (branch ×4, close ×6, chevron ×3, spinner ×3, check ×2, file ×3) | 20 | `src/components/icons.tsx` |
| C2 | Modal scaffolding: portal + backdrop + `stopPropagation` + Escape effect | 8 | `src/components/Modal.tsx` (`ModalOverlay`, `useEscapeKey`) |
| C3 | Text-from-content extraction (`filter type==='text' → join`) | 5 | `shared/content.ts` `textFromContent()` |
| C4 | `formatTokens` / `formatDuration` | 4 | `src/lib/format.ts` |
| C5 | Path basename/dirname — 3 different idioms | 8 | `src/lib/path.ts` |
| C6 | `export_html` save-dialog flow | 3 | `src/features/sessions/sessionActions.ts` |
| C7 | Rename-session flow (`prompt` → RPC → `patchMeta`) | 3 | same file as C6 |
| C8 | `(tool.result?.details ?? tool.output?.details) as X` cast | 5 | `toolSummaries.ts` `toolDetails<T>()` |
| C9 | `piCommand` success/error boilerplate | ~14 | `src/lib/rpc.ts` |
| C10 | Duplicated types: file-health ×3, `about` payload ×3, `saveDialog` opts ×2, `PiResources` ×2 | 10 | `shared/models.ts` |
| C11 | Arrow-key list navigation with modulo wrap | 5 | `useListNavigation()` hook |
| C12 | `FuzzyFinder` ≈ `CommandPalette` (~90% identical) | 2 | `src/components/QuickPicker.tsx` |
| C13 | Button / IconButton / EmptyState / DiffStat Tailwind clones (4 separate `IconButton` copies) | 25+ | `src/components/` primitives |

### D. Oversized modules

| File | Lines | Responsibilities | Split |
| --- | --- | --- | --- |
| `SettingsModal.tsx` | 911 | store + shell + 6 tabs + nested Monaco modal + 8 form primitives | `settingsUiStore.ts`, `tabs/*.tsx`, `ConfigFileEditor.tsx`, `components/form/` |
| `reducer.ts` | 802 | types + reducer + delta applier + hydration | `chatItems.ts`, `messageContent.ts`, `assistantDelta.ts`, `hydrate.ts` |
| `Composer.tsx` | 483 | 6 concerns incl. duplicated rename/export | `useComposerState.ts`, `sendActions.ts`, `useImageAttachments.ts` |
| `TreeViewModal.tsx` | 438 | load + pan/zoom + mutations + 200 lines SVG | `usePanZoom.ts`, `treeActions.ts`, `TreeNode.tsx`, `TreeEdge.tsx` |
| `Sidebar.tsx` | 387 | layout + switcher + row + menu + actions + 4 icons + a stray re-export | `WorkspaceSwitcher.tsx`, `SessionRow.tsx`, `sessionActions.ts` |
| `ToolCard.tsx` | 382 | shell + 6 detail renderers + shared bits | `tools/details/*.tsx`, `detailShell.tsx` |
| `MessageItem.tsx` | 382 | 5 renderers + `groupBlocks` + `formatTokens` | `items/*.tsx`, `items/groupBlocks.ts` |
| `ArtifactsPane.tsx` | 374 | pane + viewer + preview + **4 parallel type-switch ladders** | `artifactKinds.ts` table + 3 components |
| `FilesChangedPane.tsx` | 331 | pure aggregation + rows + diff view | `collectTouchedFiles.ts`, `FileRow.tsx`, `FileDiffView.tsx` |
| `session-scanner.ts` | 329 | paths + JSONL parse + meta + aggregation + tree | `session-paths.ts`, `session-meta.ts`, `session-tree.ts` |
| `electron/ipc.ts` | 321 | one 243-line function, 45 handlers, 7 domains | `ipc/*-handlers.ts` per domain |
| `FileExplorer.tsx` | 319 | header + row + fs mutations + 5 icons | `ExplorerRow.tsx`, `fileActions.ts` |
| `ChatView.tsx` | 310 | root + header + git chips + 2 banners | `ChatHeader.tsx`, `GitChips.tsx`, `banners/` |

`shared/rpc.ts` (461) is a deliberate self-contained protocol mirror — **not** splitting it. But
`RpcResponseDataMap` (30 keys) must be hand-synced with the `RpcCommand` union with no compile-time
check; I'd add a type-level completeness assertion.

### E. Notable non-debt finding (security, needs your call)

`electron/ipc.ts:65` `piStubPath()` reads `process.env.PIDEX_PI_STUB` with **no `app.isPackaged` guard**,
and it gates four production branches: fakes a passing `pi:health`, swaps the pi binary for
`process.execPath` + an arbitrary script, replaces the shell env with `ELECTRON_RUN_AS_NODE=1`, and drops
the bundled extension. Only `e2e/smoke.spec.ts:36` sets it. On a shipped app, setting that env var runs an
attacker-chosen script as Node inside the Electron main process while reporting pi as healthy. Same shape
for `PIDEX_TEST_USER_DATA` and `PIDEX_E2E_WORKSPACE` (`main.ts:8-11`).

Fix is a one-line `!app.isPackaged &&` guard. This is a **behavior change**, so it is outside the
"no behavior change" remit — flagging for your decision rather than bundling it in.

---

## Proposed execution order

Each step: full `test` + `typecheck` + `lint` before and after. Any failure → revert, investigate, fix
before moving on. Commit per step so anything is individually revertable.

| Step | Work | Risk |
| --- | --- | --- |
| **1** | **Safety net.** Characterization tests for logic that has none and is about to move: `collectTouchedFiles`, `groupBlocks`, `toolSummaries`, `fuzzy`, `format`/`time`, `assistantDelta` text/thinking paths, base64 image chunking. Add `jsdom` + `environment: 'jsdom'` for `.test.tsx` so component tests are even possible. | none — additive |
| **2** | **Dead code removal** (§B): unused types/functions, no-op subscription, dead `export` keywords, dedupe `agentDir`. | low |
| **3** | **De-duplicate, pure extractions** (C1–C5, C8, C10): icons, `format.ts`, `path.ts`, `content.ts`, `toolDetails`, shared types. Mechanical, test-covered. | low |
| **4** | **De-duplicate, behavioral** (C2, C6, C7, C9, C11–C13): modal shell, session actions, `piCall`, `QuickPicker`, UI primitives. Fixes A2, A5. | medium |
| **5** | **Split oversized modules** (§D), largest first. Pure file moves + import updates. | medium |
| **6** | **Bug fixes** A1, A3, A4 + `RpcResponseDataMap` completeness assertion. | low |
| **7** | **Docs.** Update `README.md` dev table + `IMPLEMENTATION_PROMPT.md` if stale, JSDoc headers on every new module, prune comments describing moved code. | none |

## Questions before I start

1. **§E security guard** — fix it in this pass (one-line, but a behavior change), file it separately, or leave it?
2. **A1–A4 bug fixes** — the remit is "no behavior change". These are all cases where the current behavior is
   wrong. Fix them (my recommendation, they're small and I'd add tests), or leave them and just note them?
3. **Step 5 scope** — all 13 oversized modules, or the top 5 (`SettingsModal`, `reducer`, `ipc.ts`,
   `session-scanner`, `ArtifactsPane`) where the payoff is clearest?
4. **Component tests** — OK to add `jsdom` as a devDependency? Without it no `.tsx` can be tested at all,
   which limits the safety net for steps 4–5.
