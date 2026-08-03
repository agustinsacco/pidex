import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useChatStore } from '@/stores/chat'
import { useChatUiStore } from './uiState'

interface ForkCandidate {
  entryId: string
  text: string
}

/** Pick a past user message and fork the session from just before it. */
export function ForkPickerModal({ sessionId }: { sessionId: string }): React.JSX.Element | null {
  const open = useChatUiStore((s) => s.forkPickerFor === sessionId)
  const [candidates, setCandidates] = useState<ForkCandidate[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setCandidates(null)
    void window.pidex.piCommand(sessionId, { type: 'get_fork_messages' }).then((response) => {
      if (response.success && response.data) setCandidates(response.data.messages)
      else setCandidates([])
    })
  }, [open, sessionId])

  if (!open) return null
  const close = (): void => useChatUiStore.getState().closeForkPicker()

  const fork = async (candidate: ForkCandidate): Promise<void> => {
    setBusy(true)
    try {
      const response = await window.pidex.piCommand(sessionId, {
        type: 'fork',
        entryId: candidate.entryId,
      })
      if (!response.success) {
        useChatStore.getState().setError(sessionId, response.error)
        return
      }
      if (response.data?.cancelled) {
        useChatStore.getState().setError(sessionId, 'Fork was cancelled by an extension.')
        return
      }
      // Rebuild the transcript from the new branch point and prefill the
      // original prompt for edit-and-refork.
      const messages = await window.pidex.piCommand(sessionId, { type: 'get_messages' })
      if (messages.success && messages.data) {
        useChatStore.getState().hydrate(sessionId, messages.data.messages)
      }
      if (response.data?.text) {
        useChatUiStore.getState().setPrefill(sessionId, response.data.text)
      }
      close()
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={close}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="border-border bg-surface-raised max-h-[70vh] w-[540px] overflow-hidden rounded-xl border shadow-xl"
      >
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <div>
            <div className="text-[13.5px] font-semibold">Fork from an earlier message</div>
            <div className="text-text-tertiary text-[11.5px]">
              The conversation rewinds to just before the chosen message; its text is placed in the
              composer so you can edit and resend.
            </div>
          </div>
          <button onClick={close} className="text-text-tertiary hover:text-text">✕</button>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-2">
          {candidates === null && (
            <div className="text-text-tertiary animate-pulse px-3 py-6 text-center text-[12.5px]">Loading…</div>
          )}
          {candidates?.length === 0 && (
            <div className="text-text-tertiary px-3 py-6 text-center text-[12.5px]">
              No forkable user messages yet.
            </div>
          )}
          {candidates?.map((candidate, index) => (
            <button
              key={candidate.entryId}
              disabled={busy}
              onClick={() => void fork(candidate)}
              className="hover:bg-bg-secondary flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors disabled:opacity-50"
            >
              <span className="bg-bg-secondary text-text-tertiary mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold">
                {index + 1}
              </span>
              <span className="text-text line-clamp-2 text-[13px]">{candidate.text}</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
