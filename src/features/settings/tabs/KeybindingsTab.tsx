import { SectionTitle } from '@/components/form'

/** Static reference table of the global keyboard shortcuts. */

const KEYBINDINGS: Array<[string, string]> = [
  ['⌘/Ctrl + N', 'New session'],
  ['⌘/Ctrl + B', 'Toggle sidebar'],
  ['⌘/Ctrl + P', 'Go to file'],
  ['⌘/Ctrl + K', 'Command palette'],
  ['⌘/Ctrl + ,', 'Settings'],
  ['⌘/Ctrl + `', 'Toggle terminal pane'],
  ['⌘/Ctrl + ⇧ + E', 'Toggle files pane'],
  ['⌘/Ctrl + ⇧ + G', 'Toggle changes pane'],
  ['Enter', 'Send prompt (steer while streaming)'],
  ['⌥/⌘ + Enter', 'Queue follow-up while streaming'],
  ['Esc', 'Stop the agent / close overlays'],
  ['⇧ + Enter', 'Newline in composer'],
  ['⌘/Ctrl + S', 'Save file in editor'],
  ['⌘/Ctrl + F', 'Search in terminal'],
]

export function KeybindingsTab(): React.JSX.Element {
  return (
    <div>
      <SectionTitle>Keybindings</SectionTitle>
      <div className="border-border divide-border divide-y overflow-hidden rounded-xl border">
        {KEYBINDINGS.map(([keys, action]) => (
          <div key={keys} className="bg-surface flex items-center justify-between px-4 py-2">
            <span className="text-[12.5px]">{action}</span>
            <kbd className="bg-bg-secondary border-border rounded-md border px-2 py-0.5 font-mono text-[11px]">
              {keys}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  )
}
