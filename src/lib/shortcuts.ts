import type { PidexPlatform } from '@shared/ipc'

/**
 * Platform-correct keyboard-shortcut labels.
 *
 * Every handler already accepts both modifiers (`event.metaKey ||
 * event.ctrlKey`, `event.altKey || event.metaKey`), so the KEYS work
 * everywhere and only the LABEL is platform-specific. macOS spells shortcuts
 * as glyphs run together (⌘⇧E); Windows and Linux name the keys and separate
 * them (Ctrl+Shift+E).
 */

export type Modifier = 'mod' | 'shift' | 'alt'

/** `mod` is Command on macOS and Control everywhere else. */
const GLYPHS: Record<Modifier, string> = { mod: '⌘', shift: '⇧', alt: '⌥' }
const NAMES: Record<Modifier, string> = { mod: 'Ctrl', shift: 'Shift', alt: 'Alt' }

function isModifier(part: string): part is Modifier {
  return part === 'mod' || part === 'shift' || part === 'alt'
}

/** Pure form, for tests and for callers that already know the platform. */
export function formatShortcutFor(platform: PidexPlatform, parts: readonly string[]): string {
  const mac = platform === 'darwin'
  const table = mac ? GLYPHS : NAMES
  const rendered = parts.map((part) => (isModifier(part) ? table[part] : part))
  return rendered.join(mac ? '' : '+')
}

/**
 * The host platform. Falls back to 'linux' rather than throwing: this runs
 * during first paint, and a missing bridge should degrade to a spelled-out
 * label, never a blank one.
 */
export function hostPlatform(): PidexPlatform {
  return typeof window === 'undefined' ? 'linux' : (window.pidex?.platform ?? 'linux')
}

/** `formatShortcut('mod', 'shift', 'E')` → `⌘⇧E` on macOS, `Ctrl+Shift+E` elsewhere. */
export function formatShortcut(...parts: string[]): string {
  return formatShortcutFor(hostPlatform(), parts)
}
