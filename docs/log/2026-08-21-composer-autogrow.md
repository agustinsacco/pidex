# 2026-08-21 — The composer that wouldn't grow with its text

## The bug

Typing in a session, the input box stayed one line tall no matter how much
text accumulated. A hard Enter grew it by one line each time — but a long
paragraph with no newlines just scrolled _inside_ the one-line box. The home
composer had the same behaviour.

## Why

Both composers sized the textarea with `rows={text.split('\n').length}`,
which only counts explicit newlines. A long line that soft-wraps keeps
`rows` at 1; a `<textarea>` wraps text by default, so the extra visual lines
overflow the fixed element height and become an internal scroll. The box
never learned how many lines the text actually occupied on screen.

## The fix

- `src/lib/useAutoResizeTextarea.ts` — hook that resets the field to
  `height: auto`, reads `scrollHeight` (which measures _wrapped_ lines, not
  just `\n`s), and clamps it to `COMPOSER_MAX_HEIGHT` (240px ≈ 8 visible
  lines of text-lg plus padding). The `rows` attribute stays on the element
  as the natural floor; beyond the cap the field scrolls. A
  `ResizeObserver` re-measures on column/window width changes, so pane
  resizes re-wrap correctly without any text change.
- Session composer (`src/features/chat/Composer.tsx`) and home composer
  (`src/features/home/WorkspaceHome.tsx`) use it; both lose their
  `split('\n')` math.
- Unit-tested with jsdom (steered `scrollHeight` + stubbed observer):
  grow, shrink, cap, width-change re-measure, unmount cleanup.
