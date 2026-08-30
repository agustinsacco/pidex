import { memo, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { useArtifactsStore, type Artifact } from '@/stores/artifacts'
import { useSessionsStore } from '@/stores/sessions'
import { openFileInWorkspace } from '@/stores/layout'
import { PaneShell, PaneTitle } from '@/components/PaneShell'
import { PopupMenu, MenuRow } from '@/components/PopupMenu'
import { ChevronDownIcon } from '@/components/icons'
import { Markdown } from '@/components/markdown/Markdown'
import { CodeBlock } from '@/components/markdown/CodeBlock'
import { MermaidBlock } from '@/components/markdown/MermaidBlock'
import { ChartBlock } from '@/components/markdown/ChartBlock'
import { MonacoDiff } from '@/features/files/MonacoEditor'
import { CopyButton } from '@/components/CopyButton'
import { SandboxedHtml } from '@/components/SandboxedHtml'
import { DownloadIcon, FileIcon } from '@/components/icons'
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
    // The artifact IS the pane title. The old header spent four stacked rows
    // (shell label, gallery chips, title band, toolbar) before any content;
    // the switcher dropdown replaces the chip row and the title band both.
    <PaneShell
      title={
        selected && (
          <ArtifactSwitcher
            list={list}
            selected={selected}
            onSelect={(id) =>
              activeSessionId && useArtifactsStore.getState().select(activeSessionId, id)
            }
          />
        )
      }
    >
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

/**
 * Header title = the selected artifact itself (glyph, name, age). With more
 * than one artifact it becomes a dropdown switcher; with one it is a plain
 * label. Replaces the old chip gallery row AND the per-artifact title band.
 */
function ArtifactSwitcher({
  list,
  selected,
  onSelect,
}: {
  list: Artifact[]
  selected: Artifact
  onSelect: (id: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const multiple = list.length > 1

  return (
    <div className="relative min-w-0 flex-1">
      <button
        ref={triggerRef}
        disabled={!multiple}
        aria-haspopup={multiple ? 'listbox' : undefined}
        aria-expanded={multiple ? open : undefined}
        title={multiple ? 'Switch artifact' : undefined}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors',
          multiple && 'hover:bg-bg-secondary',
        )}
      >
        <span className="shrink-0 text-lg leading-none">{artifactGlyph(selected.type)}</span>
        <span className="min-w-0 truncate text-lg font-semibold">{selected.title}</span>
        <span className="text-text-tertiary shrink-0 text-xs">
          {relativeTimeShort(selected.updatedAt)}
        </span>
        {multiple && <ChevronDownIcon size={12} className="text-text-tertiary shrink-0" />}
      </button>
      {open && (
        <PopupMenu
          onClose={() => setOpen(false)}
          triggerRef={triggerRef}
          className="absolute left-0 top-full mt-1 w-72 py-1"
        >
          {list.map((artifact) => (
            <MenuRow
              key={artifact.id}
              active={artifact.id === selected.id}
              onClick={() => {
                onSelect(artifact.id)
                setOpen(false)
              }}
              trailing={`v${artifact.versions.length} · ${relativeTimeShort(artifact.updatedAt)}`}
            >
              <span className="mr-1.5">{artifactGlyph(artifact.type)}</span>
              {artifact.title}
            </MenuRow>
          ))}
        </PopupMenu>
      )}
    </div>
  )
}

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
          <DownloadIcon />
        </ActionIcon>
        <ActionIcon
          title="Write into workspace and open in Files"
          onClick={() => void openInFiles()}
        >
          <FileIcon size={12} />
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
        <SandboxedHtml
          html={content}
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
