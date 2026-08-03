import { useEffect, useRef } from 'react'

/**
 * Anchored popup list used by the command menu, @-mentions and pickers.
 * Handles outside-click dismissal and keeps the active row scrolled into view.
 */
export function PopupMenu({
  children,
  onClose,
  className,
}: {
  children: React.ReactNode
  onClose: () => void
  className?: string
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className={`border-border bg-surface-raised z-30 overflow-hidden rounded-xl border shadow-lg ${className ?? ''}`}
    >
      {children}
    </div>
  )
}

export function MenuRow({
  active,
  onClick,
  onHover,
  children,
}: {
  active: boolean
  onClick: () => void
  onHover?: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <button
      ref={ref}
      onMouseMove={onHover}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors ${
        active ? 'bg-bg-secondary' : ''
      }`}
    >
      {children}
    </button>
  )
}
