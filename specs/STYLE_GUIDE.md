# pidex visual identity — "Phosphor"

> **Status: adopted 2026-08-07.** The icon and brand assets ship first (PR #4);
> the in-app token migration is planned in [RESTYLE_PLAN.md](RESTYLE_PLAN.md).
> Until that plan executes, `src/styles/index.css` still carries the v1
> (terracotta) values — this document is the target, not yet the code.

pidex started as a study of Claude Desktop and it shows: warm cream, terracotta,
soft radii. That was the right way to learn the shape of the product; it is the
wrong place to stay. **Phosphor** keeps what the study proved (a warm, paper-like
calm that makes long agent sessions comfortable), borrows Codex's discipline
(higher text contrast, deeper darks, monospace as a structural voice), and adds
the one thing that is ours: **amber phosphor** — the color of the amber CRT
terminals this product's whole category descends from. A coding agent's home is
a terminal; the brand color should come from one.

## The three inheritances

| From             | We keep                                                        | We drop                                |
| ---------------- | -------------------------------------------------------------- | -------------------------------------- |
| Claude Code      | warm paper light theme, soft surfaces, generous line-height    | terracotta accent, serif display voice |
| Codex            | near-black graphite dark theme, high-contrast ink, mono labels | pure monochrome coldness               |
| pidex (original) | amber-phosphor accent, prompt-bubble mark, `>_` motif          | —                                      |

## Logo

`build/icon.svg` — the **prompt bubble**: a chat bubble carrying a terminal
prompt (`>_`). Bubble in phosphor amber (`#f2ab4e → #e2922e` vertical), prompt
glyph and tile in graphite `#1f1c18`, tile radius 228/1024.

- **App icon:** always the full tile (graphite square + amber bubble).
- **In-app / monochrome:** the bubble path alone, single color `currentColor`,
  for empty states and the About screen. Never recolor the two-tone lockup.
- **Clear space:** half the bubble's height on all sides. Don't add text to the
  mark; "pidex" is set separately, lowercase, in the mono face.
- Regenerate platform assets with `node scripts/generate-icons.mjs`
  (Playwright-rendered; icns is darwin-only).

## Color

Tokens are the `--px-*` custom properties in `src/styles/index.css`, mapped to
Tailwind via `@theme inline`. Components never hardcode hex values — the five
satellite surfaces (xterm, Monaco, Mermaid, Chart.js, window background) each
carry a themed copy of these values and are enumerated in RESTYLE_PLAN.md.

### Light — "paper"

| Token                 | Value     | Notes                                   |
| --------------------- | --------- | --------------------------------------- |
| `--px-bg`             | `#f7f6f2` | bone paper — a step cooler than v1      |
| `--px-bg-secondary`   | `#eeece5` |                                         |
| `--px-surface`        | `#ffffff` | cards, editors, terminal                |
| `--px-surface-raised` | `#ffffff` |                                         |
| `--px-border`         | `#e2dfd6` |                                         |
| `--px-border-strong`  | `#cec9bc` |                                         |
| `--px-border-focus`   | `#d8d4c8` | composer focus: one step, not a jump    |
| `--px-text`           | `#2c2a25` | 13.3:1 on bg — Codex-grade ink          |
| `--px-text-secondary` | `#6b675d` | 5.2:1                                   |
| `--px-text-tertiary`  | `#9b968a` | meta/decorative only                    |
| `--px-accent`         | `#b35c0f` | **ember** — 4.4:1 on bg, 4.7:1 on white |
| `--px-accent-hover`   | `#9d500b` |                                         |
| `--px-accent-soft`    | `#f6e9d4` | selections, hover washes                |
| `--px-accent-text`    | `#ffffff` | 4.7:1 on accent                         |
| `--px-success`        | `#4c8a54` | live-session dots, diff adds            |
| `--px-warning`        | `#a8842e` |                                         |
| `--px-danger`         | `#bb4a3c` | 4.7:1 on bg                             |
| `--px-danger-soft`    | `#f8e8e4` |                                         |
| `--px-info`           | `#47708f` |                                         |
| `--px-user-bubble`    | `#efece2` |                                         |
| `--px-code-bg`        | `#f2f0e9` |                                         |
| `--px-scrollbar`      | `#cec9bc` |                                         |

### Dark — "phosphor"

| Token                 | Value     | Notes                                |
| --------------------- | --------- | ------------------------------------ |
| `--px-bg`             | `#1e1c18` | warm graphite — deeper than Claude's |
| `--px-bg-secondary`   | `#26231e` |                                      |
| `--px-surface`        | `#2a2721` |                                      |
| `--px-surface-raised` | `#322e27` |                                      |
| `--px-border`         | `#3a352c` |                                      |
| `--px-border-strong`  | `#4b453a` |                                      |
| `--px-border-focus`   | `#453f34` |                                      |
| `--px-text`           | `#ece7db` | 13.8:1 on bg                         |
| `--px-text-secondary` | `#aca496` | 6.9:1                                |
| `--px-text-tertiary`  | `#7c766a` |                                      |
| `--px-accent`         | `#eca03d` | **phosphor** — 7.8:1 on bg           |
| `--px-accent-hover`   | `#f2b158` |                                      |
| `--px-accent-soft`    | `#3d3220` |                                      |
| `--px-accent-text`    | `#241503` | ⚠ dark ink on amber — see below      |
| `--px-success`        | `#7fbe88` | 7.8:1                                |
| `--px-warning`        | `#d8ab52` |                                      |
| `--px-danger`         | `#dd7663` | 5.6:1                                |
| `--px-danger-soft`    | `#46302a` |                                      |
| `--px-info`           | `#82a9c9` |                                      |
| `--px-user-bubble`    | `#2f2b24` |                                      |
| `--px-code-bg`        | `#24211c` |                                      |
| `--px-scrollbar`      | `#4b453a` |                                      |

**The one behavioral flip:** amber is a _light_ color. White text on the dark
theme's accent fails contrast (2.2:1), so `--px-accent-text` is near-black ink
in dark mode (8.2:1). Anything that puts text on an accent background must use
the token pair, never `text-white` — this was already the rule; Phosphor is
where breaking it becomes visible.

### Terminal (xterm ANSI)

The terminal is the brand's home turf; in dark mode it sits on `--px-bg` itself
(not a raised surface), cursor in phosphor. Full 16-color ramps live in
`src/features/terminal/xtermTheme.ts`; keep them derived from the tables above
(red→danger, green→success, yellow→warning, blue→info, magenta/cyan warmed to
match). Light terminal stays on `#ffffff` with the ember cursor.

## Typography

- **UI:** `Inter` / system sans, unchanged. Body 14px/1.55.
- **Mono:** JetBrains Mono (user-configurable). Promoted from "code only" to
  the **structural voice**: section labels, workspace group headers, badges,
  stat-tile labels, and eyebrows set in mono, 10–11px, uppercase,
  `letter-spacing: 0.06–0.09em`, `--px-text-tertiary`. This is the Codex
  inheritance and the single biggest non-color differentiator from Claude.
- **Serif:** dropped from the brand voice. `--px-font-serif` stays defined for
  markdown content the _model_ authors, but no pidex chrome uses it.

## Shape, depth, motion

- Radii tokens unchanged: 6 / 10 / 14. The mark's tile uses 228/1024 (~22%).
- Depth comes from borders and one-step background shifts, never drop shadows
  heavier than `0 1px 2px rgb(0 0 0 / 0.06)` (light) — popovers excepted.
- Motion stays as shipped (message-in 180ms, expand-in 140ms, spark, shimmer)
  — all token-driven, all gated on `prefers-reduced-motion`. The streaming
  cursor `▍` and the working spark inherit phosphor automatically.

## Voice

Lowercase "pidex" always — including sentence starts. Labels are verbs or
nouns, never sentences ("Export HTML…", not "Click here to export"). The
prompt `>_` motif may appear in empty states and onboarding copy; don't
scatter it as decoration.

## Don't

- Don't reintroduce terracotta (`#c96442` / `#d97757`) anywhere.
- Don't use the accent for large fills; it's for interaction, focus, and the
  working-state glow. Backgrounds stay neutral.
- Don't put white text on amber (dark mode) or amber text on paper below
  14px bold (light mode) — use the token pairs.
- Don't mix the v1 and Phosphor palettes in one surface; migrate per-surface
  atomically (see RESTYLE_PLAN.md order).
