import { useEffect } from 'react'
import { clampUiScale } from '@shared/models'
import { useLayoutStore } from '@/stores/layout'
import { useSettingsStore } from '@/stores/settings'
import { useSessionsStore } from '@/stores/sessions'
import { getActiveWorkspace } from '@/stores/workspaces'
import { useFinderStore } from '@/features/files/FuzzyFinder'
import { useSettingsUiStore } from '@/features/settings/settingsUiStore'
import { useChatUiStore } from '@/features/chat/uiState'

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
 * Physical keys that change the UI scale, mapped to their step in percentage
 * points; 0 means "back to 100%". `Equal` is the unshifted ⌘+ key, and the
 * numpad forms are separate codes.
 */
const ZOOM_KEYS = new Map<string, number>([
  ['Equal', 10],
  ['NumpadAdd', 10],
  ['Minus', -10],
  ['NumpadSubtract', -10],
  ['Digit0', 0],
  ['Numpad0', 0],
])

function nudgeUiScale(stepPercent: number): void {
  const { fonts, setFonts } = useSettingsStore.getState()
  if (stepPercent === 0) {
    if (fonts.uiScale !== 1) setFonts({ uiScale: 1 })
    return
  }
  // Round through percent so a run of nudges lands on whole steps rather than
  // accumulating float drift (1.1 * … never quite equals 1.3).
  const next = clampUiScale((Math.round(fonts.uiScale * 100) + stepPercent) / 100)
  if (next !== fonts.uiScale) setFonts({ uiScale: next })
}

/**
 * The right pane only exists inside a session (`MainWithPanes` in App.tsx is
 * gated on `activeSessionId`). Toggling it from the home screen used to flip
 * store state with nothing rendered — invisible, and worse, it left the pane
 * "open" so the next press inside a session appeared to do nothing.
 */
export function canToggleRightPane(): boolean {
  return useSessionsStore.getState().activeSessionId !== null
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

      // ⌃O — expand or collapse every activity group in the session, Claude
      // Code's verbose-output toggle. Control specifically, on every platform,
      // and above the editable guard: you press it while reading, which is
      // while the composer holds focus.
      if (event.ctrlKey && !event.metaKey && event.code === 'KeyO') {
        event.preventDefault()
        const sessionId = useSessionsStore.getState().activeSessionId
        if (sessionId) useChatUiStore.getState().toggleVerbose(sessionId)
        return
      }

      // Backquote: toggle terminal. Accept the shifted (~) form too, and
      // match on physical key so keyboard layout doesn't matter. Deliberately
      // above the isEditableTarget guard: it must work while the composer has
      // focus, which is where you are when you want a terminal.
      if (event.code === 'Backquote') {
        event.preventDefault()
        if (canToggleRightPane()) useLayoutStore.getState().toggleRightPane('terminal')
        return
      }

      if (event.code === 'Comma') {
        event.preventDefault()
        useSettingsUiStore.getState().setOpen(true)
        return
      }

      // ⌘/ — the shortcut list itself, where every app that has one puts it.
      if (event.code === 'Slash') {
        event.preventDefault()
        useSettingsUiStore.getState().setTab('keybindings')
        useSettingsUiStore.getState().setOpen(true)
        return
      }

      // Zoom, in the places every other app puts it. Above the editable-target
      // guard on purpose: ⌘+ has to work while you are typing in the composer,
      // which is exactly when you notice the text is too small. Chromium's own
      // zoom accelerators are not wired up (the app is frameless with no menu
      // role for them), so these are the only bindings.
      if (ZOOM_KEYS.has(event.code)) {
        event.preventDefault()
        nudgeUiScale(ZOOM_KEYS.get(event.code)!)
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
          if (canToggleRightPane()) useLayoutStore.getState().toggleRightPane('files')
          break
        case 'KeyG':
          if (!event.shiftKey) return
          event.preventDefault()
          if (canToggleRightPane()) useLayoutStore.getState().toggleRightPane('changes')
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
