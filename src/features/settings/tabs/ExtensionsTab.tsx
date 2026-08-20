import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { PiPackageEntry } from '@shared/models'
import { useActiveWorkspace } from '@/stores/workspaces'
import { CatalogueCards } from '../CatalogueCards'
import { usePackageJob } from '../usePackageJob'

/**
 * Settings → Extensions: pi package management. Reads come from settings
 * files + install dirs; every mutation shells out to pi's own package
 * manager (`pi install` / `pi remove` / `pi update`) with streamed output.
 */
export function ExtensionsTab(): React.JSX.Element {
  const workspacePath = useActiveWorkspace()
  const [entries, setEntries] = useState<PiPackageEntry[] | null>(null)
  const [claudeDetected, setClaudeDetected] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addSpec, setAddSpec] = useState('')
  const [addScope, setAddScope] = useState<'global' | 'project'>('global')

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [list, detect] = await Promise.all([
        window.pidex.invoke('packages:list', workspacePath ?? undefined),
        window.pidex.invoke('packages:detect'),
      ])
      setEntries(list)
      setClaudeDetected(detect.claude)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [workspacePath])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const job = usePackageJob(() => void refresh())

  const runAction = (
    action: 'install' | 'remove' | 'update',
    spec: string | undefined,
    scope: 'global' | 'project',
  ): void => {
    setError(null)
    void job.start(() =>
      window.pidex.invoke('packages:run', action, spec, scope, workspacePath ?? undefined),
    )
  }

  const specs = (entries ?? []).map((e) => e.spec)
  const byScope = (scope: 'global' | 'project'): PiPackageEntry[] =>
    (entries ?? []).filter((e) => e.scope === scope)

  return (
    <div className="max-w-2xl">
      <h2 className="text-[16px] font-semibold">Extensions</h2>
      <p className="text-text-secondary mt-1 text-[12.5px]">
        pi packages — extensions, skills, prompts and themes. Changes apply to new sessions.
        Installs run through pi&apos;s own package manager.
      </p>

      <h3 className="mt-5 text-[13.5px] font-semibold">Recommended</h3>
      <div className="mt-2.5">
        <CatalogueCards
          installedSpecs={specs}
          claudeDetected={claudeDetected}
          busy={job.running}
          onInstall={(spec) => runAction('install', spec, 'global')}
        />
      </div>
      <p className="text-text-tertiary mt-2 text-[11px]">
        Browse the full ecosystem at{' '}
        <button
          onClick={() => void window.pidex.invoke('app:openExternal', 'https://pi.dev/packages')}
          className="hover:text-text underline"
        >
          pi.dev/packages
        </button>
        . Packages run with full system access — review before installing.
      </p>

      {(['global', 'project'] as const).map((scope) => {
        const scoped = byScope(scope)
        if (scope === 'project' && !workspacePath) return null
        return (
          <div key={scope}>
            <h3 className="mt-6 text-[13.5px] font-semibold">
              {scope === 'global' ? 'Installed (all workspaces)' : 'Installed (this workspace)'}
            </h3>
            {entries === null ? (
              <div className="text-text-tertiary mt-2 text-[12.5px]">Reading pi settings…</div>
            ) : scoped.length === 0 ? (
              <div className="text-text-tertiary mt-2 text-[12.5px]">none</div>
            ) : (
              <div className="border-border mt-2 divide-y rounded-lg border">
                {scoped.map((entry) => (
                  <PackageRow
                    key={`${entry.scope}:${entry.spec}`}
                    entry={entry}
                    busy={job.running}
                    onRemove={() => runAction('remove', entry.spec, entry.scope)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}

      <h3 className="mt-6 text-[13.5px] font-semibold">Add a package</h3>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={addSpec}
          onChange={(e) => setAddSpec(e.target.value)}
          placeholder="npm:pkg, git:github.com/user/repo, or /absolute/path"
          className="border-border bg-bg-secondary focus:border-accent min-w-0 flex-1 rounded-md border px-2.5 py-1.5 font-mono text-[12px] outline-none"
        />
        {workspacePath && (
          <select
            value={addScope}
            onChange={(e) => setAddScope(e.target.value as 'global' | 'project')}
            className="border-border bg-bg-secondary rounded-md border px-2 py-1.5 text-[12px]"
          >
            <option value="global">Global</option>
            <option value="project">This workspace</option>
          </select>
        )}
        <button
          onClick={() => {
            if (addSpec.trim()) runAction('install', addSpec.trim(), addScope)
          }}
          disabled={job.running || !addSpec.trim()}
          className="bg-accent hover:bg-accent-hover text-accent-text rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50"
        >
          Install
        </button>
        <button
          onClick={() => runAction('update', undefined, 'global')}
          disabled={job.running}
          className="border-border hover:bg-bg-secondary rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50"
          title="pi update --extensions"
        >
          Update all
        </button>
      </div>

      {error && <div className="text-danger mt-3 text-[12px]">{error}</div>}
      <JobOutput running={job.running} output={job.output} exitCode={job.exitCode} />
    </div>
  )
}

function PackageRow({
  entry,
  busy,
  onRemove,
}: {
  entry: PiPackageEntry
  busy: boolean
  onRemove: () => void
}): React.JSX.Element {
  const counts = (
    [
      ['extension', entry.resources.extensions.length],
      ['skill', entry.resources.skills.length],
      ['prompt', entry.resources.prompts.length],
      ['theme', entry.resources.themes.length],
    ] as const
  )
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${n} ${label}${n > 1 ? 's' : ''}`)
    .join(' · ')

  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium">{entry.name}</span>
          {entry.version && (
            <span className="text-text-tertiary font-mono text-[11px]">v{entry.version}</span>
          )}
          {!entry.installed && (
            <span className="text-warning text-[11px]">installs on next session start</span>
          )}
          {entry.filtered && (
            <span className="text-text-tertiary text-[11px]" title="Resource filters in settings">
              filtered
            </span>
          )}
        </div>
        <div className="text-text-tertiary mt-0.5 truncate font-mono text-[11px]">
          {entry.spec}
          {counts && <span className="font-sans"> — {counts}</span>}
        </div>
      </div>
      <button
        onClick={onRemove}
        disabled={busy}
        className="text-danger hover:bg-danger-soft shrink-0 rounded-md px-2 py-1 text-[11.5px] font-medium transition-colors disabled:opacity-50"
      >
        Remove
      </button>
    </div>
  )
}

/** Streamed output of the running (or last) package job. */
export function JobOutput({
  running,
  output,
  exitCode,
}: {
  running: boolean
  output: string
  exitCode: number | null
}): React.JSX.Element | null {
  const preRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    preRef.current?.scrollTo({ top: preRef.current.scrollHeight })
  }, [output])

  if (!running && !output) return null
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <span
          className={clsx(
            'h-1.5 w-1.5 rounded-full',
            running ? 'bg-warning animate-pulse' : exitCode === 0 ? 'bg-success' : 'bg-danger',
          )}
        />
        <span className="text-text-tertiary text-[11px]">
          {running ? 'Running…' : exitCode === 0 ? 'Done' : `Failed (exit ${exitCode})`}
        </span>
      </div>
      <pre
        ref={preRef}
        className="bg-code-bg border-border mt-1.5 max-h-48 overflow-auto rounded-md border px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap"
      >
        {output || '…'}
      </pre>
    </div>
  )
}
