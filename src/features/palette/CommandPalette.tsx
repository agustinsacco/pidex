import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { fuzzyFilter } from '@/lib/fuzzy'
import { MenuRow } from '@/components/PopupMenu'
import { useLayoutStore } from '@/stores/layout'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useWorkspacesStore } from '@/stores/workspaces'
import { useSettingsUiStore } from '@/features/settings/SettingsModal'
import { useFinderStore } from '@/features/files/FuzzyFinder'

interface PaletteState {
  open: boolean
  setOpen: (open: boolean) => void
}

export const usePaletteStore = create<PaletteState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))

interface PaletteAction {
  id: string
  label: string
  hint?: string
  run: () => void
}

export function CommandPalette({
  workspacePath,
}: {
  workspacePath: string
}): React.JSX.Element | null {
  const open = usePaletteStore((s) => s.open)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault()
        usePaletteStore.getState().setOpen(!usePaletteStore.getState().open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  const actions = useMemo<PaletteAction[]>(() => {
    const layout = useLayoutStore.getState()
    const sessions = useSessionsStore.getState()
    const disk = sessions.disk[workspacePath] ?? []
    const recents = useWorkspacesStore.getState().recents

    const base: PaletteAction[] = [
      { id: 'new-session', label: 'New session', hint: '⌘N', run: () => sessions.activate(null) },
      {
        id: 'go-to-file',
        label: 'Go to file…',
        hint: '⌘P',
        run: () => useFinderStore.getState().setOpen(true),
      },
      {
        id: 'toggle-sidebar',
        label: 'Toggle sidebar',
        hint: '⌘B',
        run: () => layout.toggleSidebar(),
      },
      {
        id: 'toggle-files',
        label: 'Toggle files pane',
        hint: '⌘⇧E',
        run: () => layout.toggleRightPane('files'),
      },
      {
        id: 'toggle-changes',
        label: 'Toggle changes pane',
        hint: '⌘⇧G',
        run: () => layout.toggleRightPane('changes'),
      },
      {
        id: 'toggle-terminal',
        label: 'Toggle terminal',
        hint: '⌘`',
        run: () => layout.toggleRightPane('terminal'),
      },
      {
        id: 'toggle-artifacts',
        label: 'Toggle artifacts pane',
        run: () => layout.toggleRightPane('artifacts'),
      },
      {
        id: 'settings',
        label: 'Open settings',
        hint: '⌘,',
        run: () => useSettingsUiStore.getState().setOpen(true),
      },
      {
        id: 'theme-light',
        label: 'Theme: light',
        run: () => useSettingsStore.getState().setTheme('light'),
      },
      {
        id: 'theme-dark',
        label: 'Theme: dark',
        run: () => useSettingsStore.getState().setTheme('dark'),
      },
      {
        id: 'theme-system',
        label: 'Theme: system',
        run: () => useSettingsStore.getState().setTheme('system'),
      },
      {
        id: 'open-folder',
        label: 'Open workspace folder…',
        run: () => void useWorkspacesStore.getState().pickAndOpen(),
      },
    ]

    for (const workspace of recents.filter((w) => w.path !== workspacePath).slice(0, 5)) {
      base.push({
        id: `ws-${workspace.path}`,
        label: `Switch workspace: ${workspace.name}`,
        hint: workspace.path,
        run: () => {
          useWorkspacesStore.getState().openWorkspace(workspace.path)
          sessions.activate(null)
        },
      })
    }

    for (const meta of disk.slice(0, 8)) {
      base.push({
        id: `session-${meta.path}`,
        label: `Open session: ${meta.name || meta.firstUserText || 'Untitled'}`,
        run: () => void sessions.openDiskSession(workspacePath, meta),
      })
    }

    return base
  }, [workspacePath, open])

  const matches = useMemo(() => fuzzyFilter(query, actions, (a) => a.label, 12), [query, actions])

  if (!open) return null
  const close = (): void => usePaletteStore.getState().setOpen(false)

  const run = (action: PaletteAction): void => {
    close()
    action.run()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[16vh] backdrop-blur-[2px]"
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="border-border bg-surface-raised w-[560px] overflow-hidden rounded-xl border shadow-2xl"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActiveIndex(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActiveIndex((i) => (i + 1) % Math.max(1, matches.length))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActiveIndex((i) => (i - 1 + matches.length) % Math.max(1, matches.length))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const action = matches[activeIndex]
              if (action) run(action)
            }
          }}
          placeholder="Type a command…"
          className="text-text placeholder:text-text-tertiary border-border block w-full border-b bg-transparent px-4 py-3 text-[14px] outline-none"
        />
        <div className="max-h-80 overflow-y-auto py-1">
          {matches.map((action, index) => (
            <MenuRow
              key={action.id}
              active={index === activeIndex}
              onHover={() => setActiveIndex(index)}
              onClick={() => run(action)}
            >
              <span className="min-w-0 flex-1 truncate text-[13px]">{action.label}</span>
              {action.hint && (
                <span className="text-text-tertiary shrink-0 font-mono text-[10.5px]">
                  {action.hint}
                </span>
              )}
            </MenuRow>
          ))}
          {matches.length === 0 && (
            <div className="text-text-tertiary px-4 py-4 text-center text-[12.5px]">
              No matching commands
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
