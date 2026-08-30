# pidex visual identity — "Phosphor"

> **Status: implemented 2026-08-07, light palette re-based 2026-08-10,
> reconciled with the code 2026-08-29. This file is the authority on pidex's
> visual identity** — where any other spec disagrees, this one wins.
> `src/styles/index.css` carries these values; the five satellite copies below
> mirror them.

pidex started as a study of Claude Desktop and it shows: warm cream, terracotta,
soft radii. That was the right way to learn the shape of the product; it is the
wrong place to stay. **Phosphor** keeps what the study proved (soft surfaces and
generous line-height that make long agent sessions comfortable), borrows Codex's
discipline (higher text contrast, deeper darks, monospace as a structural
voice), and adds the one thing that is ours: **amber phosphor** — the color of
the amber CRT terminals this product's whole category descends from. A coding
agent's home is a terminal; the brand color should come from one.

**The two themes are not mirror images, and that is deliberate.** Dark is warm
all the way down: warm graphite neutrals under a phosphor accent. Light is
**cool neutral grey** under an ember accent — the amber is the only warm thing
on the page. The warm cream light theme shipped for three days in August 2026
and was re-based to neutral greys on 2026-08-10 (`11a5d7c`); neutral light held
because warm-on-warm made the ember accent read as part of the background
instead of as an interaction. Don't "restore" the cream without changing the
accent too — the two decisions are one decision.

## The three inheritances

| From             | We keep                                                        | We drop                                             |
| ---------------- | -------------------------------------------------------------- | --------------------------------------------------- |
| Claude Code      | soft surfaces, generous line-height, paper-calm light theme    | terracotta accent, warm cream neutrals, serif voice |
| Codex            | near-black graphite dark theme, high-contrast ink, mono labels | pure monochrome coldness (dark stays warm)          |
| pidex (original) | amber-phosphor accent, prompt-bubble mark, `>_` motif          | —                                                   |

## Logo

`build/icon.svg` — the **aperture**: a ring of six discrete segments around a
phosphor core. One orchestrator, many agents holding position. It replaced the
prompt bubble on 2026-08-29, which was a chat bubble carrying a `>_` — two
stock devtool motifs stacked, saying "you can talk to this" about a product
whose actual claim is that many agents run at once. See
[2026-08-29-aperture-mark.md](../log/2026-08-29-aperture-mark.md).

Core and ring in phosphor amber (`#f2ab4e → #e2922e` vertical), tile in
graphite `#1f1c18`, tile radius 228/1024.

- **App icon:** always the full tile (graphite square + amber aperture).
- **Light backgrounds:** `build/icon-light.svg` — same geometry, ember
  (`#b35c0f → #9d500b`) on paper `#f7f7f8`. Documentation only; the platform
  icon is always the dark tile, and `generate-icons.mjs` reads only
  `icon.svg`. The README swaps the two on `prefers-color-scheme`.
- **In-app / monochrome:** ring plus core in a single `currentColor`, drop the
  bloom. Never recolor the two-tone lockup. **Not built yet** — the previous
  mark specified an in-app variant from 2026-08-07 and nothing in `src/` ever
  drew one; don't let this line repeat that.
- **Clear space:** half the ring's diameter on all sides. Don't add text to the
  mark; "pidex" is set separately, lowercase, in the mono face.
- Regenerate platform assets with `node scripts/generate-icons.mjs`
  (Playwright-rendered; icns is darwin-only). `icon-light.svg` is hand-kept —
  edit both or neither.

**Two numbers are load-bearing.** The dash pattern divides the circumference
exactly six times (`2π × 258 = 1621.0618 = 6 × (144.17697 + 126)`); any other
pair leaves a visible seam where the ring closes. And the bloom must stay a
`radialGradient` — stacked translucent circles rasterize into two hard-edged
discs, which reads as a bullseye rather than a glow. Both mistakes were made
and fixed on the way in.

The mark keeps its own graphite `#1f1c18`, which is not `--px-bg` in either
theme. It is a fixed brand asset, not a themed surface; don't token-ize it.

## Color

Tokens are the `--px-*` custom properties in `src/styles/index.css`, mapped to
Tailwind via `@theme inline`. Components never hardcode hex values — as of
2026-08-29 there is not one six-digit hex literal in any `.tsx` outside the two
satellites listed below, and it should stay that way. Five satellite surfaces
are the exception, because each takes a theme object rather than CSS — they
carry a mirrored copy of these values and must be updated together:

| Surface       | Themed copy in                                  |
| ------------- | ----------------------------------------------- |
| xterm         | `src/features/terminal/xtermTheme.ts`           |
| Monaco        | `src/lib/monaco.ts`                             |
| Mermaid       | `src/components/markdown/MermaidBlock.tsx`      |
| Chart.js      | `src/components/markdown/ChartBlock.tsx`        |
| Window chrome | `electron/window-chrome.ts`, `electron/main.ts` |

**"Must be updated together" is not advice.** Four of the five missed the
2026-08-10 light re-base and sat on the old warm neutrals for 19 days, so the
terminal, editor, diagrams and charts rendered warm inside a cool-grey app in
light mode. They were reconciled 2026-08-29. Nothing compiles-time-checks this;
changing a neutral means grepping the old hex across all five.

Window chrome is the copy set **before any CSS loads**, so it can only be a
literal: `main.ts` pins `backgroundColor` to the dark `--px-bg` (`#1e1c18`) and
`window-chrome.ts` carries the titlebar-overlay pair (`#1e1c18` dark,
`#f7f7f8` light). Both now equal `--px-bg` exactly in their theme. An earlier
version of this file flagged the light pair as a possible drift; it is not —
the two agree, and that agreement is the contract.

### Light — "slate paper"

Cool neutral greys. The accent is the only warm element on the page.

| Token                 | Value                 | Notes                                   |
| --------------------- | --------------------- | --------------------------------------- |
| `--px-bg`             | `#f7f7f8`             | paper — neutral, matches window chrome  |
| `--px-bg-secondary`   | `#efeff1`             |                                         |
| `--px-sidebar`        | `#ededef`             | sidebar sits below the page, not above  |
| `--px-sidebar-hover`  | `#e6e6ea`             |                                         |
| `--px-sidebar-active` | `#dedee3`             |                                         |
| `--px-surface`        | `#ffffff`             | cards, editors, terminal                |
| `--px-surface-raised` | `#ffffff`             |                                         |
| `--px-chip`           | `rgb(38 38 42 / .09)` | alpha on purpose — rides any surface    |
| `--px-border`         | `#e4e4e7`             |                                         |
| `--px-border-strong`  | `#c9c9ce`             |                                         |
| `--px-border-focus`   | `#d6d6db`             | composer focus: one step, not a jump    |
| `--px-text`           | `#26262a`             | 14.1:1 on bg — Codex-grade ink          |
| `--px-text-secondary` | `#66666e`             | 5.3:1                                   |
| `--px-text-tertiary`  | `#96969e`             | meta/decorative only                    |
| `--px-accent`         | `#b35c0f`             | **ember** — 4.4:1 on bg, 4.7:1 on white |
| `--px-accent-hover`   | `#9d500b`             |                                         |
| `--px-accent-soft`    | `#f6e9d4`             | selections, hover washes — stays warm   |
| `--px-accent-text`    | `#ffffff`             | 4.7:1 on accent                         |
| `--px-success`        | `#4c8a54`             | live-session dots, diff adds            |
| `--px-warning`        | `#a8842e`             |                                         |
| `--px-danger`         | `#bb4a3c`             | 4.7:1 on bg                             |
| `--px-danger-soft`    | `#f8e8e4`             |                                         |
| `--px-merged`         | `#7c5cbf`             | merged PRs — deliberately not success   |
| `--px-merged-soft`    | `#efe9fa`             |                                         |
| `--px-info`           | `#47708f`             |                                         |
| `--px-user-bubble`    | `#eeeef1`             |                                         |
| `--px-code-bg`        | `#f2f2f4`             |                                         |
| `--px-terminal-bg`    | `#ffffff`             |                                         |
| `--px-scrollbar`      | `#c9c9ce`             |                                         |

The semantic ramp (accent, success, warning, danger, info) and `--px-accent-soft`
are the survivors of the original warm palette and were **not** re-based. That
split is the design: neutrals cool, meaning warm.

`--px-merged` is the one hue outside the warm story, and on purpose. "Merged"
and "open and green" are the two states the sidebar is scanned to tell apart,
so rendering both in `--px-success` hides the one that means _this lane is
done, delete it_. Violet is the only hue not already spoken for. Adding a
sixth semantic color needs that kind of reason — reach for the existing five
first.

### Dark — "phosphor"

| Token                 | Value                    | Notes                                 |
| --------------------- | ------------------------ | ------------------------------------- |
| `--px-bg`             | `#1e1c18`                | warm graphite — deeper than Claude's  |
| `--px-bg-secondary`   | `#26231e`                |                                       |
| `--px-sidebar`        | `#15130f`                | **darker than `--px-bg`** — recedes   |
| `--px-sidebar-hover`  | `#221f19`                |                                       |
| `--px-sidebar-active` | `#2d2921`                |                                       |
| `--px-surface`        | `#2a2721`                |                                       |
| `--px-surface-raised` | `#322e27`                |                                       |
| `--px-chip`           | `rgb(236 231 219 / .11)` | alpha on purpose                      |
| `--px-border`         | `#3a352c`                |                                       |
| `--px-border-strong`  | `#4b453a`                |                                       |
| `--px-border-focus`   | `#453f34`                |                                       |
| `--px-text`           | `#ece7db`                | 13.8:1 on bg                          |
| `--px-text-secondary` | `#aca496`                | 6.9:1                                 |
| `--px-text-tertiary`  | `#7c766a`                |                                       |
| `--px-accent`         | `#eca03d`                | **phosphor** — 7.8:1 on bg            |
| `--px-accent-hover`   | `#f2b158`                |                                       |
| `--px-accent-soft`    | `#3d3220`                |                                       |
| `--px-accent-text`    | `#241503`                | ⚠ dark ink on amber — see below       |
| `--px-success`        | `#7fbe88`                | 7.8:1                                 |
| `--px-warning`        | `#d8ab52`                |                                       |
| `--px-danger`         | `#dd7663`                | 5.6:1                                 |
| `--px-danger-soft`    | `#46302a`                |                                       |
| `--px-merged`         | `#a98ce0`                | merged PRs — deliberately not success |
| `--px-merged-soft`    | `#2f2740`                |                                       |
| `--px-info`           | `#82a9c9`                |                                       |
| `--px-user-bubble`    | `#2f2b24`                |                                       |
| `--px-code-bg`        | `#24211c`                |                                       |
| `--px-terminal-bg`    | `#1e1c18`                | the page itself, not a raised surface |
| `--px-scrollbar`      | `#4b453a`                |                                       |

**The one behavioral flip:** amber is a _light_ color. White text on the dark
theme's accent fails contrast (2.2:1), so `--px-accent-text` is near-black ink
in dark mode (8.2:1). Anything that puts text on an accent background must use
the token pair (`bg-accent text-accent-text`), never `text-white`.

`bg-danger` is the standing exception: `src/components/form.tsx` keeps
`text-white` on it deliberately. That is 3.1:1 on the dark `--px-danger` and
below AA for body text; it is accepted because danger buttons are short,
bold, and never the only signal. Don't copy the pattern to new surfaces, and
don't "fix" it without changing `--px-danger` itself.

### Terminal (xterm ANSI)

The terminal is the brand's home turf; in dark mode it sits on `--px-bg` itself
(not a raised surface), cursor in phosphor. Full 16-color ramps live in
`src/features/terminal/xtermTheme.ts`; keep them derived from the tables above
(red→danger, green→success, yellow→warning, blue→info, magenta/cyan warmed to
match). Light terminal stays on `#ffffff` with the ember cursor, and its
neutrals (`black`, `white`, `brightBlack`, `brightWhite`, `foreground`) track
the cool light ramp, not the warm ANSI convention.

The dark `selectionBackground` is `#8a6a2f66`, not `--px-accent-soft` with
alpha: the old `#3d322066` blended to within a few points of `--px-bg`, so a
drag looked like nothing had been selected.

## Typography

- **UI:** `Inter` / system sans, unchanged. Body 14px/1.55.
- **Scale:** nine steps, defined in `@theme` in `src/styles/index.css`. Use the
  named utility, never `text-[Npx]` — the arbitrary values are what produced 18
  ad-hoc sizes between 8.5 and 30px, half of them half-pixel neighbours used
  for the same job.

  | Utility     | Size   | For                                            |
  | ----------- | ------ | ---------------------------------------------- |
  | `text-2xs`  | 9px    | dense badges, in-context pills                 |
  | `text-xs`   | 10.5px | uppercase mono eyebrows, group headers, chips  |
  | `text-sm`   | 11.5px | tertiary metadata: timestamps, paths, counts   |
  | `text-base` | 12.5px | the workhorse — controls, list rows, secondary |
  | `text-lg`   | 13.5px | primary UI copy, header and menu titles        |
  | `text-xl`   | 16px   | stat values, settings section headings         |
  | `text-2xl`  | 20px   | empty-state headline                           |
  | `text-3xl`  | 24px   | setup screen headline                          |
  | `text-4xl`  | 28px   | home / picker hero headline                    |

  Every step inherits its line-height rather than carrying Tailwind's default
  — set leading explicitly with `leading-*` where a block needs its own. Chat,
  editor and terminal body text are **not** on this scale: they are
  user-configurable (`--px-chat-font-size` and friends, Settings → Appearance).
  Overall size is page zoom, not a font-size multiplier — see
  `electron/window-chrome.ts`.

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
- Don't warm the light neutrals back up on their own. Light greys are cool so
  the ember accent reads as interaction; warming them without re-picking the
  accent is the change that got reverted in August 2026.
- Don't use the accent for large fills; it's for interaction, focus, and the
  working-state glow. Backgrounds stay neutral.
- Don't put white text on amber (dark mode) or amber text on paper below
  14px bold (light mode) — use the token pairs.
- Don't change a neutral in one place. Grep the old hex across
  `index.css` plus all five satellite copies, or light mode splits again.
- Don't mix the v1 and Phosphor palettes in one surface; change a surface
  atomically or not at all.
