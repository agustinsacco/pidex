import clsx from 'clsx'
import { useState } from 'react'
import { useExtensionUiStore } from '@/stores/extensionUi'
import { useSessionsStore } from '@/stores/sessions'
import { waitingLabel, type InboxItem } from './inbox'

/**
 * The "needs you" list.
 *
 * Answering happens here, in place: a question's real options render as
 * buttons and the reply goes back over the same `pi:extensionUiResponse`
 * channel the modal dialog host uses. The point is not to open the session.
 */
export function FleetInbox({ items }: { items: InboxItem[] }): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <section className="mb-6" data-testid="fleet-inbox">
      <SectionLabel>Needs you</SectionLabel>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <InboxCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  )
}

function InboxCard({ item }: { item: InboxItem }): React.JSX.Element {
  const [answered, setAnswered] = useState(false)
  const waiting = waitingLabel(item.waitingMs)

  const answer = (value: string | boolean): void => {
    if (!item.sessionId || !item.requestId) return
    setAnswered(true)
    useExtensionUiStore.getState().resolveDialog(
      {
        sessionId: item.sessionId,
        // resolveDialog only reads `sessionId` and `request.id`, so a minimal
        // request stands in for the one the modal host would have held.
        request: {
          type: 'extension_ui_request',
          id: item.requestId,
          method: 'input',
          title: item.title,
        },
      },
      typeof value === 'boolean' ? { confirmed: value } : { value },
    )
  }

  const open = (): void => {
    if (item.sessionId) useSessionsStore.getState().activate(item.sessionId)
  }

  return (
    <div
      data-testid="inbox-item"
      data-kind={item.kind}
      className={clsx(
        'bg-surface rounded-xl border p-3',
        item.kind === 'question' ? 'border-warning/50' : 'border-border',
      )}
    >
      <div className="flex items-center gap-2 text-sm">
        <span
          className={clsx(
            'h-2 w-2 shrink-0 rounded-full',
            item.kind === 'question' && 'bg-warning',
            item.kind === 'error' && 'bg-error',
            item.kind === 'collision' && 'bg-warning',
            item.kind === 'digest' && 'bg-accent',
          )}
        />
        {item.detail && <span className="text-text-tertiary truncate">{item.detail}</span>}
        {waiting && <span className="text-text-tertiary ml-auto shrink-0">{waiting}</span>}
      </div>

      <p className="text-text mt-1.5 text-base">{item.title}</p>

      {item.kind === 'question' && !answered && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {item.confirm ? (
            <>
              <AnswerButton onClick={() => answer(true)}>Yes</AnswerButton>
              <AnswerButton onClick={() => answer(false)}>No</AnswerButton>
            </>
          ) : (
            (item.options ?? []).map((option) => (
              <AnswerButton key={option} onClick={() => answer(option)}>
                {option}
              </AnswerButton>
            ))
          )}
          {/* An input question has no options to offer, so the only honest
              affordance is to open the session and type the answer there. */}
          {!item.confirm && (item.options ?? []).length === 0 && (
            <AnswerButton onClick={open}>Open session to answer</AnswerButton>
          )}
        </div>
      )}

      {answered && <p className="text-text-tertiary mt-2 text-sm">Answered.</p>}

      {item.kind === 'error' && item.sessionId && (
        <div className="mt-2.5">
          <AnswerButton onClick={open}>Open session</AnswerButton>
        </div>
      )}
    </div>
  )
}

function AnswerButton({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="border-border hover:border-border-strong hover:bg-bg-secondary text-text rounded-md border px-2.5 py-1 text-sm transition-colors"
    >
      {children}
    </button>
  )
}

export function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="text-text-tertiary pb-1.5 text-xs font-semibold font-mono uppercase tracking-wider">
      {children}
    </div>
  )
}
