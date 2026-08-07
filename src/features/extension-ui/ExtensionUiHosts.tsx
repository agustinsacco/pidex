import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { useExtensionUiStore, type PendingDialog, type Toast } from '@/stores/extensionUi'
import { CloseIcon } from '@/components/icons'

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
      <div className="border-border bg-surface-raised w-[480px] max-w-[92vw] overflow-hidden rounded-xl border shadow-2xl">
        <div className="border-border border-b px-4 py-3">
          <div className="text-[13.5px] font-semibold">{request.title}</div>
          <div className="text-text-tertiary mt-0.5 text-[11px]">Requested by a pi extension</div>
        </div>

        {request.method === 'select' && (
          <div className="max-h-72 overflow-y-auto py-1.5">
            {request.options.map((option, index) => (
              <button
                key={option}
                onMouseMove={() => setSelectedIndex(index)}
                onClick={() => resolve({ value: option })}
                className={clsx(
                  'flex w-full items-center px-4 py-2 text-left text-[13px] transition-colors',
                  index === selectedIndex && 'bg-bg-secondary',
                )}
              >
                {option}
              </button>
            ))}
          </div>
        )}

        {request.method === 'confirm' && (
          <div className="px-4 py-3 text-[13px]">{request.message}</div>
        )}

        {request.method === 'input' && (
          <div className="px-4 py-3">
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') resolve({ value })
              }}
              placeholder={request.placeholder}
              className="border-border bg-surface text-text placeholder:text-text-tertiary w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:border-[var(--px-border-strong)]"
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
              className="border-border bg-code-bg text-text w-full resize-y rounded-lg border px-3 py-2 font-mono text-[12.5px] outline-none focus:border-[var(--px-border-strong)]"
            />
          </div>
        )}

        <div className="border-border flex justify-end gap-2 border-t px-4 py-2.5">
          <button
            onClick={() => resolve({ cancelled: true })}
            className="border-border hover:bg-bg-secondary rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors"
          >
            Cancel
          </button>
          {request.method === 'confirm' && (
            <>
              <button
                onClick={() => resolve({ confirmed: false })}
                className="border-border hover:bg-bg-secondary rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors"
              >
                No
              </button>
              <button
                onClick={() => resolve({ confirmed: true })}
                className="bg-accent hover:bg-accent-hover text-accent-text rounded-md px-3.5 py-1.5 text-[12px] font-medium transition-colors"
              >
                Yes
              </button>
            </>
          )}
          {(request.method === 'input' || request.method === 'editor') && (
            <button
              onClick={() => resolve({ value })}
              className="bg-accent hover:bg-accent-hover text-accent-text rounded-md px-3.5 py-1.5 text-[12px] font-medium transition-colors"
            >
              Submit
            </button>
          )}
          {request.method === 'select' && (
            <button
              onClick={() => resolve({ value: request.options[selectedIndex] })}
              className="bg-accent hover:bg-accent-hover text-accent-text rounded-md px-3.5 py-1.5 text-[12px] font-medium transition-colors"
            >
              Choose
            </button>
          )}
        </div>
      </div>
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
      <span className="text-text min-w-0 flex-1 text-[12.5px] leading-snug">{toast.message}</span>
      <button
        onClick={() => useExtensionUiStore.getState().dismissToast(toast.id)}
        className="text-text-tertiary hover:text-text shrink-0"
      >
        <CloseIcon size={11} strokeWidth={2.5} />
      </button>
    </div>
  )
}

/** Status strip entries for a session (extension setStatus). */
export function StatusStrip({ sessionId }: { sessionId: string }): React.JSX.Element | null {
  const statuses = useExtensionUiStore((s) => s.statuses[sessionId])
  if (!statuses || Object.keys(statuses).length === 0) return null
  return (
    <div className="border-border bg-bg-secondary/60 flex h-6 shrink-0 items-center gap-3 overflow-x-auto border-t px-3">
      {Object.entries(statuses).map(([key, text]) => (
        <span
          key={key}
          className="text-text-tertiary flex shrink-0 items-center gap-1.5 text-[10.5px]"
        >
          <span className="bg-info h-1.5 w-1.5 rounded-full" />
          {text}
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
          className="border-border bg-bg-secondary/70 rounded-lg border px-3 py-1.5 font-mono text-[11px] leading-relaxed"
        >
          {widget.lines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap">
              {line}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
