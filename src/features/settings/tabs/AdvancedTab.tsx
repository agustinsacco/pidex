import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Row, SectionTitle } from '@/components/form'
import type { PiHealth } from '@shared/models'
import type { PiResources } from '@shared/models'
import { ConfigFileEditor } from '../ConfigFileEditor'

/** pi install health, discovered resources, and raw config file editing. */

export function AdvancedTab(): React.JSX.Element {
  const [health, setHealth] = useState<PiHealth | null>(null)
  const [resources, setResources] = useState<PiResources | null>(null)
  const [editing, setEditing] = useState<'settings' | 'models' | null>(null)

  useEffect(() => {
    void window.pidex.invoke('pi:health').then(setHealth)
    void window.pidex.invoke('pi:listResources').then(setResources)
  }, [])

  return (
    <div>
      <SectionTitle>Advanced</SectionTitle>

      <Row
        title="pi health"
        description={
          health
            ? `${health.binaryPath ?? 'not found'} — minimum supported ${health.minVersion}`
            : 'checking…'
        }
      >
        <span
          className={clsx(
            'rounded-md px-2 py-1 font-mono text-sm font-medium',
            health?.ok ? 'bg-success/15 text-success' : 'bg-danger-soft text-danger',
          )}
        >
          {health ? (health.ok ? `v${health.version}` : (health.reason ?? 'error')) : '…'}
        </span>
      </Row>

      <Row
        title="pi settings.json"
        description="Raw editor for ~/.pi/agent/settings.json. Restart sessions to apply."
      >
        <button
          onClick={() => setEditing('settings')}
          className="border-border hover:bg-bg-secondary rounded-md border px-2.5 py-1.5 text-base font-medium transition-colors"
        >
          Edit…
        </button>
      </Row>
      <Row
        title="pi models.json"
        description="Custom providers and models (local endpoints live here)."
      >
        <button
          onClick={() => setEditing('models')}
          className="border-border hover:bg-bg-secondary rounded-md border px-2.5 py-1.5 text-base font-medium transition-colors"
        >
          Edit…
        </button>
      </Row>

      <SectionTitle small>
        Local pi resources (loose files — packages are in the Extensions tab)
      </SectionTitle>
      <div className="grid grid-cols-4 gap-3">
        {(['skills', 'extensions', 'prompts', 'themes'] as const).map((kind) => (
          <div key={kind} className="border-border bg-surface rounded-xl border p-3">
            <div className="text-text-tertiary text-xs font-semibold font-mono uppercase tracking-wider">
              {kind}
            </div>
            <div className="mt-1.5 space-y-0.5">
              {(resources?.[kind] ?? []).slice(0, 8).map((name) => (
                <div key={name} className="truncate font-mono text-sm">
                  {name}
                </div>
              ))}
              {resources && resources[kind].length === 0 && (
                <div className="text-text-tertiary text-sm">none</div>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="text-text-tertiary mt-3 text-sm">
        auth.json is never read or displayed by pidex.
      </p>

      {editing && <ConfigFileEditor name={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
