// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ModalOverlay, useEscapeKey } from './Modal'

let root: Root | null = null
let container: HTMLDivElement | null = null

function render(ui: React.ReactNode): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(ui)
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
})

function pressEscape(): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
}

/** The portal renders into document.body, so query from there. */
function backdrop(): HTMLElement {
  const el = document.querySelector('.fixed.inset-0')
  if (!el) throw new Error('backdrop not rendered')
  return el as HTMLElement
}

describe('ModalOverlay', () => {
  it('renders its children into a portal on document.body', () => {
    render(
      <ModalOverlay onClose={() => {}}>
        <div data-testid="panel">hello</div>
      </ModalOverlay>,
    )
    const panel = document.querySelector('[data-testid="panel"]')
    expect(panel).not.toBeNull()
    expect(container!.contains(panel)).toBe(false)
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<ModalOverlay onClose={onClose}>panel</ModalOverlay>)
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores other keys', () => {
    const onClose = vi.fn()
    render(<ModalOverlay onClose={onClose}>panel</ModalOverlay>)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close on Escape when closeOnEscape is false', () => {
    const onClose = vi.fn()
    render(
      <ModalOverlay onClose={onClose} closeOnEscape={false}>
        panel
      </ModalOverlay>,
    )
    pressEscape()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes when the backdrop itself is clicked', () => {
    const onClose = vi.fn()
    render(<ModalOverlay onClose={onClose}>panel</ModalOverlay>)
    act(() => backdrop().click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does NOT close when a click originates inside the panel', () => {
    const onClose = vi.fn()
    render(
      <ModalOverlay onClose={onClose}>
        <button data-testid="inside">click me</button>
      </ModalOverlay>,
    )
    act(() => {
      ;(document.querySelector('[data-testid="inside"]') as HTMLElement).click()
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close on backdrop click when closeOnBackdrop is false', () => {
    const onClose = vi.fn()
    render(
      <ModalOverlay onClose={onClose} closeOnBackdrop={false}>
        panel
      </ModalOverlay>,
    )
    act(() => backdrop().click())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('applies the requested z-index and alignment', () => {
    render(
      <ModalOverlay onClose={() => {}} z={40} align="top">
        panel
      </ModalOverlay>,
    )
    expect(backdrop().className).toContain('z-40')
    expect(backdrop().className).toContain('items-start')
  })

  it('removes its keydown listener on unmount', () => {
    const onClose = vi.fn()
    render(<ModalOverlay onClose={onClose}>panel</ModalOverlay>)
    act(() => root!.unmount())
    pressEscape()
    expect(onClose).not.toHaveBeenCalled()
  })

  describe('nested modals', () => {
    it('closes only the innermost modal on Escape', () => {
      const closeOuter = vi.fn()
      const closeInner = vi.fn()
      render(
        <ModalOverlay onClose={closeOuter} z={40}>
          <div>outer</div>
          <ModalOverlay onClose={closeInner} z={50}>
            <div>inner</div>
          </ModalOverlay>
        </ModalOverlay>,
      )
      pressEscape()
      // Regression: the nested config editor used to have no handler at all, so
      // Escape closed the whole settings modal and discarded unsaved edits.
      expect(closeInner).toHaveBeenCalledTimes(1)
      expect(closeOuter).not.toHaveBeenCalled()
    })

    it('closes the outer modal once the inner one has unmounted', () => {
      const closeOuter = vi.fn()
      function Nested({ showInner }: { showInner: boolean }): React.JSX.Element {
        return (
          <ModalOverlay onClose={closeOuter} z={40}>
            {showInner && (
              <ModalOverlay onClose={() => {}} z={50}>
                inner
              </ModalOverlay>
            )}
          </ModalOverlay>
        )
      }
      render(<Nested showInner />)
      act(() => root!.render(<Nested showInner={false} />))
      pressEscape()
      expect(closeOuter).toHaveBeenCalledTimes(1)
    })
  })
})

describe('useEscapeKey', () => {
  function Probe({ onEscape, enabled }: { onEscape: () => void; enabled?: boolean }): null {
    useEscapeKey(onEscape, enabled)
    return null
  }

  it('fires on Escape when enabled', () => {
    const fn = vi.fn()
    render(<Probe onEscape={fn} />)
    pressEscape()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does nothing when disabled', () => {
    const fn = vi.fn()
    render(<Probe onEscape={fn} enabled={false} />)
    pressEscape()
    expect(fn).not.toHaveBeenCalled()
  })

  it('detaches on unmount', () => {
    const fn = vi.fn()
    render(<Probe onEscape={fn} />)
    act(() => root!.unmount())
    pressEscape()
    expect(fn).not.toHaveBeenCalled()
  })
})
