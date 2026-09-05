# 2026-09-05 — Skills and Artifacts become global pages

Skills and Artifacts are global features, but both sidebar rows toggled a
**per-session right pane**. The gaps that made obvious:

- On the home screen the rows were silent no-ops — `patch()` in
  `stores/layout.ts` drops pane actions when no session is active. The skills
  e2e test even documented it: "start a session first, like a user would."
- The pane system holds ONE pane per session, so browsing skills closed your
  terminal/files/diff.
- Opening Skills in session A said nothing about session B; switching lanes
  made the "page" vanish.
- The Artifacts pane only ever showed the ACTIVE session's artifacts, while a
  nav-level "Artifacts" row promises the set across sessions.

## What changed

A `page: 'artifacts' | 'skills' | null` field on the layout store — global,
not per-session, not persisted. `App.tsx` renders the open page as an overlay
covering the main region (`data-testid="global-page"`, `z-30`, one level above
the expanded-pane overlay), so the session underneath stays mounted and closing
the page restores it untouched. Chrome is `components/PageShell.tsx`, a
PaneShell sibling without the pane-only controls (side swap, expand).

**Closing is session activation.** `activate()` in `stores/sessions.ts` calls
`setPage(null)` directly — every "show me a session/home" gesture (lane row,
New, workspace switch, palette) already funnels through it. A subscription on
`activeSessionId` would miss re-activating the current session, which is
exactly the "get me back to the chat" click. The page ✕ and the sidebar row
toggle also close it.

**Skills is page-only now.** `'skills'` left the `RightPane` union;
`sanitizePersistedPanes` degrades a persisted `'skills'` pane to closed.
`SkillsPane.tsx` became `SkillsPage.tsx` with the same content and IPC.

**Artifacts keeps its per-session pane** — side-by-side viewing while the
model iterates is the point of it, and chat cards / auto-open / the top-bar
button still target it. The new `ArtifactsPage.tsx` is the cross-session
index: every artifact in the artifacts store, newest first, labelled with its
session and project; clicking a row activates that session (which closes the
page), selects the artifact, and opens the pane.

Honest scope: the artifacts store is renderer state, ingested from a session's
history at bootstrap and dropped on dispose, so the page indexes **open
sessions only**. A disk-wide index would need a main-process scan of session
files for artifact tool results — deliberately out of scope here; the page
copy says what it covers.

Command palette gained ungated "Open artifacts page" / "Open skills page"
entries (the pane toggles stay session-gated).
