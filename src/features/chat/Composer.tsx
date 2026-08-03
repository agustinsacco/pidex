import { useCallback, useRef, useState } from 'react'
import { useChatStore } from '@/stores/chat'

export function Composer({ sessionId }: { sessionId: string }): React.JSX.Element {
  const [text, setText] = useState('')
  const isStreaming = useChatStore((s) => s.sessions[sessionId]?.isStreaming ?? false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const send = useCallback(async () => {
    const message = text.trim()
    if (!message) return
    setText('')

    const chat = useChatStore.getState()
    chat.addUserMessage(sessionId, message)

    try {
      const response = await window.pidex.piCommand(sessionId, {
        type: 'prompt',
        message,
        // P0: no queueing UI yet; sending while streaming steers.
        ...(useChatStore.getState().sessions[sessionId]?.isStreaming
          ? { streamingBehavior: 'steer' as const }
          : {}),
      })
      if (!response.success) {
        chat.setError(sessionId, response.error)
      }
    } catch (error) {
      chat.setError(sessionId, (error as Error).message)
    }
  }, [sessionId, text])

  const stop = useCallback(async () => {
    try {
      await window.pidex.piCommand(sessionId, { type: 'abort' })
    } catch (error) {
      useChatStore.getState().setError(sessionId, (error as Error).message)
    }
  }, [sessionId])

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
    if (event.key === 'Escape' && isStreaming) {
      event.preventDefault()
      void stop()
    }
  }

  return (
    <div className="shrink-0 px-6 pb-5 pt-1">
      <div className="border-border bg-surface focus-within:border-border-strong mx-auto max-w-3xl rounded-lg border shadow-sm transition-colors">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe a task… (Enter to send, Shift+Enter for newline)"
          rows={Math.min(8, Math.max(1, text.split('\n').length))}
          className="text-text placeholder:text-text-tertiary block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[14px] outline-none"
        />
        <div className="flex items-center justify-between px-3 pb-2.5">
          <div className="text-text-tertiary text-xs">
            {isStreaming ? 'pi is working — Esc to stop' : ''}
          </div>
          {isStreaming ? (
            <button
              onClick={() => void stop()}
              className="border-border hover:border-danger hover:text-danger flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
            >
              <span className="bg-danger inline-block h-2 w-2 rounded-[3px]" />
              Stop
            </button>
          ) : (
            <button
              onClick={() => void send()}
              disabled={!text.trim()}
              className="bg-accent hover:bg-accent-hover text-accent-text rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
