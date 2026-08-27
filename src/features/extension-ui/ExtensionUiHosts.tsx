import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { useExtensionUiStore, type PendingDialog, type Toast } from '@/stores/extensionUi'
import { CloseIcon } from '@/components/icons'
import { ModalPanel } from '@/components/Modal'
import { Button, TextInput } from '@/components/form'
import { ansiToSpans, stripAnsi } from '@shared/ansi'
import { CONTEXT_BREAKDOWN_STATUS_KEY } from '@/features/chat/composer/contextBreakdown'
import { RATE_LIMIT_STATUS_KEY } from '@/features/chat/composer/rateLimit'

/**
 * Extension-authored text styled with ANSI SGR codes, rendered as colored
 * runs. pi extensions style for pi's own TUI; we honor foreground colors and
 * drop everything else rather than letting escape bytes reach the DOM.
 */
function AnsiText({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {ansiToSpans(text).map((span, i) =>
        span.color ? (
          <span key={i} style={{ color: span.color }}>
            {span.text}
          </span>
        ) : (
          <span key={i}>{span.text}</span>
        ),
      )}
    </>
  )
}

/** Modal host for extension dialogs (select / confirm / input / editor). */
export function ExtensionDialogHost(): React.JSX.Element | null {
  const dialog = useExtensionUiStore((s) => s.dialogs[0])
  if (!dialog) return null
  return <DialogSheet key={dialog.request.id} dialog={dialog} />
}

function DialogSheet({ dialog }: { dialog: PendingDialog }): React.JSX.Element {
  const { request } = dialog
  const [value, setValue] = useState(request.method === 'editor' ? (request.prefill ?? '') : '')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const resolve = (response: { value?: string; confirmed?: boolean; cancelled?: boolean }): void =>
    useExtensionUiStore.getState().resolveDialog(dialog, response)

  useEffect(() => {
    setTimeout(() => {
      inputRef.current?.focus()
      textareaRef.current?.focus()
    }, 30)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        resolve({ cancelled: true })
      }
      if (request.method === 'select') {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setSelectedIndex((i) => (i + 1) % request.options.length)
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          setSelectedIndex((i) => (i - 1 + request.options.length) % request.options.length)
        } else if (event.key === 'Enter') {
          event.preventDefault()
          resolve({ value: request.options[selectedIndex] })
        }
      }
      if (request.method === 'confirm') {
        if (event.key === 'Enter') {
          event.preventDefault()
          resolve({ confirmed: true })
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [request, selectedIndex])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <ModalPanel
        width={480}
        title={stripAnsi(request.title)}
        subtitle="Requested by a pi extension"
        footer={
          <>
            <Button onClick={() => resolve({ cancelled: true })}>Cancel</Button>
            {request.method === 'confirm' && (
              <>
                <Button onClick={() => resolve({ confirmed: false })}>No</Button>
                <Button variant="primary" onClick={() => resolve({ confirmed: true })}>
                  Yes
                </Button>
              </>
            )}
            {(request.method === 'input' || request.method === 'editor') && (
              <Button variant="primary" onClick={() => resolve({ value })}>
                Submit
              </Button>
            )}
            {request.method === 'select' && (
              <Button
                variant="primary"
                onClick={() => resolve({ value: request.options[selectedIndex] })}
              >
                Choose
              </Button>
            )}
          </>
        }
      >
        {request.method === 'select' && (
          <div className="max-h-72 overflow-y-auto py-1.5">
            {request.options.map((option, index) => (
              <button
                key={option}
                onMouseMove={() => setSelectedIndex(index)}
                onClick={() => resolve({ value: option })}
                className={clsx(
                  'flex w-full items-center px-4 py-2 text-left text-lg transition-colors',
                  index === selectedIndex && 'bg-bg-secondary',
                )}
              >
                {/* Display-only strip: the response echoes the raw option. */}
                {stripAnsi(option)}
              </button>
            ))}
          </div>
        )}

        {request.method === 'confirm' && (
          <div className="px-4 py-3 text-lg">{stripAnsi(request.message)}</div>
        )}

        {request.method === 'input' && (
          <div className="px-4 py-3">
            <TextInput
              ref={inputRef}
              size="lg"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') resolve({ value })
              }}
              placeholder={request.placeholder}
              className="w-full"
            />
          </div>
        )}

        {request.method === 'editor' && (
          <div className="px-4 py-3">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={10}
              className="border-border bg-code-bg text-text w-full resize-y rounded-lg border px-3 py-2 font-mono text-base outline-none focus:border-[var(--px-border-strong)]"
            />
          </div>
        )}
      </ModalPanel>
    </div>,
    document.body,
  )
}

/** Toast host (extension notify + app notices). */
export function ToastHost(): React.JSX.Element {
  const toasts = useExtensionUiStore((s) => s.toasts)
  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>,
    document.body,
  )
}

function ToastCard({ toast }: { toast: Toast }): React.JSX.Element {
  return (
    <div
      className={clsx(
        'toast-slide pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 shadow-lg',
        toast.kind === 'error'
          ? 'bg-danger-soft border-danger/30'
          : toast.kind === 'warning'
            ? 'bg-warning/10 border-warning/30'
            : 'bg-surface-raised border-border',
      )}
    >
      <span
        className={clsx(
          'mt-1 h-2 w-2 shrink-0 rounded-full',
          toast.kind === 'error'
            ? 'bg-danger'
            : toast.kind === 'warning'
              ? 'bg-warning'
              : 'bg-info',
        )}
      />
      <span className="text-text min-w-0 flex-1 text-base leading-snug">
        {stripAnsi(toast.message)}
      </span>
      <button
        onClick={() => useExtensionUiStore.getState().dismissToast(toast.id)}
        className="text-text-tertiary hover:text-text shrink-0"
      >
        <CloseIcon size={11} strokeWidth={2.5} />
      </button>
    </div>
  )
}

/**
 * Status keys this strip must not render: they carry structured payloads for a
 * specific component rather than a human-readable line. `setStatus` is pi's
 * only channel for pushing extension state to the front-end, so it doubles as
 * a data bus — a status the strip doesn't recognise as prose belongs to
 * whichever component parses it.
 */
const STRUCTURED_STATUS_KEYS = new Set([CONTEXT_BREAKDOWN_STATUS_KEY, RATE_LIMIT_STATUS_KEY])

/** Status strip entries for a session (extension setStatus). */
export function StatusStrip({ sessionId }: { sessionId: string }): React.JSX.Element | null {
  const statuses = useExtensionUiStore((s) => s.statuses[sessionId])
  if (!statuses) return null
  const entries = Object.entries(statuses).filter(([key]) => !STRUCTURED_STATUS_KEYS.has(key))
  if (entries.length === 0) return null
  return (
    <div className="border-border bg-bg-secondary/60 flex h-6 shrink-0 items-center gap-3 border-t px-3">
      {entries.map(([key, text]) => (
        <span
          key={key}
          title={stripAnsi(text)}
          className="text-text-tertiary flex min-w-0 items-center gap-1.5 text-xs"
        >
          <span className="bg-info h-1.5 w-1.5 shrink-0 rounded-full" />
          <span className="truncate">
            <AnsiText text={text} />
          </span>
        </span>
      ))}
    </div>
  )
}

/** Composer widget slots (extension setWidget). */
export function WidgetSlot({
  sessionId,
  placement,
}: {
  sessionId: string
  placement: 'aboveEditor' | 'belowEditor'
}): React.JSX.Element | null {
  const widgets = useExtensionUiStore((s) => s.widgets[sessionId])
  const entries = Object.entries(widgets ?? {}).filter(([, w]) => w.placement === placement)
  if (entries.length === 0) return null
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-1.5 px-1 pb-2">
      {entries.map(([key, widget]) => (
        <div
          key={key}
          className="border-border bg-bg-secondary/70 rounded-lg border px-3 py-1.5 font-mono text-sm leading-relaxed"
        >
          {widget.lines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap">
              <AnsiText text={line} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
