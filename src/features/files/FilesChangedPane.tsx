import { memo, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { useChatStore } from '@/stores/chat'
import { useSessionsStore } from '@/stores/sessions'
import { openFileInWorkspace } from '@/stores/layout'
import { editDiffStats, type EditDetails } from '@/features/chat/tools/toolSummaries'
import { reconstructOriginal } from './patch'
import { MonacoDiff } from './MonacoEditor'
import { languageForPath } from '@/lib/monaco'

interface TouchedFile {
  relativePath: string
  created: boolean
  additions: number
  deletions: number
  /** Unified patches in session order (edit tools only). */
  patches: string[]
}

/** Aggregate edit/write tool results for the active session into per-file rows. */
function collectTouchedFiles(
  tools: Record<
    string,
    | {
        toolName: string
        status: string
        args?: Record<string, unknown>
        result?: { details?: unknown }
      }
    | undefined
  >,
  workspacePath: string,
): TouchedFile[] {
  const byPath = new Map<string, TouchedFile>()
  for (const tool of Object.values(tools)) {
    if (!tool || tool.status !== 'done') continue
    if (tool.toolName !== 'edit' && tool.toolName !== 'write') continue
    const rawPath = typeof tool.args?.path === 'string' ? tool.args.path : null
    if (!rawPath) continue
    const rel = rawPath.startsWith('/')
      ? rawPath.startsWith(workspacePath + '/')
        ? rawPath.slice(workspacePath.length + 1)
        : rawPath
      : rawPath

    const entry = byPath.get(rel) ?? {
      relativePath: rel,
      created: false,
      additions: 0,
      deletions: 0,
      patches: [],
    }
    if (tool.toolName === 'write') {
      entry.created = true
      const content = typeof tool.args?.content === 'string' ? tool.args.content : ''
      entry.additions += content ? content.split('\n').length : 0
    } else {
      const stats = editDiffStats(tool as never)
      if (stats) {
        entry.additions += stats.additions
        entry.deletions += stats.deletions
      }
      const details = tool.result?.details as EditDetails | undefined
      if (details?.patch) entry.patches.push(details.patch)
    }
    byPath.set(rel, entry)
  }
  return [...byPath.values()]
}

export const FilesChangedPane = memo(function FilesChangedPane({
  workspacePath,
}: {
  workspacePath: string
}): React.JSX.Element {
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  const tools = useChatStore((s) =>
    activeSessionId ? s.sessions[activeSessionId]?.tools : undefined,
  )
  const baselineRef = useSessionsStore((s) =>
    activeSessionId ? s.baselines[activeSessionId] : undefined,
  )
  const [selected, setSelected] = useState<string | null>(null)

  const files = useMemo(
    () => (tools ? collectTouchedFiles(tools, workspacePath) : []),
    [tools, workspacePath],
  )
  const totals = useMemo(
    () =>
      files.reduce(
        (acc, f) => ({
          additions: acc.additions + f.additions,
          deletions: acc.deletions + f.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [files],
  )

  const selectedFile = files.find((f) => f.relativePath === selected) ?? null

  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="text-center">
          <div className="text-text-tertiary text-[13px]">No changes yet</div>
          <div className="text-text-tertiary mt-1 text-[11.5px]">
            Files the agent edits or creates in this session will appear here as reviewable diffs.
          </div>
        </div>
      </div>
    )
  }

  if (selectedFile) {
    return (
      <FileDiffView
        key={selectedFile.relativePath}
        workspacePath={workspacePath}
        file={selectedFile}
        baselineRef={baselineRef ?? null}
        onBack={() => setSelected(null)}
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex h-9 shrink-0 items-center justify-between border-b px-3">
        <span className="text-text-tertiary text-[10.5px] font-semibold uppercase tracking-wider">
          Files changed
        </span>
        <span className="text-[11.5px] font-medium">
          {files.length} file{files.length === 1 ? '' : 's'}{' '}
          <span className="text-success">+{totals.additions}</span>{' '}
          <span className="text-danger">−{totals.deletions}</span>
        </span>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {files.map((file) => (
          <FileRow
            key={file.relativePath}
            file={file}
            workspacePath={workspacePath}
            baselineRef={baselineRef ?? null}
            onOpen={() => setSelected(file.relativePath)}
          />
        ))}
      </div>
    </div>
  )
})

function FileRow({
  file,
  workspacePath,
  baselineRef,
  onOpen,
}: {
  file: TouchedFile
  workspacePath: string
  baselineRef: string | null
  onOpen: () => void
}): React.JSX.Element {
  const name = file.relativePath.split('/').pop() ?? file.relativePath
  const dir = file.relativePath.slice(0, file.relativePath.length - name.length)

  const revert = async (event: React.MouseEvent): Promise<void> => {
    event.stopPropagation()
    if (!window.confirm(`Revert ${file.relativePath} to its state at session start?`)) return
    if (baselineRef) {
      await window.pidex.invoke('git:restoreFileTo', workspacePath, baselineRef, file.relativePath)
    } else if (file.created) {
      await window.pidex.invoke('fs:trash', `${workspacePath}/${file.relativePath}`)
    } else if (file.patches.length > 0) {
      const current = await window.pidex.invoke(
        'fs:readFile',
        `${workspacePath}/${file.relativePath}`,
      )
      const original = reconstructOriginal(current.content, file.patches)
      await window.pidex.invoke('fs:writeFile', `${workspacePath}/${file.relativePath}`, original)
    }
  }

  return (
    <div
      onClick={onOpen}
      className="hover:bg-bg-secondary/70 group flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left transition-colors"
    >
      <span
        className={clsx(
          'shrink-0 rounded px-1 py-px text-[9px] font-bold uppercase',
          file.created ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning',
        )}
      >
        {file.created ? 'A' : 'M'}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px]">
        {dir && <span className="text-text-tertiary">{dir}</span>}
        <span className="text-text">{name}</span>
      </span>
      <span className="shrink-0 font-mono text-[11px]">
        <span className="text-success">+{file.additions}</span>{' '}
        <span className="text-danger">−{file.deletions}</span>
      </span>
      <button
        onClick={(e) => void revert(e)}
        title="Revert to session start"
        className="text-text-tertiary hover:text-danger hidden shrink-0 rounded p-1 transition-colors group-hover:block"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8" />
        </svg>
      </button>
    </div>
  )
}

function FileDiffView({
  workspacePath,
  file,
  baselineRef,
  onBack,
}: {
  workspacePath: string
  file: TouchedFile
  baselineRef: string | null
  onBack: () => void
}): React.JSX.Element {
  const [original, setOriginal] = useState<string | null>(null)
  const [modified, setModified] = useState<string | null>(null)
  const [sideBySide, setSideBySide] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const absolute = `${workspacePath}/${file.relativePath}`
        const current = await window.pidex.invoke('fs:readFile', absolute).catch(() => null)
        const currentContent = current?.content ?? ''

        let baselineContent: string
        if (baselineRef) {
          baselineContent =
            (await window.pidex.invoke(
              'git:showFileAt',
              workspacePath,
              baselineRef,
              file.relativePath,
            )) ?? ''
        } else if (file.created) {
          baselineContent = ''
        } else {
          baselineContent = reconstructOriginal(currentContent, file.patches)
        }

        if (!cancelled) {
          setOriginal(baselineContent)
          setModified(currentContent)
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [workspacePath, file, baselineRef])

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex h-9 shrink-0 items-center gap-2 border-b px-2">
        <button
          onClick={onBack}
          className="text-text-tertiary hover:text-text flex h-6 w-6 items-center justify-center rounded-md transition-colors"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{file.relativePath}</span>
        <span className="shrink-0 font-mono text-[11px]">
          <span className="text-success">+{file.additions}</span>{' '}
          <span className="text-danger">−{file.deletions}</span>
        </span>
        <button
          onClick={() => setSideBySide((v) => !v)}
          className="border-border hover:bg-bg-secondary shrink-0 rounded-md border px-2 py-0.5 text-[10.5px] font-medium transition-colors"
        >
          {sideBySide ? 'Inline' : 'Split'}
        </button>
        <button
          onClick={() => void openFileInWorkspace(workspacePath, file.relativePath)}
          className="border-border hover:bg-bg-secondary shrink-0 rounded-md border px-2 py-0.5 text-[10.5px] font-medium transition-colors"
        >
          Open file
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {error && <div className="text-danger p-4 text-[12px]">{error}</div>}
        {original !== null && modified !== null && !error && (
          <MonacoDiff
            originalText={original}
            modifiedText={modified}
            language={languageForPath(file.relativePath)}
            renderSideBySide={sideBySide}
          />
        )}
        {(original === null || modified === null) && !error && (
          <div className="text-text-tertiary animate-pulse p-4 text-[12px]">Computing diff…</div>
        )}
      </div>
    </div>
  )
}
