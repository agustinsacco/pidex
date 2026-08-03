import { memo, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { useArtifactsStore, type Artifact } from '@/stores/artifacts'
import { useSessionsStore } from '@/stores/sessions'
import { useLayoutStore, openFileInWorkspace } from '@/stores/layout'
import { Markdown } from '@/components/markdown/Markdown'
import { CodeBlock } from '@/components/markdown/CodeBlock'
import { MermaidBlock } from '@/components/markdown/MermaidBlock'
import { ChartBlock } from '@/components/markdown/ChartBlock'
import { MonacoDiff } from '@/features/files/MonacoEditor'
import { CopyButton } from '@/components/CopyButton'
import { relativeTime } from '@/features/sessions/Sidebar'

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
      <div className="flex h-full flex-col">
        <PaneHeader title="Artifacts" />
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="text-center">
            <div className="text-text-tertiary text-[13px]">No artifacts yet</div>
            <div className="text-text-tertiary mt-1 text-[11.5px]">
              Ask for a dashboard mockup, diagram or report — substantial deliverables land here
              with version history.
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <PaneHeader title="Artifacts" />
      {list.length > 1 && (
        <div className="border-border flex shrink-0 gap-1.5 overflow-x-auto border-b px-2 py-1.5">
          {list.map((artifact) => (
            <button
              key={artifact.id}
              onClick={() =>
                activeSessionId && useArtifactsStore.getState().select(activeSessionId, artifact.id)
              }
              className={clsx(
                'flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                selected?.id === artifact.id
                  ? 'border-accent/40 bg-accent-soft text-accent'
                  : 'border-border text-text-secondary hover:text-text',
              )}
            >
              <TypeIcon type={artifact.type} />
              <span className="max-w-36 truncate">{artifact.title}</span>
              <span className="text-text-tertiary">v{artifact.versions.length}</span>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <ArtifactViewer key={selected.id} artifact={selected} workspacePath={workspacePath} />
      )}
    </div>
  )
})

function PaneHeader({ title }: { title: string }): React.JSX.Element {
  return (
    <div className="border-border flex h-11 shrink-0 items-center gap-2 border-b px-3">
      <span className="text-[13px] font-semibold">{title}</span>
      <div className="flex-1" />
      <button
        onClick={() => useLayoutStore.getState().toggleRightExpanded()}
        title="Expand pane"
        className="text-text-tertiary hover:text-text hover:bg-bg-secondary flex h-7 w-7 items-center justify-center rounded-md transition-colors"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
        </svg>
      </button>
      <button
        onClick={() => useLayoutStore.getState().setRightPane(null)}
        title="Close pane"
        className="text-text-tertiary hover:text-text hover:bg-bg-secondary flex h-7 w-7 items-center justify-center rounded-md transition-colors"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

function ArtifactViewer({
  artifact,
  workspacePath,
}: {
  artifact: Artifact
  workspacePath: string
}): React.JSX.Element {
  const latest = artifact.versions[artifact.versions.length - 1]!
  const [mode, setMode] = useState<'preview' | 'code' | 'diff'>('preview')
  const [versionIndex, setVersionIndex] = useState<number>(artifact.versions.length - 1)

  useEffect(() => {
    setVersionIndex(artifact.versions.length - 1)
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
        <TypeIcon type={artifact.type} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
          {shown.title || artifact.title}
        </span>
        <span className="text-text-tertiary text-[10.5px]">{relativeTime(artifact.updatedAt)}</span>
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
            className="border-border bg-surface text-text rounded-md border px-1.5 py-0.5 text-[11px] outline-none"
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

      <div className="min-h-0 flex-1 overflow-y-auto">
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
        'rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
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

function TypeIcon({ type }: { type: Artifact['type'] }): React.JSX.Element {
  const glyph =
    type === 'html'
      ? '🌐'
      : type === 'svg'
        ? '🎨'
        : type === 'mermaid'
          ? '📊'
          : type === 'chart'
            ? '📈'
            : type === 'markdown'
              ? '📄'
              : '⌨️'
  return <span className="text-[13px] leading-none">{glyph}</span>
}

function artifactLanguage(artifact: Artifact): string {
  if (artifact.type === 'code') return artifact.language ?? 'text'
  if (artifact.type === 'html') return 'html'
  if (artifact.type === 'svg') return 'xml'
  if (artifact.type === 'markdown') return 'markdown'
  if (artifact.type === 'chart') return 'json'
  if (artifact.type === 'mermaid') return 'mermaid'
  return 'text'
}

function suggestedFileName(artifact: Artifact): string {
  const base = artifact.id.replace(/[^a-z0-9-]/gi, '-')
  const ext =
    artifact.type === 'html'
      ? 'html'
      : artifact.type === 'svg'
        ? 'svg'
        : artifact.type === 'markdown'
          ? 'md'
          : artifact.type === 'mermaid'
            ? 'mmd'
            : artifact.type === 'chart'
              ? 'json'
              : extensionForLanguage(artifact.language)
  return `${base}.${ext}`
}

function extensionForLanguage(language?: string): string {
  const map: Record<string, string> = {
    typescript: 'ts',
    javascript: 'js',
    python: 'py',
    rust: 'rs',
    go: 'go',
    java: 'java',
    ruby: 'rb',
    shell: 'sh',
    bash: 'sh',
    css: 'css',
    json: 'json',
    yaml: 'yml',
  }
  return map[language?.toLowerCase() ?? ''] ?? 'txt'
}
