import { useEffect, useMemo, useState } from 'react'
import { useChatStore } from '@/stores/chat'
import { PiSpark } from '@/components/PiSpark'
import { formatDuration, formatTokens } from '@/lib/format'
import { buildTranscriptRows, trailingAgentLaunches } from './items/transcriptRows'

/**
 * Persistent "pi is working" strip: elapsed time and running token count for
 * whole agent operation (not per turn — `agentStartedAt` is set once on
 * `agent_start` and only cleared on `agent_settled`, so tool runs, retries,
 * and queued continuations keep one continuous timer).
 *
 * Tokens read `stats.tokens.total`, refreshed live on every `message_end` /
 * `tool_execution_end` (see shouldRefreshStatsOn in stores/sessions.ts) — it
 * climbs during the run rather than jumping once at the end.
 */
/**
 * "This turn's sub-agents never reported back" strip for the Claude provider.
 *
 * Shown when the LAST turn launched Claude Code sub-agents and the user has
 * not replied yet.
 *
 * The wording is load-bearing, and the first version of it was wrong.
 * "Launched in background" implies something is still out there working;
 * verified against a real capture, nothing is. Claude Code answers the
 * `Agent` tool with "Async agent launched successfully… you will be notified
 * automatically when it completes", which assumes the long-lived harness the
 * CLI normally runs inside. pidex has no such harness: the provider runs
 * `claude -p` as a per-turn model server, so the process exits when the turn's
 * answer is done and the agent dies with it. In the capture
 * (`~/.claude/projects/…/01a0271c-….jsonl`) the CLI's own record simply ends
 * after the launch — no notification, no results, never resumed — and pi's
 * session shows the turn closed with `stopReason: stop`.
 *
 * So this strip reports a dead end, not work in flight: no spinner, no count
 * of "running" agents, and it says plainly that the results are not coming.
 * Making the promise true is provider work (see 04-chat.md and
 * specs/log/2026-08-22-claude-subagents-never-return.md).
 */
export function AgentLaunchStrip({ sessionId }: { sessionId: string }): React.JSX.Element | null {
  const items = useChatStore((s) => s.sessions[sessionId]?.items)
  const isStreaming = useChatStore((s) => s.sessions[sessionId]?.isStreaming ?? false)
  const count = useMemo(
    () => (items ? trailingAgentLaunches(buildTranscriptRows(items)) : 0),
    [items],
  )
  if (isStreaming || count === 0) return null

  return (
    <div className="mx-auto w-full max-w-3xl px-1 pb-2" data-testid="agent-launch-strip">
      <div
        className="text-text-secondary flex items-center gap-2 px-2 text-base"
        title="Claude Code sub-agents run inside the CLI, which pidex starts fresh for each turn and which exits when the turn ends — so the agent stops with it and its findings are never sent back. Asking again re-does the work in this session."
      >
        {/* bg-bg-secondary, not a *-soft token: only accent-soft and
            danger-soft are defined, and this is a caution, not an error. */}
        <span className="bg-bg-secondary text-warning rounded px-1.5 py-px text-xs font-semibold uppercase tracking-wide">
          agent
        </span>
        <span>
          {count === 1 ? 'A sub-agent was' : `${count} sub-agents were`} started but won&rsquo;t
          report back — ask again to get the work done here
        </span>
      </div>
    </div>
  )
}

export function WorkingIndicator({ sessionId }: { sessionId: string }): React.JSX.Element | null {
  const isStreaming = useChatStore((s) => s.sessions[sessionId]?.isStreaming ?? false)
  const agentStartedAt = useChatStore((s) => s.sessions[sessionId]?.agentStartedAt ?? null)
  const totalTokens = useChatStore((s) => s.sessions[sessionId]?.stats?.tokens.total)
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    if (!agentStartedAt) return
    setElapsedMs(Date.now() - agentStartedAt)
    const interval = setInterval(() => setElapsedMs(Date.now() - agentStartedAt), 1000)
    return () => clearInterval(interval)
  }, [agentStartedAt])

  if (!isStreaming || !agentStartedAt) return null

  return (
    <div className="mx-auto w-full max-w-3xl px-1 pb-2">
      <div className="text-text-secondary flex items-center gap-2 px-2 text-base">
        <PiSpark size={14} />
        <span className="tabular-nums">{formatDuration(elapsedMs)}</span>
        {totalTokens != null && (
          <>
            <span className="text-text-tertiary">·</span>
            <span className="tabular-nums">{formatTokens(totalTokens)} tokens</span>
          </>
        )}
      </div>
    </div>
  )
}
