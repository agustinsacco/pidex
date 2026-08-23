# 2026-08-22 — Chat images open on click and copy on right-click

## What broke

Images dropped into a chat were inert `<img>` tags in every surface: the
composer attachment (chat **and** home composer), the user message in the
transcript, and extension messages. Nothing signalled they were interactive —
no hover affordance — and there was no way to view one full-size or to copy it
back out. For a workflow where screenshots _are_ the input, that was a dead
end: the one artifact a user brought in could not be retrieved.

## What changed

- **`ChatImage`** (`src/features/chat/ChatImage.tsx`) — one shared control for
  every chat image, with one interaction contract:
  - hover → accent ring + shadow, so it reads as openable;
  - click → full-size lightbox on `ModalOverlay`'s existing `photo` backdrop
    (Escape / click-outside close, depth-aware Escape as everywhere else);
  - right-click → copy to the **system** clipboard, from the thumbnail _and_
    from the lightbox.
    Callers pass their previous size classes verbatim as `className` on the
    inner `<img>`; the wrapper is an unsized inline-flex that hugs it, so layout
    is exactly what the old plain `<img>` produced. The ring is hover-only
    geometry, so nothing shifts at rest.
- **`clipboard:writeImage` IPC** (new channel, `electron/ipc/clipboard-handlers.ts`).
  Two constraints forced the copy through main: the renderer is sandboxed and
  cannot reach Electron's clipboard, and the web `ClipboardItem` API accepts
  `image/png`/`image/jpeg` _only_ — pi's image set also carries gif/webp/bmp,
  so a renderer-only implementation would silently fail on a third of the
  types the app accepts. In main, `nativeImage.createFromBuffer` sniffs all
  five. The browser harness (`dev:web`) implements the same channel
  best-effort: png/jpeg go straight to `navigator.clipboard.write`, the rest
  are rasterized to png via canvas, and permission/type failures are swallowed
  so a copy attempt never crashes the harness.
- Surfaces wired: chat composer, home composer (where images are dropped
  before any session exists), user messages, extension messages.

## Why the e2e asserts on the MAIN clipboard

`clipboard:writeImage` lands in the main process, which is invisible to the
renderer — so the only honest assertion reads it back there
(`app.evaluate(({ clipboard }) => clipboard.readImage()…)`), the same trick the
terminal-clipboard test uses for text. Attaching the image itself is a
synthetic `DataTransfer` drop on the home composer: the native picker is
undriveable, and a `File` built in JS has no real path — irrelevant here,
since images travel inline as base64 and never need one.

## Verification

`npm run validate`: typecheck / lint / format / unit PASS; e2e 22/23 — the
single failure (`reopens the last session on relaunch instead of the picker`)
fails identically on clean `main`, i.e. pre-existing and unrelated.
