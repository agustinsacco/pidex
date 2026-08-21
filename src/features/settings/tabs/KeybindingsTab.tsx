import { SectionTitle } from '@/components/form'
import { formatShortcut, hostPlatform } from '@/lib/shortcuts'
import { clipboardModifiers } from '@/features/terminal/clipboardKeys'

/** Static reference table of the global keyboard shortcuts. */

const KEYBINDINGS: Array<[string[], string]> = [
  [['mod', 'N'], 'New session'],
  [['mod', 'B'], 'Toggle sidebar'],
  [['mod', 'P'], 'Go to file'],
  [['mod', 'K'], 'Command palette'],
  [['mod', ','], 'Settings'],
  [['mod', '`'], 'Toggle terminal pane'],
  [['mod', 'shift', 'E'], 'Toggle files pane'],
  [['mod', 'shift', 'G'], 'Toggle changes pane'],
  [['Enter'], 'Send prompt (steer while streaming)'],
  [['alt', 'Enter'], 'Queue follow-up while streaming'],
  [['Esc'], 'Stop the agent / close overlays'],
  [['shift', 'Enter'], 'Newline in composer'],
  [['mod', 'S'], 'Save file in editor'],
  [['mod', 'F'], 'Search in terminal'],
]

/*
 * Terminal copy/paste is the one pair whose KEYS differ per platform, not just
 * their spelling: Ctrl+C has to stay SIGINT off macOS, so copy moves to
 * Ctrl+Shift+C there (see features/terminal/clipboardKeys.ts).
 */
function clipboardBindings(): Array<[string[], string]> {
  const mod = clipboardModifiers(hostPlatform())
  return [
    [[...mod, 'C'], 'Copy terminal selection'],
    [[...mod, 'V'], 'Paste into terminal'],
  ]
}

export function KeybindingsTab(): React.JSX.Element {
  return (
    <div>
      <SectionTitle>Keybindings</SectionTitle>
      <div className="border-border divide-border divide-y overflow-hidden rounded-xl border">
        {[...KEYBINDINGS, ...clipboardBindings()].map(([parts, action]) => {
          const keys = formatShortcut(...parts)
          return (
            <div key={action} className="bg-surface flex items-center justify-between px-4 py-2">
              <span className="text-base">{action}</span>
              <kbd className="bg-bg-secondary border-border rounded-md border px-2 py-0.5 font-mono text-sm">
                {keys}
              </kbd>
            </div>
          )
        })}
      </div>
    </div>
  )
}
