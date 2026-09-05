# Artifact pane header: two rows into one

**2026-09-04**

The artifacts pane spent two stacked bands on chrome before any artifact was
visible: the shell header (glyph, title, relative time, switcher chevron, plus
the shell's own ↔ / ↗ / ✕) and, under it, a bordered viewer toolbar
(Preview / Code / Diff, the version picker, copy / save / open-in-Files). About
77px of a pane whose whole job is to show the artifact.

It is one row now. The viewer toolbar moved into `PaneShell`'s existing
`actions` slot — the same slot the Terminal pane already uses for its "+"
button — so the pane's chrome is the shell header and nothing else, ~44px.

## What changed

- `ArtifactViewer` and the pane's `PaneShell` merged into `ArtifactWorkspace`.
  Header and body are separate `PaneShell` slots but share tab + version
  state, so they have to be one component. It keeps the old `key={artifact.id}`
  remount, which is still what resets the view on an artifact switch.
- The relative time left the header title. It cost ~45px of a row that now
  also carries the tabs and the version picker, and the switcher dropdown
  already dates every artifact.
- Tabs, the version `<select>` and the icon buttons shrank to `text-sm` /
  `py-0.5`. Markdown previews went from `p-4` to `p-3`, matching mermaid and
  chart.

## Two layout traps this hit

**The close button must never be the thing that gets clipped.** The shell's
↔ / ↗ / ✕ come after `actions` in the row, so a toolbar that refused to shrink
pushed them out of a pane at its 24% minimum width and left no way to close it.
The toolbar is `min-w-0 shrink overflow-x-auto` (the Terminal tab strip's
trick, with the scrollbar hidden so a 10px bar does not eat a 44px row): the
title collapses first, then the toolbar scrolls, and the shell buttons stay
put.

**Clipping the squeezed title belongs on the button, not the wrapper.** The
switcher's glyph and chevron are `shrink-0`, so they spilled out of a title box
squeezed to zero and painted over the tabs. `overflow-hidden` goes on the
`<button>` — the wrapper is the dropdown's positioning anchor, and clipping
there would cut the popup off.

## Also fixed: the switcher dropdown

Rows used `MenuRow`'s `trailing` overlay for `v3 · 1m ago`. That overlay
reserves 36px; the text is closer to 55px at `text-sm` and was inheriting the
14px body size, so it sat on top of a title that had already wrapped to two
lines. The meta is a plain sibling now, after a `truncate`d title, and the menu
widened to `w-80`.
