import { useState } from 'react'
import clsx from 'clsx'
import type { FleetSession } from '@shared/models'
import { PiSpark } from '@/components/PiSpark'
import { useSessionsStore } from '@/stores/sessions'
import { useChatStore } from '@/stores/chat'
import { piCallOk } from '@/lib/rpc'

/**
 * One live session on the home screen: what it is doing, and a box to talk to
 * it without leaving this page.
 *
 * The composer routes by phase, which is the whole reason it can be a single
 * box: a running agent gets `steer` (interrupt now), a settled one gets a
 * plain `prompt`. Sending optimistically adds the message to that session's
 * transcript, so opening it later shows what was said.
 */
export function SessionCard({ session }: { session: FleetSession }): React.JSX.Element {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const send = async (): Promise<void> => {
    const message = text.trim()
    if (!message || busy) return
    setBusy(true)
    try {
      const streaming = session.phase === 'streaming'
      useChatStore.getState().addUserMessage(session.sessionId, message)
      const ok = await piCallOk(
        session.sessionId,
        streaming ? { type: 'steer', message } : { type: 'prompt', message },
      )
      if (ok) setText('')
    } finally {
      setBusy(false)
    }
  }

  const stop = (): void => {
    void piCallOk(session.sessionId, { type: 'abort' })
  }

  const open = (): void => {
    useSessionsStore.getState().activate(session.sessionId)
  }

  return (
    <div
      data-testid="fleet-session-card"
      data-phase={session.phase}
      className="border-border bg-surface rounded-xl border p-3"
    >
      <div className="flex items-center gap-2">
        <PhaseDot session={session} />
        <button
          onClick={open}
          className="text-text min-w-0 flex-1 truncate text-left text-base hover:underline"
        >
          {session.title ?? 'Untitled session'}
        </button>
        {session.currentTool && (
          <span className="text-text-tertiary shrink-0 font-mono text-xs">
            {session.currentTool}
          </span>
        )}
      </div>

      <p className="text-text-secondary mt-1.5 line-clamp-2 text-sm leading-relaxed">
        {session.pendingQuestion
          ? `Waiting on you: ${session.pendingQuestion.title}`
          : (session.lastLine ?? 'No output yet.')}
      </p>

      <div className="mt-2.5 flex items-center gap-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          disabled={busy}
          placeholder={session.phase === 'streaming' ? 'Steer this agent' : 'Reply without opening'}
          aria-label={`Message ${session.title ?? 'session'}`}
          className="border-border focus:border-border-focus bg-bg text-text placeholder:text-text-tertiary min-w-0 flex-1 rounded-md border px-2 py-1 text-sm outline-none transition-colors"
        />
        {session.phase === 'streaming' ? (
          <button
            onClick={stop}
            title="Stop this session"
            aria-label="Stop this session"
            className="border-border hover:border-border-strong hover:bg-bg-secondary text-text-secondary shrink-0 rounded-md border px-2 py-1 text-sm transition-colors"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={open}
            title="Open this session"
            aria-label="Open this session"
            className="border-border hover:border-border-strong hover:bg-bg-secondary text-text-secondary shrink-0 rounded-md border px-2 py-1 text-sm transition-colors"
          >
            Open
          </button>
        )}
      </div>
    </div>
  )
}

function PhaseDot({ session }: { session: FleetSession }): React.JSX.Element {
  if (session.phase === 'streaming') {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        <PiSpark size={13} />
      </span>
    )
  }
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
      <span
        className={clsx(
          'h-2 w-2 rounded-full',
          session.phase === 'awaiting-input' && 'bg-warning',
          session.phase === 'error' && 'bg-error',
          session.phase === 'idle' && 'border-success border',
          session.phase === 'exited' && 'border-border-strong border',
        )}
        title={session.phase}
      />
    </span>
  )
}
