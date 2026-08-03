import { create } from 'zustand'
import { DEFAULT_FONT_PREFS, type FontPrefs, type ThemePreference } from '@shared/models'

interface SettingsState {
  theme: ThemePreference
  resolvedTheme: 'light' | 'dark'
  /** From pi's settings.json — hide thinking blocks in chat. */
  hideThinkingBlock: boolean
  fonts: FontPrefs
  setTheme: (theme: ThemePreference) => void
  setFonts: (fonts: Partial<FontPrefs>) => void
  hydrate: () => Promise<void>
  loadAgentSettings: (workspacePath?: string) => Promise<void>
}

function applyFontsToDom(fonts: FontPrefs): void {
  const root = document.documentElement
  root.style.fontSize = `${fonts.uiScale * 100}%`
  root.style.setProperty(
    '--px-font-mono',
    `'${fonts.monoFont}', ui-monospace, 'SF Mono', Menlo, Monaco, 'Cascadia Code', monospace`,
  )
  root.style.setProperty('--px-chat-font-size', `${fonts.chatFontSize}px`)
  root.style.setProperty('--px-editor-font-size', `${fonts.editorFontSize}px`)
  root.style.setProperty('--px-terminal-font-size', `${fonts.terminalFontSize}px`)
}

function resolve(theme: ThemePreference): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyToDom(resolved: 'light' | 'dark'): void {
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      const { theme } = get()
      if (theme === 'system') {
        const resolved = resolve(theme)
        applyToDom(resolved)
        set({ resolvedTheme: resolved })
      }
    })

  return {
    theme: 'system',
    resolvedTheme: resolve('system'),
    hideThinkingBlock: false,
    fonts: DEFAULT_FONT_PREFS,

    loadAgentSettings: async (workspacePath) => {
      const settings = await window.pidex.invoke('pi:agentSettings', workspacePath)
      set({ hideThinkingBlock: settings.hideThinkingBlock === true })
    },

    setTheme: (theme) => {
      const resolved = resolve(theme)
      applyToDom(resolved)
      set({ theme, resolvedTheme: resolved })
      void window.pidex.invoke('app:setTheme', theme)
    },

    setFonts: (patch) => {
      const fonts = { ...get().fonts, ...patch }
      applyFontsToDom(fonts)
      set({ fonts })
      void window.pidex.invoke('app:setFontPrefs', fonts)
    },

    hydrate: async () => {
      const prefs = await window.pidex.invoke('app:getPrefs')
      const resolved = resolve(prefs.theme)
      applyToDom(resolved)
      applyFontsToDom(prefs.fonts)
      set({ theme: prefs.theme, resolvedTheme: resolved, fonts: prefs.fonts })
    },
  }
})
