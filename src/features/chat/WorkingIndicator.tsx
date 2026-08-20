import { useEffect, useState } from 'react'
import { useChatStore } from '@/stores/chat'
import { PiSpark } from '@/components/PiSpark'
import { formatDuration, formatTokens } from '@/lib/format'

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
