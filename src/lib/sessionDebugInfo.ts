/**
 * A copyable pointer to everything a session wrote to disk.
 *
 * Debugging a pi session after the fact means reading two ledgers, not one:
 *
 *   - pi's own transcript, which carries per-message `usage` (the authoritative
 *     token and cost numbers), and
 *   - the provider's transcript, when the session ran on the Claude Code CLI.
 *     The CLI keeps its own parallel copy of the conversation, and comparing
 *     the two is what exposes duplication — a pi transcript of 473 KB against
 *     a CLI copy of 13.8 MB is the whole diagnosis of a re-send bug.
 *
 * Both live under mangled directory names that are tedious to derive by hand,
 * and the two harnesses mangle differently. This produces the paths and the
 * ids in one block, so "here's my session" is a paste rather than an
 * archaeology exercise.
 */

export interface SessionDebugSource {
  /** pi's session file (.jsonl), absolute. */
  path: string
  /** pi's session id — also the Claude CLI's session id, which pi passes through. */
  sessionId: string
  /** The session's own working directory. */
  cwd: string
  provider?: string
  model?: string
}

/**
 * pi mangles a cwd to `--home-user-project--`: segments joined by dashes,
 * wrapped in double dashes. Mirrors `electron/pi/pi-paths.ts`, which is the
 * source of truth on the main side; this is the renderer's read-only copy for
 * display, so it deliberately does not resolve symlinks (it has no fs access
 * and the value is a pointer for a human, not a lookup key).
 */
export function piSessionDirName(cwd: string): string {
  const segments = cwd.split(/[/\\]/).filter(Boolean)
  return `--${segments.join('-')}--`
}

/**
 * The Claude Code CLI mangles the same cwd differently — every character that
 * is not a letter or digit becomes a dash, with no wrapping.
 * `/home/u/proj/.claude/wt` → `-home-u-proj--claude-wt`.
 *
 * Mirrors `claudeProjectDirName` in `electron/pi/pi-paths.ts`, which is the
 * source of truth and carries the full rule (including the length cap that
 * only very deep paths reach). This copy is for display, so it stops at the
 * character substitution.
 */
export function claudeProjectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

/**
 * Where the Claude Code CLI keeps its copy of this conversation.
 *
 * Returns null for sessions that did not run on that provider — there is no
 * such file, and pointing at a path that cannot exist is worse than saying
 * nothing. `~` rather than an absolute home path: the block is for pasting,
 * and the reader's home is not necessarily the writer's.
 */
export function claudeSessionPath(source: SessionDebugSource): string | null {
  if (source.provider !== 'pi-claude-cli') return null
  return `~/.claude/projects/${claudeProjectDirName(source.cwd)}/${source.sessionId}.jsonl`
}

/**
 * Format the block that gets copied.
 *
 * Plain `key: value` lines rather than JSON: this is pasted into a chat
 * message, where it needs to survive being read by a person as readily as by
 * a tool.
 */
export function formatSessionDebugInfo(source: SessionDebugSource): string {
  const lines = [
    'pi session',
    `  id:       ${source.sessionId}`,
    `  cwd:      ${source.cwd}`,
    `  file:     ${source.path}`,
  ]
  if (source.provider) {
    lines.push(`  provider: ${source.provider}${source.model ? ` / ${source.model}` : ''}`)
  }
  const cli = claudeSessionPath(source)
  if (cli) {
    lines.push(`  claude:   ${cli}`)
  }
  return lines.join('\n')
}
