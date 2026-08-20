import { SectionTitle } from '@/components/form'
import { formatShortcut } from '@/lib/shortcuts'

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

export function KeybindingsTab(): React.JSX.Element {
  return (
    <div>
      <SectionTitle>Keybindings</SectionTitle>
      <div className="border-border divide-border divide-y overflow-hidden rounded-xl border">
        {KEYBINDINGS.map(([parts, action]) => {
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
