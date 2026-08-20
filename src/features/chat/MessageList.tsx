import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { MessageItemView } from './MessageItem'
import { TranscriptSkeleton } from './TranscriptSkeleton'
import { useSessionsStore } from '@/stores/sessions'
import {
  isFollowIntent,
  isScrollBackIntent,
  isScrollBackKey,
  nextPinnedState,
} from './items/autoscroll'
import { spacingFor } from './items/spacing'
import { activeActivityId, buildTranscriptRows } from './items/transcriptRows'

export const MessageList = memo(function MessageList({
  sessionId,
}: {
  sessionId: string
}): React.JSX.Element {
  const items = useChatStore((s) => s.sessions[sessionId]?.items) ?? []
  const tools = useChatStore((s) => s.sessions[sessionId]?.tools) ?? {}
  const isStreaming = useChatStore((s) => s.sessions[sessionId]?.isStreaming ?? false)
  const error = useChatStore((s) => s.sessions[sessionId]?.error ?? null)
  const resuming = useChatStore((s) => s.sessions[sessionId]?.resuming ?? false)
  // Explains WHY we are loading when the user reopens a suspended session.
  const wasSuspended = useSessionsStore((s) => {
    const diskPath = s.live[sessionId]?.diskPath
    return diskPath ? s.suspendedPaths.includes(diskPath) : false
  })
  const hideThinking = useSettingsStore((s) => s.hideThinkingBlock)

  const scrollRef = useRef<HTMLDivElement>(null)
  /**
   * `pinnedRef` is the source of truth and is written *synchronously*; `pinned`
   * state exists only to render the jump-to-bottom affordance. Reading the pin
   * state from React state alone lost the race that made scrolling up during a
   * stream impossible: between the wheel event and React's re-render, a
   * streaming render could still see "pinned" and slam the view back down.
   */
  const pinnedRef = useRef(true)
  const [pinned, setPinned] = useState(true)
  /** Last observed scrollHeight, to tell re-measurement apart from user scrolls. */
  const lastHeightRef = useRef(0)
  /** Set while our own scroll is in flight, so its scroll event isn't read as intent. */
  const selfScrollRef = useRef(false)

  /**
   * Activity is grouped ACROSS assistant messages (pi emits one message per
   * tool call), so the virtualizer measures rows, not raw items.
   */
  const rows = useMemo(() => buildTranscriptRows(items), [items])
  const activeActivity = activeActivityId(rows, isStreaming)

  const setPinnedNow = useCallback((next: boolean): void => {
    pinnedRef.current = next
    setPinned((current) => (current === next ? current : next))
  }, [])

  const scrollToBottom = useCallback((el: HTMLElement): void => {
    selfScrollRef.current = true
    el.scrollTop = el.scrollHeight
    lastHeightRef.current = el.scrollHeight
    requestAnimationFrame(() => {
      selfScrollRef.current = false
    })
  }, [])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    /*
     * Unmeasured-row height. Measured in the e2e harness (see "rows are dense
     * and sit flush"): a collapsed tool row's wrapper is ~36px after the
     * spacing refactor, and prose turns are taller. This value only affects
     * rows that have never been rendered — dynamic measurement corrects each
     * row as it mounts, which the harness confirms (gaps stay ~0.1px), so the
     * estimate matters for scrollbar proportions, not for layout gaps.
     */
    estimateSize: () => 40,
    overscan: 8,
    getItemKey: (index) => rows[index]?.id ?? index,
  })

  // Follow the stream while pinned. Deliberately dep-less (content grows on
  // every token) but deferred to the next frame so it lands after the
  // virtualizer's measurement pass instead of racing it.
  useEffect(() => {
    if (!pinnedRef.current) return
    const el = scrollRef.current
    if (!el) return
    const frame = requestAnimationFrame(() => {
      if (!pinnedRef.current) return
      scrollToBottom(el)
    })
    return () => cancelAnimationFrame(frame)
  })

  // Explicit "read back" gestures unpin immediately, before any geometry is
  // consulted — during a stream the geometry is unreliable by definition.
  //
  // Attached via a callback ref rather than an effect: the empty-transcript
  // branch below returns a different tree, so on first render there is no
  // scroll element for an effect to find, and a mount-only effect would never
  // attach anything.
  const detachRef = useRef<(() => void) | null>(null)
  const attachScroller = useCallback(
    (el: HTMLDivElement | null): void => {
      detachRef.current?.()
      detachRef.current = null
      scrollRef.current = el
      if (!el) return

      // Unpinning a transcript that doesn't overflow strands the view: no
      // scroll events can ever fire to re-pin it, so the next long answer
      // streams below the fold unfollowed.
      const unpin = (): void => {
        if (el.scrollHeight > el.clientHeight) setPinnedNow(false)
      }
      const onWheel = (event: WheelEvent): void => {
        if (isScrollBackIntent(event.deltaY)) unpin()
        // Wheel-down at the bottom re-pins directly: the geometry path can
        // hold the landing sample as layout during a stream (see autoscroll).
        else if (isFollowIntent(event.deltaY, el.scrollHeight - el.scrollTop - el.clientHeight)) {
          setPinnedNow(true)
        }
      }
      const onKeyDown = (event: KeyboardEvent): void => {
        if (isScrollBackKey(event.key)) unpin()
      }
      // Scrollbar-thumb drags emit only scroll events, which the follow
      // effect's self-scroll mask can eat during a fast stream. A press in
      // the scrollbar gutter (right of the content box) IS read-back intent.
      const onPointerDown = (event: PointerEvent): void => {
        if (event.offsetX >= el.clientWidth) unpin()
      }
      el.addEventListener('wheel', onWheel, { passive: true })
      el.addEventListener('touchmove', unpin, { passive: true })
      el.addEventListener('keydown', onKeyDown)
      el.addEventListener('pointerdown', onPointerDown)
      detachRef.current = () => {
        el.removeEventListener('wheel', onWheel)
        el.removeEventListener('touchmove', unpin)
        el.removeEventListener('keydown', onKeyDown)
        el.removeEventListener('pointerdown', onPointerDown)
      }
    },
    [setPinnedNow],
  )

  const handleScroll = useCallback((): void => {
    const el = scrollRef.current
    if (!el) return
    // Our own follow-the-tail scroll produces a scroll event too; reading it as
    // user intent is what re-pinned the view immediately after an unpin.
    if (selfScrollRef.current) {
      lastHeightRef.current = el.scrollHeight
      return
    }
    const heightChanged = el.scrollHeight !== lastHeightRef.current
    lastHeightRef.current = el.scrollHeight
    setPinnedNow(
      nextPinnedState(pinnedRef.current, {
        distanceFromBottom: el.scrollHeight - el.scrollTop - el.clientHeight,
        heightChanged,
      }),
    )
  }, [setPinnedNow])

  const jumpToBottom = useCallback((): void => {
    const el = scrollRef.current
    if (!el) return
    setPinnedNow(true)
    scrollToBottom(el)
  }, [scrollToBottom, setPinnedNow])

  // Sending a message is follow intent: the user's own bubble (and the reply)
  // must not stream off-screen because they had scrolled up beforehand.
  const lastItemIdRef = useRef<string | null>(null)
  useEffect(() => {
    const last = items.at(-1)
    const previousId = lastItemIdRef.current
    lastItemIdRef.current = last?.id ?? null
    if (!last || last.id === previousId) return
    if (last.kind === 'user' && last.optimistic) jumpToBottom()
  }, [items, jumpToBottom])

  // Resuming a session with history: skeleton, not the empty state.
  if (items.length === 0 && !error && resuming) {
    return (
      <TranscriptSkeleton
        message={
          wasSuspended
            ? 'Resuming — the process was released to save memory. Replaying history…'
            : 'Restoring this session from disk…'
        }
      />
    )
  }

  if (items.length === 0 && !error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="text-text-secondary text-2xl font-medium tracking-tight">
            Describe a task to begin
          </div>
          <div className="text-text-tertiary mt-1.5 text-lg">
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
      {/* tabIndex makes the scroller focusable so PageUp/ArrowUp/Home actually
          reach the keydown unpin listener (a plain div never receives keys). */}
      <div
        ref={attachScroller}
        onScroll={handleScroll}
        data-testid="transcript-scroll"
        tabIndex={-1}
        className="h-full overflow-y-auto outline-none"
      >
        <div
          className="relative mx-auto w-full max-w-3xl px-6"
          style={{ height: virtualizer.getTotalSize() + 32 }}
        >
          {virtualItems.map((virtualItem) => {
            const row = rows[virtualItem.index]
            if (!row) return null
            const previous = rows[virtualItem.index - 1]
            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                className="absolute left-6 right-6 top-0"
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                {/*
                 * Spacing must live INSIDE the measured element — the
                 * virtualizer measures this node, so padding applied outside
                 * it would desync the computed offsets.
                 */}
                <div
                  className={`${spacingFor(previous)} ${
                    row.kind === 'text' && previous?.kind === 'activity'
                      ? 'activity-response-enter'
                      : ''
                  }`}
                >
                  <MessageItemView
                    row={row}
                    tools={tools}
                    hideThinking={hideThinking}
                    sessionId={sessionId}
                    activityActive={row.kind === 'activity' && row.id === activeActivity}
                  />
                </div>
              </div>
            )
          })}
        </div>
        {error && (
          <div className="mx-auto max-w-3xl px-6 pb-4">
            <div className="bg-danger-soft border-danger/25 rounded-lg border px-4 py-3">
              <div className="text-danger text-lg font-medium">Session error</div>
              <div className="text-text-secondary mt-0.5 text-lg">{error}</div>
            </div>
          </div>
        )}
        <div className="h-2" />
      </div>

      {!pinned && (
        <button
          onClick={jumpToBottom}
          className="border-border bg-surface text-text-secondary hover:text-text absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-1.5 text-base font-medium shadow-md transition-colors"
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
          {/* Imperative: this labels the action the click performs, never the
              current state (the pill only shows while NOT following). */}
          {isStreaming ? 'Follow stream' : 'Jump to bottom'}
        </button>
      )}
    </div>
  )
})
