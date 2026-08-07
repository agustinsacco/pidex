import clsx from 'clsx'
import { useSettingsStore } from '@/stores/settings'
import { Row, SectionTitle, NumberField } from '@/components/form'

/** Theme, UI scale and font preferences (pidex-local, not pi settings). */

const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const

export function AppearanceTab(): React.JSX.Element {
  const theme = useSettingsStore((s) => s.theme)
  const fonts = useSettingsStore((s) => s.fonts)
  const setFonts = useSettingsStore((s) => s.setFonts)

  return (
    <div>
      <SectionTitle>Appearance</SectionTitle>

      <Row title="Theme" description="Applies live across chat, editor, terminal and diagrams.">
        <div
          className="border-border flex overflow-hidden rounded-lg border"
          role="group"
          aria-label="Theme"
        >
          {THEME_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              aria-pressed={theme === value}
              onClick={() => useSettingsStore.getState().setTheme(value)}
              className={clsx(
                'px-3 py-1.5 text-[12px] font-medium transition-colors',
                theme === value
                  ? 'bg-accent text-accent-text'
                  : 'text-text-secondary hover:text-text',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </Row>

      <Row title="UI scale" description="Overall interface size.">
        <NumberField
          value={Math.round(fonts.uiScale * 100)}
          suffix="%"
          min={80}
          max={140}
          step={5}
          onChange={(v) => setFonts({ uiScale: v / 100 })}
        />
      </Row>
      <Row title="Chat font size" description="Message text size in the conversation.">
        <NumberField
          value={fonts.chatFontSize}
          suffix="px"
          min={11}
          max={20}
          step={0.5}
          onChange={(v) => setFonts({ chatFontSize: v })}
        />
      </Row>
      <Row
        title="Editor font size"
        description="Monaco editor and diffs. Applies to newly opened editors."
      >
        <NumberField
          value={fonts.editorFontSize}
          suffix="px"
          min={10}
          max={20}
          step={0.5}
          onChange={(v) => setFonts({ editorFontSize: v })}
        />
      </Row>
      <Row title="Terminal font size" description="Applies to new terminal tabs.">
        <NumberField
          value={fonts.terminalFontSize}
          suffix="px"
          min={10}
          max={20}
          step={0.5}
          onChange={(v) => setFonts({ terminalFontSize: v })}
        />
      </Row>
      <Row title="Mono font" description="Used for code, diffs and the terminal.">
        <select
          value={fonts.monoFont}
          onChange={(e) => setFonts({ monoFont: e.target.value })}
          className="border-border bg-surface text-text rounded-lg border px-2.5 py-1.5 text-[12.5px] outline-none"
        >
          {['JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', 'Cascadia Code', 'monospace'].map(
            (font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ),
          )}
        </select>
      </Row>
    </div>
  )
}
