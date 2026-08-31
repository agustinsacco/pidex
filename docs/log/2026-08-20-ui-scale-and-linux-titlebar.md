# 2026-08-20 — "UI scale" that never scaled, and a dead strip above the sidebar

Two reports from a Linux run, one visible in a screenshot and one that had
been quietly broken since the setting shipped.

## The sidebar started 44px down for no reason

`Sidebar.tsx` opened with a `titlebar-drag h-11` spacer on every platform. That
strip exists to keep content out from under macOS's traffic lights, which sit
over the **top-left** of a frameless window. Windows and Linux put their
controls **top-right**, drawn by the Window Controls Overlay — which
`.titlebar-inset-end` on the chat header already accounts for. So on those
platforms the strip reserved space for controls that were never going to be
there, and the workspace switcher floated a full title-bar height below the
top of the window while the chat title beside it sat at y≈28.

Replaced the hard-coded `h-11` with `.titlebar-inset-start`, which is `0` by
default and `2.75rem` under `.platform-darwin`. `src/main.tsx` stamps
`platform-<host>` on `<html>` before the first paint (read via `hostPlatform()`,
so the browser-only mock harness resolves too) — a class rather than a prop
because the layout has to be right on the very first frame, not after a store
hydrates.

The strip was also the sidebar's only window-drag handle, so `WorkspaceSwitcher`
picked up `titlebar-drag` itself. Its popup menu needed an escape hatch: the
existing `.titlebar-drag button` no-drag rule covers `MenuRow`, but not the
menu's section labels and separators, which would have become drag regions
mid-menu. `PopupMenu` now marks its root `data-popup-menu` and the CSS excludes
that subtree wholesale.

`WorkspacePicker`'s strip went `h-10` → `h-11`: it is a full-width screen, so
it has to clear the 44px overlay, and 40 did not.

## "UI scale" only moved the padding

The setting applied itself as `html { font-size: N% }`, which moves `rem`
lengths and nothing else. This UI is written almost entirely in pinned pixels —
404 `text-[Npx]` utilities across 70 files, plus `width="14"` on essentially
every inline SVG icon — so raising the scale grew the gaps and the row heights
and left every glyph and icon exactly the size it was. At 140% the app looked
loose, not bigger, which is why it read as "the scale is too small and the font
isn't updatable".

Rewritten as Chromium page zoom, applied by the main process
(`window-chrome.applyZoom` → `webContents.setZoomFactor`), which scales the
rendered page wholesale. Three consequences worth knowing:

- **Zoom resets on navigation**, so it is re-applied on `did-finish-load`
  rather than once at window creation — otherwise an HMR reload silently snaps
  back to 100%.
- **The Window Controls Overlay height is device-independent pixels**, which
  page zoom does not touch, while the renderer's 44px strip is CSS pixels,
  which it does. `overlayFor` now returns `44 × uiScale` so the OS buttons keep
  lining up with the header at any scale.
- **Chromium's zoom is per-origin**, so the floating monitor window (same
  bundle, `?view=monitor`) inherits it whether or not we ask. Its default frame
  size is scaled to match rather than left to overflow.

`applyFontsToDom` no longer touches `root.style.fontSize`; leaving both in
would have compounded on the spacing.

Bounds (`UI_SCALE_MIN`/`MAX`, 70–200%) and `clampUiScale` live in
`shared/models.ts` so the settings field, the shortcuts and the main process
that applies the zoom cannot drift apart. Range was 80–140.

Added the zoom shortcuts every other app has — `mod+=`, `mod+-`, `mod+0` — in
`useGlobalShortcuts`, deliberately above the editable-target guard: `⌘+` has to
work while the composer has focus, which is exactly when you notice the text is
too small. The app is frameless with no menu roles, so Chromium's built-in zoom
accelerators are not wired up and these are the only bindings. Stepping rounds
through whole percent so a run of nudges lands on 130 rather than accumulating
float drift.

Verified on Linux by driving the built app under Playwright-Electron:
`getZoomFactor()` 1 → 1.3 after three `Ctrl+=`, the switcher's rendered height
36 → 46.8 device px, back to 1.0 on `Ctrl+0`; screenshots confirm the sidebar
now starts flush with the top of the window. Full smoke suite (17) still green.

## Still open

- `npm run dev:web` has no main process, so UI scale is inert in the browser
  harness. Not worth a renderer-side `zoom` fallback that only that path uses.
- The 404 pinned `text-[Npx]` utilities are now cosmetic rather than
  load-bearing, but they still make the type scale unauditable. A token pass
  (`text-xs`/`text-sm`/… mapped to the Phosphor scale) is the real fix.
