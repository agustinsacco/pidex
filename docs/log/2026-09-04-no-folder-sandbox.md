# "No folder" option: sandbox workspaces

2026-09-04

Every session needs a real cwd for pi, so pidex could only start a chat
inside a chosen project folder. Quick questions and throwaway experiments
had nowhere to go.

The folder menu (workspace chip) and the first-run picker now offer **No
folder**. Picking it asks main for a fresh sandbox folder and opens it as
the home target:

- `app:createSandbox` (`electron/ipc/app-handlers.ts`) creates
  `<userData>/sandboxes/sandbox-N` via `electron/sandbox.ts` — N is one past
  the highest existing `sandbox-\d+` name. userData, not homedir, so E2E's
  `PIDEX_TEST_USER_DATA` redirect keeps test runs out of the real one.
- From then on a sandbox is an **ordinary workspace**: it enters recents,
  hosts any number of sessions, and is removed in Settings → Workspaces like
  any other folder. Nothing downstream needed changing — the home screen
  already hides the branch/isolation controls for a non-git folder
  (`isRepo` in `WorkspaceHome.tsx`), and `startChat` already handles a
  non-repo cwd.
- Each pick mints a **new** folder on purpose: a sandbox is per-task
  scratch space, and reusing one would mix unrelated throwaway files.

Nothing deletes sandboxes automatically. They are small (only what the model
writes there), and silent deletion of a folder the user may have exported
work into is worse than a slowly growing `sandboxes/` dir.
