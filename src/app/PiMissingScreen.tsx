import type { PiHealth } from '@shared/models'

export function PiMissingScreen({
  health,
  onRetry,
}: {
  health: PiHealth
  onRetry: () => void
}): React.JSX.Element {
  const title = health.reason === 'too-old' ? 'pi needs an update' : 'pi is not installed'

  return (
    <div className="titlebar-drag flex h-full flex-col items-center justify-center gap-6 px-8">
      <div className="bg-surface border-border w-full max-w-lg rounded-lg border p-8 shadow-sm">
        <h1 className="font-serif text-2xl font-medium">{title}</h1>
        <p className="text-text-secondary mt-3 text-sm leading-relaxed">
          pidex is powered by the pi coding agent. {health.message}
        </p>

        <div className="bg-code-bg border-border mt-5 rounded-md border px-4 py-3">
          <code className="font-mono text-[13px]">
            npm install -g @earendil-works/pi-coding-agent
          </code>
        </div>

        {health.version && (
          <p className="text-text-tertiary mt-3 text-xs">
            Found version {health.version} at {health.binaryPath} — minimum supported is{' '}
            {health.minVersion}.
          </p>
        )}

        <button
          onClick={onRetry}
          className="bg-accent hover:bg-accent-hover text-accent-text mt-6 rounded-md px-4 py-2 text-sm font-medium transition-colors"
        >
          Check again
        </button>
      </div>
    </div>
  )
}
