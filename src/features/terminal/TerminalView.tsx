import { memo, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { useSettingsStore } from '@/stores/settings'
import { useTerminalStore } from '@/stores/terminal'
import { xtermTheme } from './xtermTheme'

/** One xterm instance bound to a main-process PTY. */
export const TerminalView = memo(function TerminalView({
  ptyId,
  visible,
  workspacePath,
}: {
  ptyId: string
  visible: boolean
  workspacePath: string
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const resolvedTheme = useSettingsStore((s) => s.resolvedTheme)
  const fonts = useSettingsStore((s) => s.fonts)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const pendingPaste = useTerminalStore((s) => s.pendingPaste)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const initialFonts = useSettingsStore.getState().fonts
    const term = new Terminal({
      fontFamily: `${initialFonts.monoFont}, ui-monospace, SF Mono, Menlo, monospace`,
      fontSize: initialFonts.terminalFontSize,
      lineHeight: 1.25,
      scrollback: 10_000,
      cursorBlink: true,
      allowProposedApi: true,
      theme: xtermTheme(useSettingsStore.getState().resolvedTheme),
    })
    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        event.preventDefault()
        window.open(uri) // main denies + opens externally
      }),
    )
    term.open(container)
    fit.fit()
    termRef.current = term
    fitRef.current = fit
    searchRef.current = search

    // Renderer → PTY
    const dataDisposable = term.onData((data) => {
      void window.pidex.invoke('pty:write', ptyId, data)
    })
    // PTY → renderer
    const unsubscribeData = window.pidex.onPtyData(ptyId, (data) => term.write(data))
    const unsubscribeExit = window.pidex.onPtyExit(ptyId, (exitCode) => {
      term.write(`\r\n\x1b[2m[process exited with code ${exitCode}]\x1b[0m\r\n`)
      useTerminalStore.getState().markExited(workspacePath, ptyId)
    })

    // Resize plumbing (pane drags included).
    const sendResize = (): void => {
      void window.pidex.invoke('pty:resize', ptyId, term.cols, term.rows)
    }
    const observer = new ResizeObserver(() => {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        fit.fit()
        sendResize()
      }
    })
    observer.observe(container)
    sendResize()

    // Cmd/Ctrl+F opens in-pane search.
    term.attachCustomKeyEventHandler((event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'f' && event.type === 'keydown') {
        setSearchOpen(true)
        setTimeout(() => searchInputRef.current?.focus(), 30)
        return false
      }
      return true
    })

    // Right-click pastes (bracketed-paste aware).
    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault()
      void navigator.clipboard.readText().then((text) => {
        if (text) term.paste(text)
      })
    }
    container.addEventListener('contextmenu', onContextMenu)

    term.focus()

    return () => {
      observer.disconnect()
      container.removeEventListener('contextmenu', onContextMenu)
      dataDisposable.dispose()
      unsubscribeData()
      unsubscribeExit()
      term.dispose()
      termRef.current = null
    }
  }, [ptyId])

  // Live theme + font switching.
  useEffect(() => {
    const term = termRef.current
    if (term) term.options.theme = xtermTheme(resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontSize = fonts.terminalFontSize
    term.options.fontFamily = `${fonts.monoFont}, ui-monospace, SF Mono, Menlo, monospace`
    fitRef.current?.fit()
  }, [fonts])

  // Refit + focus when this tab becomes visible.
  useEffect(() => {
    if (visible) {
      setTimeout(() => {
        fitRef.current?.fit()
        termRef.current?.focus()
      }, 30)
    }
  }, [visible])

  // "Run in terminal" paste queue.
  useEffect(() => {
    if (visible && pendingPaste !== null && termRef.current) {
      const text = useTerminalStore.getState().consumePaste()
      if (text) {
        termRef.current.paste(text)
        termRef.current.focus()
      }
    }
  }, [pendingPaste, visible])

  const runSearch = (direction: 'next' | 'previous'): void => {
    if (!searchQuery) return
    if (direction === 'next') searchRef.current?.findNext(searchQuery)
    else searchRef.current?.findPrevious(searchQuery)
  }

  return (
    <div className={visible ? 'relative h-full min-h-0 w-full' : 'hidden'}>
      {searchOpen && (
        <div className="border-border bg-surface-raised absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg border p-1 shadow-md">
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch(e.shiftKey ? 'previous' : 'next')
              if (e.key === 'Escape') {
                setSearchOpen(false)
                termRef.current?.focus()
              }
            }}
            placeholder="Search…"
            className="text-text placeholder:text-text-tertiary w-40 bg-transparent px-2 py-0.5 text-[12px] outline-none"
          />
          <button
            onClick={() => runSearch('previous')}
            className="text-text-tertiary hover:text-text px-1 text-[11px]"
          >
            ↑
          </button>
          <button
            onClick={() => runSearch('next')}
            className="text-text-tertiary hover:text-text px-1 text-[11px]"
          >
            ↓
          </button>
          <button
            onClick={() => {
              setSearchOpen(false)
              termRef.current?.focus()
            }}
            className="text-text-tertiary hover:text-text px-1 text-[11px]"
          >
            ✕
          </button>
        </div>
      )}
      <div ref={containerRef} className="terminal-container h-full w-full" />
    </div>
  )
})
