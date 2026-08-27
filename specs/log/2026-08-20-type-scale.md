# 2026-08-20 — A type scale, replacing 424 hand-picked pixel sizes

Fallout from the UI-scale fix ([the same day](2026-08-20-ui-scale-and-linux-titlebar.md)),
which turned up how the type in this app was actually specified: **404
`text-[Npx]` utilities across 70 files**, in 18 distinct sizes between 8.5px
and 30px, plus 17 stragglers still on Tailwind's default `text-xs`/`text-sm`.

Half of those sizes were half-pixel neighbours doing the same job. `text-[11px]`
and `text-[11.5px]` were both "tertiary metadata" — 52 and 58 uses, sometimes
in the same component. `text-[12px]` and `text-[12.5px]`, likewise, 165 uses
between them. Nothing distinguished the members of a pair except which one the
author happened to type, so nothing could be audited and every new component
was a fresh guess.

Nine steps now cover everything, defined in `@theme` in `src/styles/index.css`
and documented in [../STYLE_GUIDE.md](../reference/style-guide.md):

| Utility     | Size   | Absorbed                    |
| ----------- | ------ | --------------------------- |
| `text-2xs`  | 9px    | 8.5, 9, 9.5                 |
| `text-xs`   | 10.5px | 10, 10.5                    |
| `text-sm`   | 11.5px | 11, 11.5                    |
| `text-base` | 12.5px | 12, 12.5, old `text-xs`     |
| `text-lg`   | 13.5px | 13, 13.5, 14, old `text-sm` |
| `text-xl`   | 16px   | 15, 16, 17, old `text-base` |
| `text-2xl`  | 20px   | 20                          |
| `text-3xl`  | 24px   | old `text-2xl`              |
| `text-4xl`  | 28px   | 28, 30                      |

Sizes stay in px deliberately. `rem` would ride the root font-size, and UI
scale is page zoom, which scales px and rem alike — so `rem` would buy nothing
and add a second scaling axis to reason about.

## Two things that would have gone wrong silently

**Line-height.** Overriding `--text-sm` leaves Tailwind's own
`--text-sm--line-height` (1.43) in place, and the generated utility is
`line-height: var(--tw-leading, var(--text-sm--line-height))`. The arbitrary
values being replaced set font-size _alone_, so every one of those 424 sites
inherited its container's leading — `body` 1.55, `.md-content` 1.65. Converting
naively would have quietly re-led the entire app tighter. Each step pins
`--text-*--line-height: inherit`, which reproduces the old behaviour exactly;
`leading-*` still wins, because it sets `--tw-leading`, which the utility reads
first. Verified by grepping the built CSS, not by reading the docs.

**Rounding direction.** Merging a `.5` pair moves one of them by half a pixel.
Everything rounds **up** (11 → 11.5, not 11.5 → 11), so the net effect is a
marginally larger UI rather than a smaller one — the wrong direction here would
have re-created the complaint that started the day. Four sites move a full
pixel or more: 15px and 17px (the two stat-value treatments in `MonitorPanel`
and `StatTile`, now both 16px and consistent with each other), and the 30px
picker headline joining the 28px home headline — two hero headings that had
differed by 2px for no reason.

## Verification

Screenshotted the picker, home, a live session with transcript and artifact
pane, the settings modal and the files pane, before and after, in the built app
under Playwright-Electron. Differences are sub-pixel; no overflow, truncation
or leading change anywhere. Typecheck, lint, prettier, 704 unit tests and the
17-test e2e suite all pass.
