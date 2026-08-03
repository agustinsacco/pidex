# 04 — Chat: Composer, Streaming, Rich Rendering

## Composer

- Multi-line input; Enter sends, Shift+Enter newline.
- **While streaming**: Enter queues a **steering** message (delivered after the current turn's tool calls), Alt/Cmd+Enter queues a **follow-up** (after the agent finishes). Match pi TUI semantics exactly; the two queues are visually distinct. Escape aborts and restores queued messages to the composer.
- `queue_update` renders queued chips above the composer (steer = one color, follow-up = another) with remove/recall.
- `@` → fuzzy file search across the workspace (gitignore-aware), inserts a path reference chip/text.
- Images: paste or drag → thumbnails in composer → sent as `images[]` (base64) with the prompt.
- `!command` → RPC `bash` (output shown in chat, enters model context on next prompt). `!!command` → same with `excludeFromContext: true` and a "not sent to model" badge. Surface both in a composer hint.
- `/` → command menu fed by `get_commands` (extension commands, prompt templates, `skill:*` — with source badges and descriptions) merged with pidex-native commands (new, fork, clone, compact, export, model, name, tree…). Sending an unknown `/x` still goes to pi as a prompt (pi expands templates/skills itself).
- Composer widget slots above/below for extension `setWidget`; `set_editor_text` prefills the input.

## Streaming rendering rules

- Reduce `message_update.assistantMessageEvent` deltas incrementally into per-message view-models; never rebuild the whole list per delta.
- **Text deltas** render as live markdown. Fenced blocks render their rich form only once the fence closes (skeleton/plain-mono while open) to avoid flicker.
- **Thinking deltas** stream into a collapsed-by-default "Thinking…" block with subdued styling; respect pi's `hideThinkingBlock` setting; expandable during and after streaming.
- **Tool calls** appear as cards at `toolcall_start`, args fill from deltas, then live output attaches via `tool_execution_update` (partialResult is accumulated — replace displayed output each update), final state at `tool_execution_end` (success/error styling).
- Virtualized message list; long sessions (1000+ entries) stay smooth. Autoscroll with "jump to bottom" pill when the user scrolls up.

## Message affordances

- Copy message / copy as markdown; code blocks: copy, "open as file", "run in terminal", "open as artifact".
- User messages: **fork from here** (`fork` entryId) and edit-and-refork.
- Error/abort stopReasons styled clearly (error banner with message; aborted = muted "stopped" divider).
- Auto-retry: inline strip "Retrying (2/3) in 4s — <error>" with cancel (`abort_retry`).
- Compaction: `compaction_start/end` render a system divider "Context compacted — N tokens summarized" (expandable summary). Branch summaries similar.

## Tool renderers

| Tool | Treatment |
|---|---|
| `read` | Collapsed file chip: path, line range, size; click opens the file in Files pane. Returned images render inline |
| `bash` | Terminal-styled block, streaming output, exit-code badge, duration; truncation notice links `fullOutputPath` |
| `edit` | Proper diff from `details.diff`/`details.patch` — green/red gutters, collapsed beyond ~40 lines, header shows path + hunk stats, click opens file at `details.firstChangedLine`; feeds Files Changed panel ([05-files-editor.md](05-files-editor.md)) |
| `write` | "Created/Overwrote <path>" chip + collapsible content preview (highlighted) |
| `grep`/`find`/`ls` | Compact result lists, match counts, truncation notices; rows click through to files |
| unknown/extension | Generic: tool name, collapsed pretty-JSON args, streaming output area, error state. Must look polished with zero special-casing |

## Rich content (first-class citizens)

- GFM: headings, tables (copy as markdown/CSV), task lists, blockquote callouts, footnotes, autolinks.
- Code: Shiki/hljs, language badge, copy, line numbers on hover, horizontal scroll contained inside the block.
- ```mermaid → rendered diagram; click for pan/zoom lightbox; export PNG/SVG; parse errors fall back to code with an error note.
- ```vega-lite / ```chart → theme-aware rendered chart; invalid spec falls back to code.
- ```html → Code/Preview toggle; preview in sandboxed iframe (`sandbox` attr, no network, inlined content only).
- KaTeX for `$…$` / `$$…$$`.
- Images in content blocks inline with click-to-zoom.

## Session header / status strip (per session)

- Model picker (from `get_available_models`, grouped by provider — remember custom/local providers exist), thinking-level selector (off→xhigh, hidden if model lacks reasoning).
- Context meter: % of window from `get_session_stats` (poll after each `agent_end` + on demand); warn state near compaction threshold. Token/cost readout (input/output/cache split in a popover).
- Controls: Stop (`abort`), Compact now (`compact`, optional custom instructions input), auto-compaction toggle, auto-retry toggle, steering/follow-up mode toggles ("all" vs "one-at-a-time"), rename session, export HTML (save dialog → `export_html` → reveal/open).
