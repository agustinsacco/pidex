import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Button, NumberField, Row, SectionTitle, Toggle } from '@/components/form'
import type { PiHealth, SessionReaperPrefs } from '@shared/models'
import type { PiResources } from '@shared/models'
import { SESSION_REAPER_LIMITS } from '@shared/models'
import { ConfigFileEditor, piConfigFile } from '../ConfigFileEditor'

/** pi install health, discovered resources, and raw config file editing. */

export function AdvancedTab(): React.JSX.Element {
  const [health, setHealth] = useState<PiHealth | null>(null)
  const [resources, setResources] = useState<PiResources | null>(null)
  const [editing, setEditing] = useState<'settings' | 'models' | null>(null)
  const [reaper, setReaper] = useState<SessionReaperPrefs | null>(null)

  useEffect(() => {
    void window.pidex.invoke('pi:health').then(setHealth)
    void window.pidex.invoke('pi:listResources').then(setResources)
    void window.pidex.invoke('app:getPrefs').then((prefs) => setReaper(prefs.sessionReaper))
  }, [])

  const patchReaper = (patch: Partial<SessionReaperPrefs>): void => {
    setReaper((current) => {
      if (!current) return current
      const next = { ...current, ...patch }
      void window.pidex.invoke('app:setSessionReaperPrefs', next)
      return next
    })
  }

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
        <Button onClick={() => setEditing('settings')}>Edit…</Button>
      </Row>
      <Row
        title="pi models.json"
        description="Custom providers and models (local endpoints live here)."
      >
        <Button onClick={() => setEditing('models')}>Edit…</Button>
      </Row>

      <SectionTitle small>Session memory</SectionTitle>
      <Row
        title="Suspend idle sessions"
        description="Each open session is a ~200 MB pi process. Past the cap, sessions idle beyond the grace period are suspended (least recent first) — never the active one, one that is streaming or asking, or one with an open terminal. Reopening resumes from disk in about a second."
      >
        <Toggle on={reaper?.enabled ?? true} onChange={(on) => patchReaper({ enabled: on })} />
      </Row>
      {(reaper?.enabled ?? true) && (
        <>
          <Row title="Keep at most" description="Live sessions before the reaper considers anyone.">
            <NumberField
              value={reaper?.maxLiveSessions ?? 4}
              onChange={(value) => patchReaper({ maxLiveSessions: value })}
              min={SESSION_REAPER_LIMITS.maxLiveSessions.min}
              max={SESSION_REAPER_LIMITS.maxLiveSessions.max}
              step={1}
              suffix="sessions"
            />
          </Row>
          <Row title="Idle grace" description="A session must be idle at least this long.">
            <NumberField
              value={reaper?.idleGraceMinutes ?? 15}
              onChange={(value) => patchReaper({ idleGraceMinutes: value })}
              min={SESSION_REAPER_LIMITS.idleGraceMinutes.min}
              max={SESSION_REAPER_LIMITS.idleGraceMinutes.max}
              step={5}
              suffix="min"
            />
          </Row>
        </>
      )}

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

      {editing && (
        <ConfigFileEditor source={piConfigFile(editing)} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}
