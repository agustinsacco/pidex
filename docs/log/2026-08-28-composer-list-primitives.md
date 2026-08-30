# 2026-08-28 — Lists in the composer, without a rich text editor

The composer had no markdown affordances: no list continuation, no toggles, no
emphasis chord. Writing a numbered plan in a prompt meant typing every marker.

## Why not a rich editor

Lexical or ProseMirror would have to re-implement everything the raw string
currently supports: the `/` command menu and `@` mention menu are regexes over
`value`, prompt recall replaces the whole value, `!cmd` is a prefix test, and
the e2e suite selects the composer by placeholder. All of that is cost against
a WYSIWYG gain the wire format does not want — what pi receives is markdown
text, so markdown text is what the user should be editing.

So: `src/lib/composerText.ts`, pure `(value, selection) → (value, selection)`,
and a keymap in `ComposerField`.

## Enter still sends

List continuation is on **⇧Enter**, the key that already meant "another
line". Binding it to Enter would mean a one-line prompt that happens to start
with `- ` no longer sends — a much worse trade than the one it buys, and one
the user would hit constantly.

- ⇧Enter continues a list, renumbering as it goes; on an empty item it steps
  out one nesting level, then leaves the list.
- Tab / ⇧Tab nest and un-nest, **only** inside a list. Elsewhere Tab keeps
  being a focus move. A freshly nested ordered item restarts at 1.
- ⌘⇧8 / ⌘⇧7 toggle bullet and numbered across the selection; ⌘B / ⌘I wrap;
  ⌘⇧C fences. Chords read `event.code`, not `event.key`: with Shift held,
  Digit8 reports as `*`.
- Multi-line paste into a list marks each pasted line, unless the pasted text
  is already a list.

Three buttons next to Attach, deliberately. Past bullet, numbered and code,
markdown is faster to type than to reach for.

## Sent messages render their lists

The user bubble was `whitespace-pre-wrap`, so a list the composer helped write
read back as literal `- ` characters. It is **not** now a full markdown
renderer: the bubble also carries the `<attached-files>` block, which
react-markdown either swallows as raw HTML or needs a plugin the CSP rules
out. `parseUserText` promotes list runs only; every other line is the exact
text that was sent.

## Prerequisite

`Composer.tsx` and `WorkspaceHome.tsx` held hand-copied paste, drag-drop, chip
and textarea code — the reason they had already drifted (the home composer had
no slash commands, no mentions, no prompt history). Extracted to
`useAttachments`, `AttachmentChips` and `ComposerField` first, as a
behaviour-free commit, so the keymap only had to be written once.

Tests: `src/lib/composerText.test.ts` (47 cases, the bulk of the coverage),
`src/features/chat/composer/ComposerField.test.tsx`,
`src/features/chat/userMessageBlocks.test.ts`.
