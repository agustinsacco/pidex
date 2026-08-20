import type { PiHealth } from '@shared/models'
import { usePackageJob } from '@/features/settings/usePackageJob'
import { JobOutput } from '@/features/settings/tabs/ExtensionsTab'

export function PiMissingScreen({
  health,
  onRetry,
  onInstalled,
}: {
  health: PiHealth
  onRetry: () => void
  /** Called when the one-click install finishes successfully (fresh setup). */
  onInstalled: () => void
}): React.JSX.Element {
  const tooOld = health.reason === 'too-old'
  const title = tooOld ? 'pi needs an update' : 'pi is not installed'

  const job = usePackageJob((exitCode) => {
    if (exitCode === 0) {
      onInstalled()
      onRetry()
    }
  })

  return (
    <div className="titlebar-drag flex h-full flex-col items-center justify-center gap-6 px-8">
      <div className="bg-surface border-border w-full max-w-lg rounded-lg border p-8 shadow-sm">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-text-secondary mt-3 text-lg leading-relaxed">
          pidex is powered by the pi coding agent. {health.message}
        </p>

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={() => void job.start(() => window.pidex.invoke('packages:installPi'))}
            disabled={job.running}
            className="bg-accent hover:bg-accent-hover text-accent-text rounded-md px-4 py-2 text-lg font-medium transition-colors disabled:opacity-50"
          >
            {job.running ? 'Installing…' : tooOld ? 'Update pi' : 'Install pi'}
          </button>
          <button
            onClick={onRetry}
            disabled={job.running}
            className="border-border hover:bg-bg-secondary rounded-md border px-4 py-2 text-lg font-medium transition-colors disabled:opacity-50"
          >
            Check again
          </button>
        </div>

        <JobOutput running={job.running} output={job.output} exitCode={job.exitCode} />

        <p className="text-text-tertiary mt-5 text-base">Or install it yourself:</p>
        <div className="bg-code-bg border-border mt-1.5 rounded-md border px-4 py-3">
          <code className="font-mono text-lg">npm install -g @earendil-works/pi-coding-agent</code>
        </div>

        {health.version && (
          <p className="text-text-tertiary mt-3 text-base">
            Found version {health.version} at {health.binaryPath} — minimum supported is{' '}
            {health.minVersion}.
          </p>
        )}
      </div>
    </div>
  )
}
