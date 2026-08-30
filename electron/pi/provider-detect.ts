/**
 * Will this spawn land on the Claude Code provider (`pi-claude-cli`)?
 *
 * Decided at spawn time so pidex can pass `--no-context-files` for those
 * sessions: the Claude CLI loads CLAUDE.md itself as memory, and pi embedding
 * the same file in its system prompt bills it twice on every request
 * (~4,900 tokens measured on this repo's CLAUDE.md). See
 * docs/log/2026-08-29-claude-provider-token-overhead.md.
 *
 * Deliberately conservative: when the answer depends on pi's fuzzy model
 * matching (a bare pattern with no explicit provider), only a `claude*`
 * pattern under a `pi-claude-cli` default counts. A miss in that direction
 * costs the ~4,900 duplicated tokens (status quo), while a false positive
 * would silently strip CLAUDE.md from a non-Claude provider's prompt.
 */
export function usesClaudeCliProvider(
  options: { provider?: string; model?: string },
  defaultProvider: string | undefined,
): boolean {
  if (options.provider) return options.provider === 'pi-claude-cli'
  // pi's `--model` accepts "provider/id" (and ":thinking" suffixes), which
  // pins the provider regardless of the default.
  if (options.model?.includes('/')) return options.model.split('/')[0] === 'pi-claude-cli'
  if (options.model) return defaultProvider === 'pi-claude-cli' && /^claude/i.test(options.model)
  return defaultProvider === 'pi-claude-cli'
}
