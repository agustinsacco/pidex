import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { MessageItemView } from './MessageItem'

export const MessageList = memo(function MessageList({
  sessionId,
}: {
  sessionId: string
}): React.JSX.Element {
  const items = useChatStore((s) => s.sessions[sessionId]?.items) ?? []
  const tools = useChatStore((s) => s.sessions[sessionId]?.tools) ?? {}
  const isStreaming = useChatStore((s) => s.sessions[sessionId]?.isStreaming ?? false)
  const error = useChatStore((s) => s.sessions[sessionId]?.error ?? null)
  const hideThinking = useSettingsStore((s) => s.hideThinkingBlock)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)
  const pinnedRef = useRef(true)
  pinnedRef.current = pinned

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 8,
    getItemKey: (index) => items[index]?.id ?? index,
  })

  // Follow the stream while pinned to the bottom.
  useEffect(() => {
    const el = scrollRef.current
    if (el && pinnedRef.current) {
      el.scrollTop = el.scrollHeight
    }
  })

  const handleScroll = useCallback((): void => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64
    setPinned(nearBottom)
  }, [])

  const jumpToBottom = useCallback((): void => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setPinned(true)
  }, [])

  if (items.length === 0 && !error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="font-serif text-text-secondary text-[22px]">Describe a task to begin</div>
          <div className="text-text-tertiary mt-1.5 text-[13px]">
            pi runs with full permissions in this workspace — markdown, diffs, diagrams and previews
            render right here.
          </div>
        </div>
      </div>
    )
  }

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div className="relative flex-1 overflow-hidden">
      <div ref={scrollRef} onScroll={handleScroll} className="h-full overflow-y-auto">
        <div
          className="relative mx-auto w-full max-w-3xl px-6"
          style={{ height: virtualizer.getTotalSize() + 32 }}
        >
          {virtualItems.map((virtualItem) => {
            const item = items[virtualItem.index]
            if (!item) return null
            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                className="absolute left-6 right-6 top-0"
                style={{ transform: `translateY(${virtualItem.start + 16}px)` }}
              >
                <div className="py-2">
                  <MessageItemView
                    item={item}
                    tools={tools}
                    hideThinking={hideThinking}
                    sessionId={sessionId}
                  />
                </div>
              </div>
            )
          })}
        </div>
        {error && (
          <div className="mx-auto max-w-3xl px-6 pb-4">
            <div className="bg-danger-soft border-danger/25 rounded-lg border px-4 py-3">
              <div className="text-danger text-[13px] font-medium">Session error</div>
              <div className="text-text-secondary mt-0.5 text-[13px]">{error}</div>
            </div>
          </div>
        )}
        <div className="h-2" />
      </div>

      {!pinned && (
        <button
          onClick={jumpToBottom}
          className="border-border bg-surface text-text-secondary hover:text-text absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium shadow-md transition-colors"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M12 5v14m7-7-7 7-7-7" />
          </svg>
          {isStreaming ? 'Following stream' : 'Jump to bottom'}
        </button>
      )}
    </div>
  )
})
