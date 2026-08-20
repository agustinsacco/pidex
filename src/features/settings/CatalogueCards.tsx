import { PACKAGE_CATALOGUE, isCatalogueEntryInstalled } from './catalogue'

/**
 * Curated package cards shared by Settings → Extensions and the first-run
 * getting-started screen.
 */
export function CatalogueCards({
  installedSpecs,
  claudeDetected,
  busy,
  onInstall,
}: {
  installedSpecs: string[]
  /** null while detection is still in flight. */
  claudeDetected: boolean | null
  busy: boolean
  onInstall: (spec: string) => void
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {PACKAGE_CATALOGUE.map((entry) => {
        const installed = isCatalogueEntryInstalled(entry.spec, installedSpecs)
        const missingBinary = entry.requiresBinary === 'claude' && claudeDetected === false
        return (
          <div key={entry.spec} className="border-border bg-surface rounded-xl border p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold">{entry.name}</span>
              {installed ? (
                <span className="text-success text-[11px] font-medium">Added</span>
              ) : (
                <button
                  onClick={() => onInstall(entry.spec)}
                  disabled={busy}
                  className="bg-accent hover:bg-accent-hover text-accent-text rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors disabled:opacity-50"
                >
                  Add
                </button>
              )}
            </div>
            <p className="text-text-secondary mt-1.5 text-[12px] leading-snug">
              {entry.description}
            </p>
            <div className="mt-2 flex items-center gap-3">
              <button
                onClick={() => void window.pidex.invoke('app:openExternal', entry.docsUrl)}
                className="text-text-tertiary hover:text-text text-[11px] underline"
              >
                Docs
              </button>
              {missingBinary && (
                <span className="text-warning text-[11px]">
                  Needs the `claude` CLI on your PATH
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
