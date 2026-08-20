import { describe, expect, it } from 'vitest'
import { formatShortcutFor } from './shortcuts'

describe('formatShortcutFor', () => {
  it('renders macOS shortcuts as run-together glyphs', () => {
    expect(formatShortcutFor('darwin', ['mod', 'N'])).toBe('⌘N')
    expect(formatShortcutFor('darwin', ['mod', 'shift', 'E'])).toBe('⌘⇧E')
    expect(formatShortcutFor('darwin', ['alt', 'Enter'])).toBe('⌥Enter')
  })

  it('names and separates the keys everywhere else', () => {
    expect(formatShortcutFor('linux', ['mod', 'N'])).toBe('Ctrl+N')
    expect(formatShortcutFor('win32', ['mod', 'shift', 'E'])).toBe('Ctrl+Shift+E')
    // The bug this module exists to fix: Linux users press Alt, not Option.
    expect(formatShortcutFor('linux', ['alt', 'Enter'])).toBe('Alt+Enter')
  })

  it('passes non-modifier parts through untouched', () => {
    expect(formatShortcutFor('darwin', ['mod', '`'])).toBe('⌘`')
    expect(formatShortcutFor('linux', ['mod', ','])).toBe('Ctrl+,')
  })
})
