import { useEffect, useRef, useState } from 'react'
import { useSessionsStore } from '@/stores/sessions'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
import { SessionMenu } from './SessionMenu'

export function ChatView({ workspacePath }: { workspacePath: string }): React.JSX.Element {
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  const creating = useSessionsStore((s) => s.creating)
  const [createError, setCreateError] = useState<string | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current || activeSessionId) return
    startedRef.current = true
    void useSettingsStore.getState().loadAgentSettings(workspacePath)
    useSessionsStore
      .getState()
      .createSession(workspacePath)
      .catch((error: Error) => setCreateError(error.message))
  }, [workspacePath, activeSessionId])

  const workspaceName = workspacePath.split(/[/\\]/).filter(Boolean).pop() ?? workspacePath

  if (createError) {
    return (
      <div className="flex h-full flex-col">
        <div className="titlebar-drag h-11 shrink-0" />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8">
          <div className="bg-danger-soft border-danger/25 max-w-lg rounded-lg border px-5 py-4">
            <div className="text-danger text-sm font-medium">Failed to start pi session</div>
            <div className="text-text-secondary mt-1 text-sm">{createError}</div>
          </div>
        </div>
      </div>
    )
  }

  if (!activeSessionId || creating) {
    return (
      <div className="flex h-full flex-col">
        <div className="titlebar-drag h-11 shrink-0" />
        <div className="flex flex-1 items-center justify-center">
          <div className="text-text-tertiary animate-pulse text-sm">Starting pi session…</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <Header sessionId={activeSessionId} workspaceName={workspaceName} />
      <MessageList sessionId={activeSessionId} />
      <Composer sessionId={activeSessionId} workspacePath={workspacePath} />
    </div>
  )
}

function Header({
  sessionId,
  workspaceName,
}: {
  sessionId: string
  workspaceName: string
}): React.JSX.Element {
  const sessionName = useChatStore((s) => s.sessions[sessionId]?.meta?.sessionName)

  return (
    <header className="titlebar-drag flex h-11 shrink-0 items-center gap-2 pl-20 pr-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="text-text truncate text-[13px] font-semibold">
          {sessionName ?? 'New session'}
        </span>
        <span className="bg-bg-secondary text-text-secondary shrink-0 rounded-md px-2 py-0.5 text-[11.5px]">
          {workspaceName}
        </span>
      </div>
      <SessionMenu sessionId={sessionId} />
    </header>
  )
}
