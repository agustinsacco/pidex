# Phosphor restyle — implementation plan

Migrates the app from the v1 terracotta theme to the **Phosphor** system
defined in [STYLE_GUIDE.md](STYLE_GUIDE.md). The guide is the source of truth
for every value; this plan is the execution order.

The good news mirrors the multi-workspace plan: the theming architecture is
already centralized. Every Tailwind color utility resolves through
`@theme inline` → `--px-*` in `src/styles/index.css`, so **phase 1 restyles
~95% of the app by editing one file**. The remaining phases chase the five
satellite surfaces that carry their own themed copies, then the brand-voice
(mono labels) pass.

## Inventory of themed surfaces

| Surface              | File                                       | Mechanism                                   |
| -------------------- | ------------------------------------------ | ------------------------------------------- |
| All Tailwind UI      | `src/styles/index.css`                     | `--px-*` tokens, light `:root` + `.dark`    |
| Terminal             | `src/features/terminal/xtermTheme.ts`      | two hardcoded `ITheme` objects              |
| Editor + diffs       | `src/lib/monaco.ts`                        | `pidex-light` / `pidex-dark` `defineTheme`  |
| Mermaid diagrams     | `src/components/markdown/MermaidBlock.tsx` | built-in `neutral` / `dark` themes          |
| Chart.js charts      | `src/components/markdown/ChartBlock.tsx`   | two hardcoded text/grid hexes               |
| Shiki highlighting   | `src/components/markdown/highlighter.ts`   | `vitesse-light` / `vitesse-dark`            |
| Window flash color   | `electron/main.ts` `backgroundColor`       | one hardcoded hex (pre-paint flash)         |
| Terminal surface CSS | `src/styles/index.css` `.terminal-surface` | hardcoded pair, must match xterm background |

## Phase 1 — Token swap (the bulk)

Replace every value in `:root` and `.dark` in `src/styles/index.css` with the
STYLE_GUIDE tables. No selector changes, no component changes.

- ⚠ `--px-accent-text` flips to dark ink in dark mode. Grep first:
  `grep -rn "text-white" src/` — any hit sitting on an `bg-accent` background
  must become `text-accent-text`. (Known correct today; verify it stayed true.)
- `.terminal-surface` dark value moves with `--px-bg` (`#262624` → `#1e1c18`);
  light stays `#ffffff`.
- `electron/main.ts` `backgroundColor: '#faf9f5'` → `#f7f6f2`. It's the
  pre-paint flash; if it lags the body background, resize flashes the old
  cream. (A follow-up could set it per-theme at window creation from prefs —
  out of scope here.)

Files: `src/styles/index.css`, `electron/main.ts`.

## Phase 2 — Terminal + editor

- `xtermTheme.ts`: replace both ramps with the guide's ANSI section. Dark
  background becomes `--px-bg`'s value `#1e1c18` (terminal sits on the page,
  not on a card — deliberate brand choice), cursor `#eca03d` / `#b35c0f`.
- `monaco.ts`: swap the editor/diff colors per the token tables
  (`editorCursor.foreground` = accent, diff add/remove from success/danger
  with the existing alpha suffixes).
- Keep the values as hex literals with a header comment pointing at
  STYLE_GUIDE.md — both libraries take JS objects, not CSS vars, and reading
  computed styles at theme-switch time is what the current architecture
  already avoids (theme objects are re-applied on switch by `settings.ts`).

Files: `src/features/terminal/xtermTheme.ts`, `src/lib/monaco.ts`.

## Phase 3 — Markdown satellites

- `ChartBlock.tsx`: text `#aca496`/`#6b675d`, grid `#3a352c`/`#e2dfd6`.
- `MermaidBlock.tsx`: move off built-in `neutral`/`dark` to
  `theme: 'base'` + `themeVariables` (primary = accent-soft, lines = border,
  text = text) so diagrams stop looking like a third design system.
- Shiki: `vitesse-light`/`vitesse-dark` are close to Phosphor's temperature
  already; keep initially. If code blocks clash after phases 1–2, revisit
  with a custom theme JSON derived from the ANSI ramp (separate follow-up —
  a hand-rolled Shiki theme is a day of tuning, not a token swap).

Files: `src/components/markdown/ChartBlock.tsx`,
`src/components/markdown/MermaidBlock.tsx`.

## Phase 4 — Mono structural voice

The non-color half of the differentiation (STYLE_GUIDE §Typography): section
labels, sidebar group headers, badges, stat-tile labels, and eyebrows move to
`font-mono uppercase tracking-wider` at their current sizes. Known sites:

- `Sidebar.tsx` — `SectionLabel`, workspace group header button
- `WorkspaceHome.tsx` — `StatTile` label, section headings
- `ArtifactsPane` gallery chips, `FilesChangedPane` header, settings tab
  labels, `SessionMenu` group headers

This phase is class-string edits only. Do it by eye against the style-guide
artifact, one feature at a time; it's also the natural moment to catch any
leftover terracotta-era one-offs.

## Phase 5 — Verification

- `npm run typecheck && npm run lint && npm test` (no behavioral surface, but
  the suite is 1s — always).
- `npm run test:e2e` — the settings spec exercises theme switching; the smoke
  spec walks every pane.
- Manual sweep with the `/run` skill in **both themes**: chat with tool cards
  - diff, terminal (ANSI test: `ls -la --color`, exit-code badge), Monaco
    editor + diff view, mermaid/chart/katex blocks, artifacts pane, settings,
    command palette, extension-UI toasts/dialogs.
- Contrast spot-check is pre-verified in the guide's tables (ratios computed
  at design time); re-run the pairs if any value drifts during review.
- Regenerate `specs/screenshots/` afterwards — every reference PNG shows the
  terracotta theme and will otherwise mislead the next agent.

## Risks

1. **Accent-text flip** (dark mode) — the only token whose _relationship_ to
   its pair changes. Mitigation: the phase-1 grep, plus the e2e settings spec
   renders buttons in both themes.
2. **Terracotta stragglers** — hex literals outside the inventory. Mitigation:
   `grep -rn "c96442\|d97757\|b5583a\|e08a6d\|f6e8e2\|453832" src/ electron/`
   must return zero after phase 2.
3. **Exported HTML** — none: export is pi's own `export_html` RPC
   (`sessionActions.ts:27`); pidex ships no HTML template of its own.
4. **Icon/theme drift** — the icon amber (`#eca03d` family) and the dark
   accent are the same hue by design; if either changes, change both and
   rerun `scripts/generate-icons.mjs`.

## Order

| Phase | Scope                      | Risk    | Ship gate                        |
| ----- | -------------------------- | ------- | -------------------------------- |
| 1     | token swap + window bg     | low     | both-themes manual sweep         |
| 2     | xterm + monaco             | low     | terminal ANSI + diff eyeball     |
| 3     | chart + mermaid            | low     | markdown fixture session         |
| 4     | mono voice pass            | trivial | style-guide artifact comparison  |
| 5     | verification + screenshots | —       | e2e green, screenshots refreshed |

Phases 1–3 are one sitting and should land as **one PR** (a half-migrated
palette is the worst state — see STYLE_GUIDE "Don't"). Phase 4 can trail.

---

## Outcome (2026-08-07)

Phases 1–4 shipped together (same sitting, one PR) plus phase 5's automated
gates. Deviations and notes:

- Phase 1 added a token the plan didn't list: `--px-terminal-bg` (white /
  `--px-bg`), because `.terminal-surface` and xterm's viewport CSS had to
  agree with the JS theme objects — one variable now owns that contract.
- Phase 4 went slightly wider than the listed sites: all 18
  `uppercase tracking-*` label sites got the mono voice via one sweep, the
  four `font-serif` chrome sites (home greeting, picker, pi-missing screen,
  chat empty state) moved to sans per the guide, and the home activity
  heatmap moved from `--px-info` to `--px-accent` (a heat map should glow
  phosphor, not blue).
- Verified: exit-criteria grep clean (zero v1 hexes outside `__fixtures__`),
  typecheck/lint/prettier/348 unit tests/8 e2e green, and a manual
  both-themes sweep in the browser harness (picker, home, chat with tool
  cards + diff counts, terminal with phosphor cursor, dark accent-text flip
  confirmed on the pane toggle).
- Still open: `specs/screenshots/` regeneration (needs a real-app capture
  session), and the Shiki revisit if vitesse clashes in daily use.
