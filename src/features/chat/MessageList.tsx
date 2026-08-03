import { useEffect, useRef } from 'react'
import { useChatStore, type ChatItem } from '@/stores/chat'

export function MessageList({ sessionId }: { sessionId: string }): React.JSX.Element {
  const session = useChatStore((s) => s.sessions[sessionId])
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedToBottom = useRef(true)

  const items = session?.items ?? []
  const error = session?.error ?? null

  useEffect(() => {
    const el = scrollRef.current
    if (el && pinnedToBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  })

  const handleScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  if (items.length === 0 && !error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="font-serif text-text-secondary text-xl">Describe a task to begin</div>
          <div className="text-text-tertiary mt-1.5 text-sm">
            pi runs with full permissions in this workspace.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-6">
        {items.map((item) => (
          <MessageItem key={item.id} item={item} />
        ))}
        {error && (
          <div className="bg-danger-soft border-danger/30 rounded-lg border px-4 py-3">
            <div className="text-danger text-sm font-medium">Session error</div>
            <div className="text-text-secondary mt-0.5 text-sm">{error}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function MessageItem({ item }: { item: ChatItem }): React.JSX.Element {
  if (item.kind === 'user') {
    return (
      <div className="flex justify-end">
        <div className="bg-user-bubble max-w-[85%] whitespace-pre-wrap rounded-lg px-4 py-2.5 text-[14px]">
          {item.text}
        </div>
      </div>
    )
  }

  const failed = item.stopReason === 'error'
  const aborted = item.stopReason === 'aborted'

  return (
    <div className="max-w-full">
      <div
        className={`whitespace-pre-wrap text-[14px] leading-relaxed ${item.streaming ? 'streaming-cursor' : ''}`}
      >
        {item.text}
      </div>
      {failed && (
        <div className="bg-danger-soft border-danger/30 mt-2 rounded-md border px-3 py-2 text-sm">
          <span className="text-danger font-medium">Error: </span>
          <span className="text-text-secondary">{item.errorMessage ?? 'Unknown error'}</span>
        </div>
      )}
      {aborted && (
        <div className="text-text-tertiary mt-2 flex items-center gap-2 text-xs">
          <span className="bg-border h-px flex-1" />
          stopped
          <span className="bg-border h-px flex-1" />
        </div>
      )}
    </div>
  )
}
