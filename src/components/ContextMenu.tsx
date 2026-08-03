import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'

export interface ContextMenuItem {
  label: string
  danger?: boolean
  separatorAbove?: boolean
  disabled?: boolean
  onClick: () => void
}

interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

/** Imperative context menu — call show() from onContextMenu handlers. */
let showMenu: ((state: ContextMenuState) => void) | null = null

export function showContextMenu(event: React.MouseEvent, items: ContextMenuItem[]): void {
  event.preventDefault()
  event.stopPropagation()
  showMenu?.({ x: event.clientX, y: event.clientY, items })
}

export function ContextMenuHost(): React.JSX.Element | null {
  const [state, setState] = useState<ContextMenuState | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    showMenu = setState
    return () => {
      showMenu = null
    }
  }, [])

  useEffect(() => {
    if (!state) return
    const close = (): void => setState(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', handleOutside)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    function handleOutside(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    return () => {
      window.removeEventListener('mousedown', handleOutside)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [state])

  if (!state) return null

  // Clamp to viewport.
  const menuWidth = 220
  const itemHeight = 30
  const height = state.items.length * itemHeight + 12
  const x = Math.min(state.x, window.innerWidth - menuWidth - 8)
  const y = Math.min(state.y, window.innerHeight - height - 8)

  return createPortal(
    <div
      ref={ref}
      className="border-border bg-surface-raised fixed z-50 w-[220px] rounded-xl border py-1.5 shadow-xl"
      style={{ left: x, top: y }}
    >
      {state.items.map((item, index) => (
        <div key={index}>
          {item.separatorAbove && <div className="border-border my-1 border-t" />}
          <button
            disabled={item.disabled}
            onClick={() => {
              setState(null)
              item.onClick()
            }}
            className={clsx(
              'flex w-full items-center px-3 py-1.5 text-left text-[13px] transition-colors disabled:opacity-40',
              item.danger ? 'text-danger hover:bg-danger-soft' : 'hover:bg-bg-secondary',
            )}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}
