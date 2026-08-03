import { create } from 'zustand'
import type { ThemePreference } from '@shared/models'

interface SettingsState {
  theme: ThemePreference
  resolvedTheme: 'light' | 'dark'
  /** From pi's settings.json — hide thinking blocks in chat. */
  hideThinkingBlock: boolean
  setTheme: (theme: ThemePreference) => void
  hydrate: () => Promise<void>
  loadAgentSettings: (workspacePath?: string) => Promise<void>
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

    hydrate: async () => {
      const prefs = await window.pidex.invoke('app:getPrefs')
      const resolved = resolve(prefs.theme)
      applyToDom(resolved)
      set({ theme: prefs.theme, resolvedTheme: resolved })
    },
  }
})
