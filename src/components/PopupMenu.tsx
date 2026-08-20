import { useEffect, useRef } from 'react'

/**
 * Anchored popup list used by the command menu, @-mentions and pickers.
 * Handles outside-click dismissal and keeps the active row scrolled into view.
 *
 * `triggerRef` is what makes a click-toggled menu closeable. Without it the
 * trigger button counts as "outside": mousedown closes the menu, then the
 * button's own click re-opens it, so the menu never appears to close. Every
 * click-toggled caller must pass the ref of the element that toggles it.
 * (Menus opened by typing — `/`, `@` — have no trigger and can omit it.)
 */
export function PopupMenu({
  children,
  onClose,
  className,
  triggerRef,
}: {
  children: React.ReactNode
  onClose: () => void
  className?: string
  triggerRef?: React.RefObject<HTMLElement | null>
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (event: MouseEvent): void => {
      const target = event.target as Node
      if (ref.current?.contains(target)) return
      // The trigger toggles on click; letting mousedown close here first would
      // make that click a re-open.
      if (triggerRef?.current?.contains(target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('mousedown', handler)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', handler)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose, triggerRef])

  return (
    <div
      ref={ref}
      // Marks the subtree as no-drag (see .titlebar-drag in styles/index.css):
      // a menu opened from inside a window-drag region must stay clickable,
      // including its non-button rows (labels, separators).
      data-popup-menu
      className={`border-border bg-surface-raised z-30 overflow-hidden rounded-xl border shadow-lg ${className ?? ''}`}
    >
      {children}
    </div>
  )
}

export function MenuRow({
  active,
  disabled,
  onClick,
  onHover,
  title,
  children,
}: {
  active: boolean
  /**
   * Renders the row inert: no click, no hover highlight, dimmed. Callers must
   * also skip disabled rows in their own ↑/↓ handling — this only stops the
   * pointer.
   */
  disabled?: boolean
  onClick: () => void
  onHover?: () => void
  title?: string
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <button
      ref={ref}
      onMouseMove={disabled ? undefined : onHover}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors ${
        disabled
          ? 'cursor-not-allowed opacity-45'
          : `cursor-pointer ${active ? 'bg-bg-secondary' : 'hover:bg-bg-secondary'}`
      }`}
    >
      {children}
    </button>
  )
}
