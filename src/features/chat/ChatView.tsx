import { useEffect, useRef, useState } from 'react'
import { useSessionsStore } from '@/stores/sessions'
import { MessageList } from './MessageList'
import { Composer } from './Composer'

export function ChatView({ workspacePath }: { workspacePath: string }): React.JSX.Element {
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  const creating = useSessionsStore((s) => s.creating)
  const [createError, setCreateError] = useState<string | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current || activeSessionId) return
    startedRef.current = true
    useSessionsStore
      .getState()
      .createSession(workspacePath)
      .catch((error: Error) => setCreateError(error.message))
  }, [workspacePath, activeSessionId])

  const workspaceName = workspacePath.split(/[/\\]/).filter(Boolean).pop() ?? workspacePath

  if (createError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8">
        <div className="bg-danger-soft border-danger/30 max-w-lg rounded-lg border px-5 py-4">
          <div className="text-danger text-sm font-medium">Failed to start pi session</div>
          <div className="text-text-secondary mt-1 text-sm">{createError}</div>
        </div>
      </div>
    )
  }

  if (!activeSessionId || creating) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-text-tertiary animate-pulse text-sm">Starting pi session…</div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="titlebar-drag border-border flex h-11 shrink-0 items-center justify-center border-b">
        <div className="text-text-secondary text-[13px] font-medium">
          {workspaceName}
          <span className="text-text-tertiary"> · new session</span>
        </div>
      </header>
      <MessageList sessionId={activeSessionId} />
      <Composer sessionId={activeSessionId} />
    </div>
  )
}
