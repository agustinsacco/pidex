import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  DEFAULT_ORCHESTRATOR_PREFS,
  ORCHESTRATOR_MODES,
  ORCHESTRATOR_MODE_INFO,
  orchestratorModeOf,
} from '@shared/models'
import { useChatStore } from '@/stores/chat'
import { useFleetStore } from '@/stores/fleet'
import { modelRisksMalformedToolNames } from '@/features/orchestrator/threadHealth'
import { useActiveWorkspace } from '@/stores/workspaces'
import { useSessionsStore } from '@/stores/sessions'
import { Button, NumberField, Row, SectionTitle, Toggle } from '@/components/form'
import { projectPathFor, workspaceName } from '@/lib/path'

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
  // Prefs, rules and memory are per PROJECT, so a worktree session must
  // resolve to its repo root — including before `git:infoBatch` has answered.
  const projectPath = activeWorkspace
    ? projectPathFor(activeWorkspace, gitByCwd[activeWorkspace])
    : ''

  /*
   * Select the STORED prefs, then merge defaults outside the selector.
   *
   * `prefsFor` builds a fresh object on every call, so using it as a selector
   * returns a new reference each time `useSyncExternalStore` samples the
   * store. React treats that as "changed" on every render, warns that the
   * snapshot is not cached, and then tears the whole app down with "Maximum
   * update depth exceeded" — this settings tab rendered a blank window.
   */
  const storedPrefs = useFleetStore((s) => s.prefs[projectPath])
  const prefs = useMemo(() => ({ ...DEFAULT_ORCHESTRATOR_PREFS, ...storedPrefs }), [storedPrefs])
  const enabled = useFleetStore((s) => s.prefs[projectPath]?.enabled ?? false)
  const [models, setModels] = useState<{ id: string; name: string; provider: string }[]>([])
  const [rules, setRules] = useState('')
  const [rulesPath, setRulesPath] = useState('')
  const [saved, setSaved] = useState(false)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    void window.pidex.invoke('app:getPrefs').then((p) => setMuted(p.notificationsMuted))
    void window.pidex.invoke('pi:catalogueModels').then(setModels)
  }, [])

  useEffect(() => {
    if (!projectPath) return
    void useFleetStore.getState().hydrate()
    void window.pidex.invoke('orchestrator:rules', projectPath).then((result) => {
      setRules(result.content)
      setRulesPath(result.path)
    })
  }, [projectPath])

  // What the orchestrator will actually run: an explicit choice, else whatever
  // the live thread was spawned with — pi's own default, which prefs cannot
  // see. Both hooks stay above the early return below; calling them after it
  // would change hook order between renders.
  const liveOrchestratorId = useFleetStore((s) => s.liveOrchestrators[projectPath])
  const liveModel = useChatStore((s) =>
    liveOrchestratorId ? s.sessions[liveOrchestratorId]?.meta?.model?.id : undefined,
  )
  const effectiveModel = prefs.model ?? liveModel ?? null

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
        title="Mode"
        description="How much it may do on its own. You can also switch this from the orchestrator's own banner, and it takes effect on its next action."
      >
        <div className="flex flex-wrap justify-end gap-1">
          {ORCHESTRATOR_MODES.map((option) => {
            const info = ORCHESTRATOR_MODE_INFO[option]
            const selected = orchestratorModeOf(prefs) === option
            return (
              <button
                key={option}
                onClick={() => update({ mode: option })}
                title={info.summary}
                aria-pressed={selected}
                className={clsx(
                  'rounded-md border px-2 py-1 text-xs transition-colors',
                  selected
                    ? 'border-accent bg-accent-soft text-text'
                    : 'border-border text-text-tertiary hover:text-text',
                )}
              >
                {info.label}
              </button>
            )
          })}
        </div>
      </Row>

      <Row
        title="Model"
        description="Which model runs the orchestrator. It calls tools on nearly every turn, so a model that emits malformed tool calls bricks the thread outright."
      >
        <select
          value={prefs.model ?? ''}
          onChange={(e) => update({ model: e.target.value || undefined })}
          aria-label="Orchestrator model"
          className="border-border bg-surface text-text max-w-[18rem] rounded-lg border px-2.5 py-1.5 text-base outline-none"
        >
          <option value="">Use pi&apos;s default</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} · {m.provider}
            </option>
          ))}
        </select>
      </Row>

      {modelRisksMalformedToolNames(effectiveModel) && (
        <p className="text-warning -mt-1 mb-3 text-sm leading-snug">
          {effectiveModel} is known to emit tool calls whose name the provider rejects. Once one is
          saved to the session file every later turn fails and the thread has to be reset. Pick a
          different model here.
        </p>
      )}

      <Row
        title="Concurrent session cap"
        description="The most sessions Autopilot mode may have running at once. Sessions you start yourself are never capped."
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
