# pidex — Build Prompt

You are building **pidex**: a desktop coding-agent app for macOS/Linux/Windows, built with Electron + TypeScript, cloning the craft and UX of Anthropic's Claude Desktop "Code" experience, powered entirely by the **pi coding agent** (`@earendil-works/pi-coding-agent`) over its RPC mode. The reference screenshots in [specs/screenshots/](specs/screenshots/) define the visual quality bar — study them (Read them as images) before writing any UI code, and re-read them at the start of every UI-heavy phase.

The complete specification already exists in this repo. **Do not re-plan the product. Read the specs, then execute phase by phase.**

## Reference Screenshots per Phase

Before implementing UI code in any phase, inspect the relevant screenshots in `specs/screenshots/` using your image viewing capabilities:

| Phase | Relevant Screenshots | What to match / study |
|---|---|---|
| **P1 — Full chat rendering** | `chat-tool-calls.png`<br>`chat-file-chips.png`<br>`chat-full-width.png`<br>`composer-plus-menu.png`<br>`composer-model-picker.png` | Collapsed chevrons on tool execution cards, GFM markdown rendering, code block badges, file preview chips, full-width mode, composer `+` popup menu, and model/effort picker dropdown. |
| **P2 — Workspaces & Sidebar** | `home-light.png`<br>`home-populated.png`<br>`sidebar-sessions.png` | Greeting screen header ("What's up next?"), activity heatmap, stat tiles (Sessions, Messages, Tokens, Active days), workspace/branch/worktree chips at composer bottom, pinned routine sections, and right-click context menu on sidebar session items. |
| **P3 — Files & Diffs** | `files-diff-pane.png` | Three-panel layout, right-hand Files Changed list with summary counts (`+N -M`), colored line insertions/deletions, and Monaco split patch view. |
| **P4 — Terminal** | `terminal-pane.png` | Right-side sliding Terminal panel, header tabs (`Terminal +`), expand (`↗`) / close (`✕`) actions, and xterm font/theme styling. |
| **P5 — Artifacts** | `artifact-panel.png` | Three-panel layout, right-hand Artifact viewer with share/reload controls, formatted artifact headers, metadata badges, and inline markdown/code previews. |
| **P6 — Settings & Polish** | `settings.png`<br>`settings-connectors.png`<br>`profile-menu.png` | Main Settings modal window with sidebar navigation, theme appearance toggles, live code diff preview, Connectors list table, and bottom-left user profile menu. |

## Your working contract

1. **Start by reading, in order:**
   - [specs/TRACKER.md](specs/TRACKER.md) — the phase plan, task checklists, definitions of done, and your instructions for keeping it updated
   - [specs/00-overview.md](specs/00-overview.md) — product definition, non-negotiables, brand, quality bar
   - [specs/01-architecture.md](specs/01-architecture.md) — locked stack, process model, IPC, repo layout
   - [specs/02-pi-integration.md](specs/02-pi-integration.md) — the verified pi RPC/protocol reference. This is the load-bearing document; read it fully before any pi-related code.
   Then, per phase, the relevant domain spec:
   [specs/03-ui-shell.md](specs/03-ui-shell.md) · [specs/04-chat.md](specs/04-chat.md) · [specs/05-files-editor.md](specs/05-files-editor.md) · [specs/06-terminal.md](specs/06-terminal.md) · [specs/07-artifacts.md](specs/07-artifacts.md) · [specs/08-sessions.md](specs/08-sessions.md) · [specs/09-settings.md](specs/09-settings.md) · [specs/10-packaging.md](specs/10-packaging.md)

2. **Work the tracker.** Execute phases P0 → P7 in order. Flip checkboxes as you complete tasks, set phase statuses (⬜/🟡/✅), and write a dated line in each phase's Log on completion or deviation. A phase is done only when its "Done when" criteria hold and the app still runs (`npm run dev`). **Git-commit at every phase completion** (and at meaningful milestones within a phase) with the phase id in the message — these are your checkpoints.

3. **Verify pi behavior against the local install, never from memory.** pi is installed globally on this machine. Its docs and type definitions are at `$(npm root -g)/@earendil-works/pi-coding-agent/` (`docs/rpc.md`, `dist/modes/rpc/rpc-types.d.ts`, `dist/core/tools/*.d.ts`, `examples/`). When the spec and the installed version disagree, the installed version wins — note the discrepancy in the tracker Log. You can also run `pi --mode rpc` yourself to probe the protocol live.

4. **Locked decisions are locked.** Stack, process model, YOLO-no-permissions, RPC-subprocess integration, pane layout — all fixed in the specs. Where specs are silent, follow established standards for Electron/React/Tailwind/Monaco/xterm apps; rely on your training rather than inventing novel patterns.

5. **Quality bar.** Every phase ships polished: both themes, empty/loading/error states, smooth streaming, no jank. If a screenshot shows a component treatment (chips, tool cards, stat tiles), match it. Write tests where the specs demand them (RPC framing, session parsing, diff reconstruction, e2e smoke).

6. **Non-negotiables to keep in your head the whole time** (full list in [specs/00-overview.md](specs/00-overview.md)):
   - No permission system of any kind — pi runs YOLO.
   - Rich content (markdown/code/mermaid/charts/HTML/KaTeX) is first-class in chat; model-authored HTML renders only in sandboxed iframes.
   - Everything pi exposes over RPC gets UI (commands, events, extension-UI protocol, session tree).
   - Unknown/extension tools must render well generically — pi's ecosystem is extension-driven.

Begin with P0 in [specs/TRACKER.md](specs/TRACKER.md).

