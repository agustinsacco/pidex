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
 * "N agents launched in background" strip for the Claude Code provider.
 *
 * Shown when the LAST turn launched sub-agents the user has not responded to
 * yet. Deliberately says "launched", not "running", and carries no spinner:
 * the provider forwards only the launch marker — no progress, no completion,
 * and the CLI process does not outlive the turn — so any liveness claim here
 * would be an invention. Live tracking is provider work
 * (specs/12-extensions.md § How provider transcripts render).
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
        className="text-text-tertiary flex items-center gap-2 px-2 text-base"
        title="The Claude provider reports sub-agent launches but not their progress or results — ask in your next message."
      >
        <span className="bg-accent-soft text-accent rounded px-1.5 py-px text-xs font-semibold uppercase tracking-wide">
          agent
        </span>
        <span>
          {count} agent{count === 1 ? '' : 's'} launched in background
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
