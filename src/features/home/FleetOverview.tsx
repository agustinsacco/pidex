import { useEffect, useMemo } from 'react'
import { useFleetStore, workSessionsFor } from '@/stores/fleet'
import { useSessionsStore } from '@/stores/sessions'
import { buildInbox } from './inbox'
import { FleetInbox, SectionLabel } from './FleetInbox'
import { SessionCard } from './SessionCard'

/**
 * The fleet, on the home screen.
 *
 * Everything above the composer: what needs you, then what every live agent is
 * doing, then this project's orchestrator digest if one has ever been
 * published. All of it is a projection of main-process state — no model runs
 * to render this page, which is what lets it be the default view.
 */
export function FleetOverview({ workspacePath }: { workspacePath: string }): React.JSX.Element {
  const sessions = useFleetStore((s) => s.sessions)
  const digests = useFleetStore((s) => s.digests)
  const sweeping = useFleetStore((s) => s.sweeping)
  const gitByCwd = useSessionsStore((s) => s.gitByCwd)

  useEffect(() => {
    void useFleetStore.getState().hydrate()
    return useFleetStore.getState().subscribe()
  }, [])

  /**
   * A worktree and its main repo are one project, exactly as the sidebar
   * groups them — so a session running in a worktree still belongs to the
   * orchestrator (and the digest) of its main repo.
   */
  const projectPath = gitByCwd[workspacePath]?.mainRepoPath ?? workspacePath
  const projectPaths = useMemo(() => {
    const paths = new Set<string>([workspacePath, projectPath])
    for (const session of sessions) {
      const git = gitByCwd[session.workspacePath]
      const key = git?.mainRepoPath ?? session.workspacePath
      if (key === projectPath) paths.add(session.workspacePath)
    }
    return [...paths]
  }, [sessions, gitByCwd, workspacePath, projectPath])

  const live = useMemo(() => workSessionsFor(sessions, projectPaths), [sessions, projectPaths])
  const digest = digests[projectPath]
  const isSweeping = sweeping.includes(projectPath)

  const inbox = useMemo(
    () => buildInbox({ sessions: live, digests: digest ? [digest] : [] }),
    [live, digest],
  )

  const working = live.filter((s) => s.phase === 'streaming').length

  // Nothing running, nothing waiting, nothing ever reported: the home screen
  // stays the greeting it was.
  if (live.length === 0 && inbox.length === 0 && !digest) return <></>

  return (
    <div className="mt-8">
      <p className="text-text-secondary mb-4 text-center text-sm">
        {working > 0 ? `${working} agent${working === 1 ? '' : 's'} working` : 'Nothing running'}
        {inbox.length > 0 && ` · ${inbox.length} need${inbox.length === 1 ? 's' : ''} you`}
      </p>

      <FleetInbox items={inbox} />

      {live.length > 0 && (
        <section className="mb-2">
          <div className="flex items-baseline justify-between">
            <SectionLabel>Running now</SectionLabel>
            <button
              onClick={() => void useFleetStore.getState().sweep(projectPath, 'brief')}
              disabled={isSweeping}
              title="Ask this project's orchestrator to report. This one spends tokens."
              className="text-text-tertiary hover:text-text mb-1.5 text-xs transition-colors disabled:opacity-50"
            >
              {isSweeping ? 'Briefing…' : 'Brief me'}
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {live.map((session) => (
              <SessionCard key={session.sessionId} session={session} />
            ))}
          </div>
        </section>
      )}

      {digest && (
        <section className="mt-3">
          <p className="text-text-tertiary text-sm">
            <span className="text-accent mr-1">✳</span>
            {digest.headline}
          </p>
          {/* Suggestions live here rather than in the inbox: asking for advice
              must never bury the things that actually block work. */}
          {digest.items
            .filter((item) => item.kind === 'suggestion')
            .map((item, index) => (
              <div
                key={index}
                data-testid="digest-suggestion"
                className="text-text-secondary mt-1.5 flex items-center gap-2 text-sm"
              >
                <span className="min-w-0 flex-1">{item.text}</span>
                {item.action?.kind === 'start' && item.action.payload && (
                  <button
                    onClick={() =>
                      void window.pidex
                        .invoke('orchestrator:acceptProposal', projectPath, item.action!.payload!)
                        .then(({ sessionId }) => useSessionsStore.getState().activate(sessionId))
                    }
                    className="border-border hover:border-border-strong hover:bg-bg-secondary text-text shrink-0 rounded-md border px-2 py-0.5 text-xs transition-colors"
                  >
                    {item.action.label}
                  </button>
                )}
              </div>
            ))}
        </section>
      )}
    </div>
  )
}
