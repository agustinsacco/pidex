import { memo, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { useArtifactsStore, type Artifact } from '@/stores/artifacts'
import { useSessionsStore } from '@/stores/sessions'
import { openFileInWorkspace } from '@/stores/layout'
import { PaneShell, PaneTitle } from '@/components/PaneShell'
import { Markdown } from '@/components/markdown/Markdown'
import { CodeBlock } from '@/components/markdown/CodeBlock'
import { MermaidBlock } from '@/components/markdown/MermaidBlock'
import { ChartBlock } from '@/components/markdown/ChartBlock'
import { MonacoDiff } from '@/features/files/MonacoEditor'
import { CopyButton } from '@/components/CopyButton'
import { relativeTimeShort } from '@/lib/time'
import { artifactGlyph, artifactLanguage, suggestedFileName } from './artifactKinds'

/** Right-pane Artifacts region: gallery + versioned viewer. */
export const ArtifactsPane = memo(function ArtifactsPane({
  workspacePath,
}: {
  workspacePath: string
}): React.JSX.Element {
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  const artifacts = useArtifactsStore((s) =>
    activeSessionId ? s.bySession[activeSessionId] : undefined,
  )
  const selectedId = useArtifactsStore((s) =>
    activeSessionId ? s.selected[activeSessionId] : undefined,
  )
  const requestedVersion = useArtifactsStore((s) =>
    activeSessionId ? s.selectedVersion[activeSessionId] : undefined,
  )

  useEffect(() => {
    if (activeSessionId) useArtifactsStore.getState().clearUnseen(activeSessionId)
  })

  const list = useMemo(
    () => Object.values(artifacts ?? {}).sort((a, b) => b.updatedAt - a.updatedAt),
    [artifacts],
  )
  const selected = (selectedId && artifacts?.[selectedId]) || list[0]

  if (!activeSessionId || list.length === 0) {
    return (
      <PaneShell title={<PaneTitle label="Artifacts" />}>
        <div className="flex h-full items-center justify-center px-6">
          <div className="text-center">
            <div className="text-text-tertiary text-lg">No artifacts yet</div>
            <div className="text-text-tertiary mt-1 text-sm">
              Ask for a dashboard mockup, diagram or report — substantial deliverables land here
              with version history.
            </div>
          </div>
        </div>
      </PaneShell>
    )
  }

  return (
    <PaneShell
      title={
        <PaneTitle
          label="Artifacts"
          meta={`${list.length} artifact${list.length === 1 ? '' : 's'}`}
        />
      }
    >
      {list.length > 1 && (
        <div className="border-border flex shrink-0 gap-1.5 overflow-x-auto border-b px-2 py-1.5">
          {list.map((artifact) => (
            <button
              key={artifact.id}
              onClick={() =>
                activeSessionId && useArtifactsStore.getState().select(activeSessionId, artifact.id)
              }
              className={clsx(
                'flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-medium transition-colors',
                selected?.id === artifact.id
                  ? 'border-accent/40 bg-accent-soft text-accent'
                  : 'border-border text-text-secondary hover:text-text',
              )}
            >
              <span className="text-lg leading-none">{artifactGlyph(artifact.type)}</span>
              <span className="max-w-36 truncate">{artifact.title}</span>
              <span className="text-text-tertiary">v{artifact.versions.length}</span>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <ArtifactViewer
          key={selected.id}
          artifact={selected}
          workspacePath={workspacePath}
          requestedVersion={selected.id === selectedId ? requestedVersion : undefined}
        />
      )}
    </PaneShell>
  )
})

function ArtifactViewer({
  artifact,
  workspacePath,
  requestedVersion,
}: {
  artifact: Artifact
  workspacePath: string
  /** Version explicitly navigated to (e.g. a chat card's "Open in panel"). */
  requestedVersion?: number
}): React.JSX.Element {
  const latest = artifact.versions[artifact.versions.length - 1]!
  const [mode, setMode] = useState<'preview' | 'code' | 'diff'>('preview')
  const [versionIndex, setVersionIndex] = useState<number>(() => {
    const requested = artifact.versions.findIndex((v) => v.version === requestedVersion)
    return requested >= 0 ? requested : artifact.versions.length - 1
  })

  // A version-targeted navigation (chat card click) wins over current state.
  useEffect(() => {
    if (requestedVersion == null) return
    const requested = artifact.versions.findIndex((v) => v.version === requestedVersion)
    if (requested >= 0) setVersionIndex(requested)
  }, [requestedVersion, artifact.versions])

  // Follow the tip only when the user was already at it — a reader pinned to
  // an older version (comparing, reviewing) must not be yanked to latest by
  // an incoming update.
  const prevLengthRef = useRef(artifact.versions.length)
  useEffect(() => {
    const prevLength = prevLengthRef.current
    prevLengthRef.current = artifact.versions.length
    setVersionIndex((current) =>
      current >= prevLength - 1 ? artifact.versions.length - 1 : current,
    )
  }, [artifact.versions.length])

  const shown = artifact.versions[Math.min(versionIndex, artifact.versions.length - 1)] ?? latest
  const previous = artifact.versions[Math.min(versionIndex, artifact.versions.length - 1) - 1]

  const save = async (): Promise<void> => {
    const outputPath = await window.pidex.invoke('app:saveDialog', {
      title: 'Save artifact',
      defaultPath: suggestedFileName(artifact),
    })
    if (!outputPath) return
    await window.pidex.invoke('fs:writeFile', outputPath, shown.content)
    await window.pidex.invoke('app:revealPath', outputPath)
  }

  const openInFiles = async (): Promise<void> => {
    const target = `${workspacePath}/${suggestedFileName(artifact)}`
    await window.pidex.invoke('fs:writeFile', target, shown.content)
    await openFileInWorkspace(workspacePath, target)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-2">
        <span className="text-lg leading-none">{artifactGlyph(artifact.type)}</span>
        <span className="min-w-0 flex-1 truncate text-lg font-semibold">
          {shown.title || artifact.title}
        </span>
        <span className="text-text-tertiary text-xs">{relativeTimeShort(artifact.updatedAt)}</span>
      </div>

      <div className="border-border flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        <Tab active={mode === 'preview'} onClick={() => setMode('preview')}>
          Preview
        </Tab>
        <Tab active={mode === 'code'} onClick={() => setMode('code')}>
          Code
        </Tab>
        {artifact.versions.length > 1 && (
          <Tab active={mode === 'diff'} onClick={() => setMode('diff')}>
            Diff
          </Tab>
        )}
        <div className="flex-1" />
        {artifact.versions.length > 1 && (
          <select
            value={shown.version}
            onChange={(e) => {
              const index = artifact.versions.findIndex((v) => v.version === Number(e.target.value))
              if (index !== -1) setVersionIndex(index)
            }}
            className="border-border bg-surface text-text rounded-md border px-1.5 py-0.5 text-sm outline-none"
          >
            {artifact.versions.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version}
              </option>
            ))}
          </select>
        )}
        <CopyButton text={shown.content} />
        <ActionIcon title="Save to file…" onClick={() => void save()}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
        </ActionIcon>
        <ActionIcon
          title="Write into workspace and open in Files"
          onClick={() => void openInFiles()}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </ActionIcon>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="artifact-scroll">
        {mode === 'preview' && <ArtifactPreview artifact={artifact} content={shown.content} />}
        {mode === 'code' && (
          <div className="[&_.code-block]:my-0 [&_.code-block]:rounded-none [&_.code-block]:border-0">
            <CodeBlock code={shown.content} language={artifactLanguage(artifact)} />
          </div>
        )}
        {mode === 'diff' && (
          <div className="h-full">
            <MonacoDiff
              originalText={previous?.content ?? ''}
              modifiedText={shown.content}
              language={artifactLanguage(artifact)}
              renderSideBySide={false}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function ArtifactPreview({
  artifact,
  content,
}: {
  artifact: Artifact
  content: string
}): React.JSX.Element {
  switch (artifact.type) {
    case 'html':
      return (
        <iframe
          sandbox="allow-scripts"
          srcDoc={content}
          title={artifact.title}
          className="h-full min-h-[400px] w-full bg-white"
        />
      )
    case 'svg':
      return (
        <iframe
          sandbox=""
          srcDoc={`<!doctype html><style>html,body{margin:0;display:grid;place-items:center;height:100%;background:#fff}</style>${content}`}
          title={artifact.title}
          className="h-full min-h-[400px] w-full bg-white"
        />
      )
    case 'mermaid':
      return (
        <div className="p-3">
          <MermaidBlock code={content} />
        </div>
      )
    case 'chart':
      return (
        <div className="p-3">
          <ChartBlock code={content} />
        </div>
      )
    case 'markdown':
      return (
        <div className="p-4">
          <Markdown text={content} />
        </div>
      )
    case 'code':
    default:
      return (
        <div className="[&_.code-block]:my-0 [&_.code-block]:rounded-none [&_.code-block]:border-0">
          <CodeBlock code={content} language={artifactLanguage(artifact)} />
        </div>
      )
  }
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'rounded-md px-2.5 py-1 text-base font-medium transition-colors',
        active ? 'bg-bg-secondary text-text' : 'text-text-tertiary hover:text-text',
      )}
    >
      {children}
    </button>
  )
}

function ActionIcon({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      title={title}
      onClick={onClick}
      className="text-text-tertiary hover:text-text hover:bg-bg-secondary flex h-6 w-6 items-center justify-center rounded-md transition-colors"
    >
      {children}
    </button>
  )
}
