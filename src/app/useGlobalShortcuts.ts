import { useEffect } from 'react'
import { useLayoutStore } from '@/stores/layout'
import { useSessionsStore } from '@/stores/sessions'
import { getActiveWorkspace } from '@/stores/workspaces'
import { useFinderStore } from '@/features/files/FuzzyFinder'
import { useSettingsUiStore } from '@/features/settings/settingsUiStore'

/**
 * True when the event target is a text-entry surface (composer, Monaco,
 * rename fields…). Single-letter shortcuts must not fire there — typing "n"
 * in the composer should not open a new session.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if (el.isContentEditable) return true
  // Monaco renders into a contenteditable host with this class.
  return el.closest?.('.monaco-editor, [role="textbox"]') !== null
}

/**
 * App-wide keyboard shortcuts.
 *
 * Uses `event.code` for the punctuation bindings: `event.key` is
 * layout- and modifier-dependent, so Ctrl+~ arrives as "~" rather than "`"
 * and a `key === '\`'` test silently never matches.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod) return

      // Backquote: toggle terminal. Accept the shifted (~) form too, and
      // match on physical key so keyboard layout doesn't matter.
      if (event.code === 'Backquote') {
        event.preventDefault()
        useLayoutStore.getState().toggleRightPane('terminal')
        return
      }

      if (event.code === 'Comma') {
        event.preventDefault()
        useSettingsUiStore.getState().setOpen(true)
        return
      }

      // Letter shortcuts: never steal keys from a text field.
      if (isEditableTarget(event.target)) return

      switch (event.code) {
        case 'KeyB':
          event.preventDefault()
          useLayoutStore.getState().toggleSidebar()
          break
        case 'KeyN':
          event.preventDefault()
          useSessionsStore.getState().activate(null)
          break
        case 'KeyP':
          event.preventDefault()
          if (getActiveWorkspace()) {
            useFinderStore.getState().setOpen(true)
          }
          break
        // ⌘K is owned by CommandPalette's own listener (it must also work
        // while the palette input has focus), so it is deliberately absent.
        case 'KeyE':
          if (!event.shiftKey) return
          event.preventDefault()
          useLayoutStore.getState().toggleRightPane('files')
          break
        case 'KeyG':
          if (!event.shiftKey) return
          event.preventDefault()
          useLayoutStore.getState().toggleRightPane('changes')
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
