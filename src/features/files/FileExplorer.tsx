import { memo, useEffect } from 'react'
import clsx from 'clsx'
import type { DirEntry } from '@shared/models'
import { useFilesStore, workspaceFiles } from '@/stores/files'
import { showContextMenu } from '@/components/ContextMenu'
import { BranchIcon } from '@/components/icons'
import { createIn, renameEntry, trashEntry } from './fileActions'

export const FileExplorer = memo(function FileExplorer({
  workspacePath,
}: {
  workspacePath: string
}): React.JSX.Element {
  const rootEntries = useFilesStore((s) => s.entries[workspacePath])
  const showHidden = useFilesStore((s) => s.showHidden)
  const respectGitignore = useFilesStore((s) => s.respectGitignore)

  useEffect(() => {
    const store = useFilesStore.getState()
    if (!store.entries[workspacePath]) {
      void store.refreshDir(workspacePath, workspacePath)
      void store.refreshGitStatus(workspacePath)
    }
  }, [workspacePath])

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex h-9 shrink-0 items-center justify-between border-b px-3">
        <span className="text-text-tertiary text-xs font-semibold font-mono uppercase tracking-wider">
          Explorer
        </span>
        <div className="flex items-center gap-0.5">
          <IconToggle
            title="Show hidden files"
            active={showHidden}
            onClick={() => useFilesStore.getState().setShowHidden(workspacePath, !showHidden)}
          >
            <EyeIcon />
          </IconToggle>
          <IconToggle
            title="Respect .gitignore"
            active={respectGitignore}
            onClick={() =>
              useFilesStore.getState().setRespectGitignore(workspacePath, !respectGitignore)
            }
          >
            <BranchIcon size={12} />
          </IconToggle>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {rootEntries === undefined && (
          <div className="text-text-tertiary animate-pulse px-3 py-2 text-base">Loading…</div>
        )}
        {rootEntries?.map((entry) => (
          <ExplorerRow key={entry.path} entry={entry} workspacePath={workspacePath} depth={0} />
        ))}
        {rootEntries?.length === 0 && (
          <div className="text-text-tertiary px-3 py-2 text-base">Empty folder</div>
        )}
      </div>
    </div>
  )
})

const STATUS_DOTS: Record<string, { color: string; label: string }> = {
  M: { color: 'var(--px-warning)', label: 'modified' },
  A: { color: 'var(--px-success)', label: 'added' },
  '?': { color: 'var(--px-success)', label: 'untracked' },
  D: { color: 'var(--px-danger)', label: 'deleted' },
  R: { color: 'var(--px-info)', label: 'renamed' },
}

function ExplorerRow({
  entry,
  workspacePath,
  depth,
}: {
  entry: DirEntry
  workspacePath: string
  depth: number
}): React.JSX.Element {
  const isExpanded = useFilesStore((s) => s.expanded[entry.path] ?? false)
  const children = useFilesStore((s) => s.entries[entry.path])
  const gitStatus = useFilesStore((s) => workspaceFiles(s, workspacePath).gitStatus)
  const isActive = useFilesStore((s) => workspaceFiles(s, workspacePath).activePath === entry.path)

  const status = gitStatus[entry.relativePath]
  const statusChar = status?.trim()?.[0]
  const dot = statusChar ? STATUS_DOTS[statusChar] : undefined
  // Directory dot: any child dirty.
  const dirDirty =
    entry.isDirectory && Object.keys(gitStatus).some((p) => p.startsWith(entry.relativePath + '/'))

  const onClick = (): void => {
    const store = useFilesStore.getState()
    if (entry.isDirectory) {
      void store.toggleDir(workspacePath, entry.path)
    } else {
      void store.openFile(workspacePath, entry.path)
    }
  }

  const onContextMenu = (event: React.MouseEvent): void => {
    showContextMenu(event, [
      {
        label: 'Reveal in file manager',
        onClick: () => void window.pidex.invoke('app:revealPath', entry.path),
      },
      {
        label: 'Copy path',
        onClick: () => void navigator.clipboard.writeText(entry.path),
      },
      {
        label: 'Copy relative path',
        onClick: () => void navigator.clipboard.writeText(entry.relativePath),
      },
      {
        label: 'New file…',
        separatorAbove: true,
        onClick: () => void createIn(workspacePath, entry, 'file'),
      },
      {
        label: 'New folder…',
        onClick: () => void createIn(workspacePath, entry, 'folder'),
      },
      {
        label: 'Rename…',
        onClick: () => void renameEntry(workspacePath, entry),
      },
      {
        label: 'Delete (move to trash)',
        danger: true,
        separatorAbove: true,
        onClick: () => void trashEntry(workspacePath, entry),
      },
    ])
  }

  return (
    <>
      <button
        onClick={onClick}
        onContextMenu={onContextMenu}
        className={clsx(
          'group flex w-full items-center gap-1.5 py-[3px] pr-2 text-left text-base transition-colors',
          isActive
            ? 'bg-bg-secondary text-text'
            : 'text-text-secondary hover:bg-bg-secondary/60 hover:text-text',
        )}
        style={{ paddingLeft: 10 + depth * 14 }}
      >
        {entry.isDirectory ? (
          <>
            <ChevronIcon expanded={isExpanded} />
            <FolderGlyph open={isExpanded} />
          </>
        ) : (
          <span className="w-[13px]" />
        )}
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
        {(dot || dirDirty) && (
          <span
            title={dot?.label ?? 'contains changes'}
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: dot?.color ?? 'var(--px-warning)' }}
          />
        )}
      </button>
      {entry.isDirectory && isExpanded && (
        <>
          {children === undefined && (
            <div
              className="text-text-tertiary animate-pulse py-1 text-sm"
              style={{ paddingLeft: 24 + depth * 14 }}
            >
              …
            </div>
          )}
          {children?.map((child) => (
            <ExplorerRow
              key={child.path}
              entry={child}
              workspacePath={workspacePath}
              depth={depth + 1}
            />
          ))}
        </>
      )}
    </>
  )
}

function IconToggle({
  title,
  active,
  onClick,
  children,
}: {
  title: string
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      title={title}
      onClick={onClick}
      className={clsx(
        'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
        active
          ? 'text-accent bg-accent-soft'
          : 'text-text-tertiary hover:text-text hover:bg-bg-secondary',
      )}
    >
      {children}
    </button>
  )
}

function ChevronIcon({ expanded }: { expanded: boolean }): React.JSX.Element {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      className={clsx('text-text-tertiary shrink-0 transition-transform', expanded && 'rotate-90')}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

function FolderGlyph({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="text-info shrink-0"
    >
      {open ? (
        <path d="M5 19l2.7-7.2A2 2 0 0 1 9.6 10H21l-3 8.1a2 2 0 0 1-1.9 1.3H5zm0 0V5a2 2 0 0 1 2-2h4l2 3h6a2 2 0 0 1 2 2v2" />
      ) : (
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      )}
    </svg>
  )
}

function EyeIcon(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
