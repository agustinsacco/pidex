import { useEffect, useState } from 'react'
import { useChatStore } from '@/stores/chat'

export function RetryStrip({ sessionId }: { sessionId: string }): React.JSX.Element | null {
  const retry = useChatStore((s) => s.sessions[sessionId]?.retry)
  const [remaining, setRemaining] = useState(0)

  useEffect(() => {
    if (!retry) return
    const startedAt = Date.now()
    setRemaining(retry.delayMs)
    const interval = setInterval(() => {
      const left = Math.max(0, retry.delayMs - (Date.now() - startedAt))
      setRemaining(left)
    }, 250)
    return () => clearInterval(interval)
  }, [retry])

  if (!retry) return null

  const cancel = async (): Promise<void> => {
    await window.pidex.piCommand(sessionId, { type: 'abort_retry' })
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-1 pb-2">
      <div className="bg-warning/10 border-warning/30 flex items-center gap-2.5 rounded-lg border px-3 py-2 text-[12.5px]">
        <svg
          className="text-warning h-3.5 w-3.5 shrink-0 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path
            className="opacity-90"
            fill="currentColor"
            d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2z"
          />
        </svg>
        <span className="text-text">
          Retrying ({retry.attempt}/{retry.maxAttempts})
          {remaining > 0 ? ` in ${Math.ceil(remaining / 1000)}s` : '…'}
        </span>
        <span className="text-text-tertiary flex-1 truncate" title={retry.errorMessage}>
          {retry.errorMessage}
        </span>
        <button
          onClick={() => void cancel()}
          className="text-text-secondary hover:text-danger shrink-0 text-[12px] font-medium transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
