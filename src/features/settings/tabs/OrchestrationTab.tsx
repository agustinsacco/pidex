import { useEffect, useState } from 'react'
import { useFleetStore } from '@/stores/fleet'
import { useActiveWorkspace } from '@/stores/workspaces'
import { useSessionsStore } from '@/stores/sessions'
import { Button, NumberField, Row, SectionTitle, Toggle } from '@/components/form'
import { workspaceName } from '@/lib/path'

/**
 * Orchestration settings for the project currently open.
 *
 * Per-project rather than global because rules, memory and autopilot posture
 * all belong to one codebase — an agent managing a side project should not
 * inherit the posture set for work. Notifications are the exception and say so.
 */
export function OrchestrationTab(): React.JSX.Element {
  const activeWorkspace = useActiveWorkspace()
  const gitByCwd = useSessionsStore((s) => s.gitByCwd)
  const projectPath = activeWorkspace
    ? (gitByCwd[activeWorkspace]?.mainRepoPath ?? activeWorkspace)
    : ''

  const prefs = useFleetStore((s) => s.prefsFor(projectPath))
  const enabled = useFleetStore((s) => s.prefs[projectPath]?.enabled ?? false)
  const [rules, setRules] = useState('')
  const [rulesPath, setRulesPath] = useState('')
  const [saved, setSaved] = useState(false)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    void window.pidex.invoke('app:getPrefs').then((p) => setMuted(p.notificationsMuted))
  }, [])

  useEffect(() => {
    if (!projectPath) return
    void useFleetStore.getState().hydrate()
    void window.pidex.invoke('orchestrator:rules', projectPath).then((result) => {
      setRules(result.content)
      setRulesPath(result.path)
    })
  }, [projectPath])

  if (!projectPath) {
    return (
      <p className="text-text-secondary text-base">Open a project to configure its orchestrator.</p>
    )
  }

  const update = (patch: Partial<typeof prefs>): void => {
    void useFleetStore.getState().setPrefs(projectPath, { ...prefs, ...patch })
  }

  const saveRules = async (): Promise<void> => {
    await window.pidex.invoke('orchestrator:writeRules', projectPath, rules)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div>
      <SectionTitle>Orchestration — {workspaceName(projectPath)}</SectionTitle>
      <p className="text-text-tertiary mb-4 text-sm leading-snug">
        The orchestrator watches this project&apos;s sessions. Watching is free; it only spends
        tokens when you talk to it or ask it for a briefing.
      </p>

      <Row
        title="Autopilot"
        description="Lets it start sessions on its own. Off by default — without it, it can only suggest work for you to accept."
      >
        <Toggle on={prefs.autopilot} onChange={(autopilot) => update({ autopilot })} />
      </Row>

      <Row
        title="Concurrent session cap"
        description="The most sessions autopilot may have running at once. Sessions you start yourself are never capped."
      >
        <NumberField
          value={prefs.maxConcurrent}
          onChange={(maxConcurrent) => update({ maxConcurrent })}
          min={1}
          max={10}
          step={1}
        />
      </Row>

      <Row
        title="Desktop notifications"
        description="Tells you when a session is blocked while pidex is in the background. Applies to every project."
      >
        <Toggle
          on={!muted}
          onChange={(on) => {
            setMuted(!on)
            void window.pidex.invoke('app:setNotificationsMuted', !on)
          }}
        />
      </Row>

      <SectionTitle small>Standing rules</SectionTitle>
      <p className="text-text-tertiary mb-2 text-sm leading-snug">
        Plain language, appended to the orchestrator&apos;s instructions at session start. Stored in{' '}
        <code className="font-mono">{rulesPath}</code>, which pidex keeps out of git — these are
        yours, not the team&apos;s.
      </p>
      <textarea
        value={rules}
        onChange={(e) => setRules(e.target.value)}
        rows={10}
        spellCheck={false}
        aria-label="Standing rules"
        className="border-border bg-surface text-text w-full rounded-lg border px-2.5 py-2 font-mono text-sm outline-none"
      />
      <div className="mt-2 flex items-center gap-2">
        <Button onClick={() => void saveRules()}>Save rules</Button>
        {saved && <span className="text-text-tertiary text-sm">Saved. Applies next session.</span>}
      </div>

      {enabled && (
        <p className="text-text-tertiary mt-4 text-sm">
          This project has an orchestrator thread. Open it from the spark in the sidebar.
        </p>
      )}
    </div>
  )
}
