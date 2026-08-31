# Phosphor: the light palette the doc described was never the one that shipped

`specs/reference/style-guide.md` was written 2026-08-07 and described a warm
"bone paper" light theme. Three days later `11a5d7c` ("QoL pass: popovers,
attachments, GitHub PR status, theme, icons, skeletons") re-based every light
neutral to a cool grey ramp. Nothing else moved with it, so for 19 days the
authority doc and the shipped app disagreed about half the light palette.

## What was actually wrong

**11 of 22 light tokens.** Every neutral drifted; every chromatic token held.
`--px-bg` `#f7f6f2`→`#f7f7f8`, `--px-bg-secondary` `#eeece5`→`#efeff1`,
`--px-border` `#e2dfd6`→`#e4e4e7`, `--px-border-strong` `#cec9bc`→`#c9c9ce`,
`--px-border-focus` `#d8d4c8`→`#d6d6db`, `--px-text` `#2c2a25`→`#26262a`,
`--px-text-secondary` `#6b675d`→`#66666e`, `--px-text-tertiary`
`#9b968a`→`#96969e`, `--px-user-bubble` `#efece2`→`#eeeef1`, `--px-code-bg`
`#f2f0e9`→`#f2f2f4`, `--px-scrollbar` `#cec9bc`→`#c9c9ce`. The accent,
success, warning, danger, info and `--px-accent-soft` were untouched.

**Four of the five satellite theme copies missed the re-base.** `xtermTheme.ts`,
`monaco.ts`, `MermaidBlock.tsx` and `ChartBlock.tsx` still held the warm
neutrals, so in light mode the terminal, editor, Mermaid diagrams and charts
rendered warm inside a cool-grey app — `#f7f6f2` panels on an `#f7f7f8` page,
`#e2dfd6` borders against `#e4e4e7` ones. Small individually, systematic
together. This is precisely the failure the style guide's own last rule names
("don't mix the v1 and Phosphor palettes"), one layer up: between surfaces
rather than inside one.

**The doc's drift warning pointed at the only correct file.** It called
window chrome "the one that drifts" because its light `color` was `#f7f7f8`
where `--px-bg` was `#f7f6f2`. After the re-base those are the same value.
Window chrome never moved; the CSS moved onto it.

**Five shipped tokens were in neither table:** `--px-sidebar`,
`--px-sidebar-hover`, `--px-sidebar-active`, `--px-chip`, `--px-terminal-bg` —
10 call sites. The dark sidebar is `#15130f`, _darker_ than `--px-bg`, so the
sidebar recedes below the page rather than rising above it. That is a real
identity decision and it existed only in CSS.

## What we did

Chose the shipped reality over the doc. The cool light ramp has been in every
build for 19 days and nobody filed it as a bug; the warm version is the one
that lasted three days.

- Rewrote `specs/reference/style-guide.md`: real light values, the five missing
  tokens in both tables, the window-chrome paragraph corrected, and the
  narrative fixed — Phosphor is warm in dark and cool in light, with the ember
  accent as the only warm element on a light page. The "warm paper light theme"
  inheritance claim was removed; it has not been true since August 10.
- Re-neutralized the four stale satellite copies to match `index.css`.
- Fixed `OrchestratorHeaderButton.tsx:122`, which put `text-white` on
  `bg-accent` (2.2:1 in dark mode) at a hardcoded `text-[9px]` — breaking the
  accent-token rule and the type-scale rule in one class string. Now
  `text-accent-text` and `text-2xs`, which is 9px, so it renders identically in
  light mode and becomes legible in dark.
- Recorded the `bg-danger` + `text-white` exception in `form.tsx` as a known,
  accepted 3.1:1 rather than leaving it unowned.

## The rule that would have caught it

A neutral cannot be changed in one place. `index.css` plus five satellite
copies, and nothing in the type system connects them — `xterm`, Monaco, Mermaid
and Chart.js all take theme objects, not CSS variables. The style guide now
says to grep the old hex across all six files, and the "must be updated
together" line says what happens when you don't.
