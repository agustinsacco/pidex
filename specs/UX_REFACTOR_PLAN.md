# pidex — UX Refactor & Upgrade Plan

Derived from a close re-read of every reference screenshot in
[screenshots/](screenshots/) against the shipped implementation.
Ordered by severity. Each item names the file(s) to touch.

Legend: **P0** broken/misleading · **P1** clearly wrong vs reference ·
**P2** polish · **P3** nice-to-have.

---

## Phase A — Reported defects (do first)

### A1 · Pointer cursor missing app-wide — **P0**
Tailwind v4 dropped the UA `cursor: pointer` on `<button>`, so **~70 buttons
across 25 files** show an arrow. Nothing reads as clickable.

Do **not** sprinkle `cursor-pointer` on 70 elements. Add one global rule:

```css
/* src/styles/index.css */
button:not(:disabled),
[role='button']:not([aria-disabled='true']),
summary,
select { cursor: pointer; }
button:disabled { cursor: not-allowed; }
```

Also audit clickable non-buttons (`FilesChangedPane` row `<div>`, tree `<g>`
nodes, terminal tab `<div>`) — those need `cursor-pointer` explicitly, and
ideally should become real buttons for a11y.

Files: `src/styles/index.css`, `FilesChangedPane.tsx`, `TreeViewModal.tsx`,
`TerminalPane.tsx`.

### A2 · `Ctrl+~` doesn't open the terminal — **P0**
`App.tsx:59` tests `event.key === '`'`. With Shift held the browser reports
`'~'`, so the binding silently misses. Also `event.key` is layout-dependent.

Match on **`event.code === 'Backquote'`** and accept either modifier state.
While there: the handler runs on every keystroke app-wide with no guard for
text fields — `⌘N`/`⌘P` fire while typing in Monaco or the composer. Extract
a small `useGlobalShortcuts` hook with an `isEditableTarget()` guard, and
register the terminal toggle as `⌘\`` *and* `⌃\``.

Files: `src/app/App.tsx` → new `src/app/useGlobalShortcuts.ts`.

### A3 · Sidebar top nav is missing entirely — **P1**
Reference (`home-light`, `chat-tool-calls`) shows above the session list:
- a **Home / Code segmented toggle** (pill, active segment = white card on
  grey track)
- **New** · **Artifacts** · **Routines** · **Customize** as flat icon+label
  rows — *not* a bordered button
- a collapsible **More** row

pidex has only a bordered "New session" button. Rebuild the header region:
segmented control + flat nav rows (icon 14px, label 13px, hover
`bg-bg-secondary`, no border). "Artifacts" opens the artifacts pane;
"Routines"/"Customize" are out of scope for a coding-only app — drop them
rather than fake them, and keep Home/Code + New + Artifacts.

Files: `src/features/sessions/Sidebar.tsx`.

---

## Phase B — Structural mismatches vs reference

### B1 · Chat composer is over-chromed — **P1**
Reference: the input is a **plain rounded field**, and the control row
(`Bypass permissions`, `+`, mic, model, effort) sits on the **page
background below it** — there is no card wrapping both.

pidex wraps input + controls in one `border rounded-xl shadow-sm` card, so
the whole cluster reads as a heavy panel. Move the footer row outside the
bordered element and drop its background.

Files: `src/features/chat/Composer.tsx`.

### B2 · Settings is flat tabs; reference is a grouped, searchable sidebar — **P1**
Reference (`settings`, `settings-connectors`):
- **search field** pinned at the top of the settings sidebar
- items grouped under **Settings / Desktop app / Customize** headers
- every row has a **leading icon**
- active row = filled `bg-bg-secondary` rounded rect
- content pane is noticeably wider than ours

Restructure to grouped nav + search + icons. Suggested pidex grouping:
- **Settings**: General, Agent, Keybindings
- **Desktop app**: Appearance, Workspaces, Advanced
- **About**: About

Files: `src/features/settings/SettingsModal.tsx`.

### B3 · Stat tiles: wrong count and wrong surface — **P1**
Reference shows **8 tiles in 2 rows** — Sessions, Messages, Total tokens,
Active days, **Current streak, Longest streak, Peak hour, Favorite model** —
plus an `Overview | Models` tab pair and an `All | 30d | 7d` range selector.
Tiles are **flat grey** (`bg-bg-secondary`) with no border.

pidex renders 4 tiles as **white bordered cards** and no tabs/range control.
Add the 4 missing derived stats (all computable from the session scan),
switch tiles to borderless grey, and add the range selector (the
`Overview|Models` tab pair can be deferred).

Files: `src/features/home/WorkspaceHome.tsx`, `electron/pi/session-scanner.ts`
(compute streaks / peak hour / favorite model).

### B4 · Sidebar session rows are too heavy — **P1**
Reference rows are **icon + single-line title**, ~28px tall, with a
branch-glyph for forked sessions and a hollow circle otherwise. Group
headers are plain grey uppercase-ish labels with generous spacing.

pidex uses **two lines** (title + "1h ago · 3 branches"), making the list
feel cramped and unlike the reference. Move the timestamp to a tooltip or
hover-reveal; keep one line. Keep the live/streaming dot — that's genuinely
useful and pi-specific.

Files: `src/features/sessions/Sidebar.tsx`.

### B0 · Chat header icons and right-pane surface are wrong — **P0**
Closest read of `terminal-pane.png` / `artifact-panel.png` /
`files-diff-pane.png`. Three separate defects:

**(a) No terminal button in the header.** The reference header shows four
icons at top-right: **`>_` terminal · `⊡` files/side-panel · 🌐 globe ·
`⋮` kebab**. pidex renders files, changes, artifacts, kebab — and **no
terminal at all**. The terminal is currently reachable only through the
command palette or `⌘\`` (which is *also* broken, see A2), so on a fresh
launch it is effectively undiscoverable. This is the defect behind the
report.

**(b) The right pane is a flush column; the reference is a floating card.**
Reference: the pane is inset with a visible **gutter** between it and the
chat, has **rounded corners on all four sides**, its own subtle border and
a slightly raised surface — it reads as a panel resting on the app
background. pidex renders `border-l` flush to the window edge, square
corners, full bleed. This is the single biggest reason the panes look
unlike the screenshots.

**(c) Pane chrome is inconsistent between the four panes.** Files and
Changes share a `PaneTab` header (`RightPane.tsx:37-48`); Terminal and
Artifacts each early-return with their **own** bespoke header
(`RightPane.tsx:19-33`). So header height, close-button placement and
expand affordance differ depending on which pane is open. The reference
uses one consistent shell: **title on the left, pane-specific actions in
the middle, `↗` expand and `✕` close always at the far right.**

Fix as one pass:
- add the terminal icon button to the chat header (first of the four,
  matching reference order) and give every pane button an active state
- introduce a single `<PaneShell title actions>` component; Files, Changes,
  Terminal and Artifacts all render inside it and contribute only their
  own action buttons
- restyle the pane container as a floating card: wrapper padding for the
  gutter, `rounded-xl`, `border`, `bg-surface`, subtle shadow
- keep `↗` expand + `✕` close in the shell, not per-pane

Files: `src/features/chat/ChatView.tsx`,
`src/features/files/RightPane.tsx` → new `src/components/PaneShell.tsx`,
`TerminalPane.tsx`, `ArtifactsPane.tsx`, `FilesPane.tsx`,
`FilesChangedPane.tsx`, `src/app/App.tsx` (gutter padding).

### B4b · Home screen has no model / thinking / mode controls — **P1**
Reference `home-light` and `home-populated` both show a full control row
**below the home composer**: `Manual` (or `Bypass permissions`) · `+` ·
mic · chevron on the left, and **`Sonnet 5` · `High` · status ring** on the
right — i.e. the model and effort pickers are present *before* a session
exists, not only inside chat.

pidex renders `ModelPicker`/`ContextMeter` **only** in
`features/chat/Composer.tsx`. The home screen shows the workspace chip row
and nothing else, so the app looks like it lost its model picker whenever
you're on the greeting screen (the most common landing state).

This is a real behavioural gap, not just layout: you cannot choose the model
or thinking level for the session you are about to start.

Implementation note — the current pickers are session-scoped: they read
`meta`/`models` from `useChatStore` keyed by a live pidex session id and
issue `set_model` / `set_thinking_level` RPC against it. On the home screen
no session exists yet, so they must be backed by **pending defaults**
instead:

- read the candidate model list from pi config (`defaultProvider` /
  `defaultModel` in `settings.json` + `models.json`) rather than
  `get_available_models`, which needs a live process
- store the user's choice in a small `pendingSessionConfig` store
- pass it through `createSession` → existing `model` / `provider` /
  `thinkingLevel` spawn flags (already plumbed in `PiSpawnOptions`)
- once the session is live, the chat composer's pickers take over unchanged

Refactor `ModelPicker` to accept either a live `sessionId` **or** a
pending-config target, so one component serves both surfaces.

Files: `src/features/home/WorkspaceHome.tsx`,
`src/features/chat/composer/ModelPicker.tsx`, new
`src/stores/pendingSession.ts`, `src/stores/sessions.ts`.

### B5 · No account/profile menu at the sidebar footer — **P1**
Reference (`profile-menu`) has an avatar + name + org chevron opening a menu
with email header, org switcher, Settings (⌘,), Language, Get help, plans,
changelog, Log out.

pidex has a bare "Settings" gear row. pidex has no accounts, so build the
*shape* with what's real: avatar (initials from `app:userInfo`), machine
name, then Settings ⌘, · Keyboard shortcuts · About · pi health. Drop
account-specific entries rather than stub them.

Files: `src/features/sessions/Sidebar.tsx` → new `SidebarFooterMenu.tsx`.

---

## Phase C — Visual / token-level differences

### C1 · Heatmap color is wrong — **P2**
Reference uses a **blue** scale (`#3b82f6`-ish) on a light grey track — it is
deliberately *not* the terracotta accent. pidex uses `--px-info`
(`#4a7a9b`), a muted slate-blue that reads dull beside the reference.
Introduce a dedicated `--px-heat-1..4` ramp.

Files: `src/styles/index.css`, `WorkspaceHome.tsx`.

### C2 · Chat column is too narrow — **P2**
Reference content column is ~760–860px at that window width; pidex uses
`max-w-3xl` (768px) *including* `px-6`, so the effective measure is ~720px
and long code blocks wrap early. Move to `max-w-[820px]` with padding
outside the measure. `chat-full-width.png` also implies a **full-width
toggle** — add it to the session menu.

Files: `MessageList.tsx`, `Composer.tsx`, `ChatView.tsx`.

### C3 · Tool-call rows need the reference's quiet treatment — **P2**
Close read of `chat-tool-calls`: collapsed rows are **grey secondary text**
with the object in near-black, chevron **after** the stats, and hairline
separators between consecutive tool rows. Ours are close but the chevron
sits too tight and grouped runs lack the separators.

Files: `src/features/chat/tools/ToolCard.tsx`, `MessageItem.tsx`.

### C4 · User bubble radius/padding — **P2**
Reference bubbles are `~18px` radius with `14px/10px` padding and sit at
~72% max width. Ours: `rounded-xl` (12px), `16px/10px`, 85%. Small but it's
the most repeated element on screen.

Files: `src/features/chat/MessageItem.tsx`.

### C5 · Missing window chrome affordances — **P3**
Reference titlebar has a **sidebar-collapse icon** and a **search icon** at
top-left, and chat header shows terminal / artifacts / globe / kebab icons
at top-right. pidex has the right-side ones but not the left pair.

Files: `src/features/sessions/Sidebar.tsx`, `ChatView.tsx`.

### C6 · Composer chips: missing `+` affordance and worktree state — **P3**
Reference chip row is `Local · <folder> · <branch> [✓ worktree] · [+]`.
pidex renders Local/folder/branch only. The `+` (add folder) and worktree
checkbox are real pi-adjacent concepts worth having; at minimum add `+`.

Files: `src/features/home/WorkspaceHome.tsx`.

---

## Phase D — Accessibility & interaction correctness

### D1 · Focus-visible rings — **P1**
No `:focus-visible` styling anywhere; keyboard users get the UA outline or
nothing. Add a token-driven ring:

```css
:focus-visible { outline: 2px solid var(--px-accent); outline-offset: 2px; }
```
…plus `focus-visible:ring` on custom controls. Pairs naturally with A1.

### D2 · Clickable divs should be buttons — **P1**
`FilesChangedPane` rows, terminal tabs, and tree nodes are `<div onClick>` —
not focusable, not Enter/Space activatable, invisible to screen readers.

### D3 · `window.prompt` for real input — **P2**
Rename session, label node, compact instructions, and new file/folder all
use `window.prompt`, which is jarring inside a themed Electron app (and
blocks the renderer). Route them through the existing extension-UI dialog
sheet, which already renders exactly the right modal.

Files: `Sidebar.tsx`, `TreeViewModal.tsx`, `SessionMenu.tsx`,
`FileExplorer.tsx`, `Composer.tsx`.

### D4 · Reduced motion — **P3**
Spinners, shimmer, pulse and toast slides ignore
`prefers-reduced-motion`. One media query disables them all.

---

## Suggested execution order

| Batch | Contents | Risk |
|---|---|---|
| **1** | A1, A2, **B0**, D1 | cursor, shortcut, terminal button + pane shell |
| **2** | A3, B4, B5 | sidebar rebuild in one pass |
| **3** | B1, C2, C4, C3 | chat surface polish |
| **4** | **B4b**, B3, C1, C6 | home screen: pickers, stats, chips |
| **5** | B2 | settings restructure |
| **6** | D2, D3, D4, C5 | a11y + chrome cleanup |

Batches 1–2 give the biggest perceived-quality jump per unit of work.
Each batch ends green on `npm run typecheck && npx eslint . && npx vitest
run && npx playwright test`, and hot-reloads into a running `npm run dev`.
