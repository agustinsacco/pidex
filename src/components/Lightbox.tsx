import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon } from '@/components/icons'

export function Lightbox({
  children,
  onClose,
}: {
  children: React.ReactNode
  onClose: () => void
}): React.JSX.Element {
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
      <button
        onClick={onClose}
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
        aria-label="Close"
      >
        <CloseIcon size={16} />
      </button>
    </div>,
    document.body,
  )
}
