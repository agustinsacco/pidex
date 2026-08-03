import { memo } from 'react'
import clsx from 'clsx'
import { useFilesStore, type OpenFile } from '@/stores/files'
import { MonacoEditor } from './MonacoEditor'

export const EditorPane = memo(function EditorPane(): React.JSX.Element {
  const openFiles = useFilesStore((s) => s.openFiles)
  const activePath = useFilesStore((s) => s.activePath)
  const active = openFiles.find((f) => f.path === activePath)

  if (openFiles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="text-text-tertiary text-[13px]">No file open</div>
          <div className="text-text-tertiary mt-1 text-[11.5px]">
            Pick a file from the explorer or press ⌘P
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto border-b px-1.5 pt-1">
        {openFiles.map((file) => (
          <Tab key={file.path} file={file} active={file.path === activePath} />
        ))}
      </div>
      {active?.diskConflict && <ConflictBar file={active} />}
      <div className="min-h-0 flex-1">
        {active && !active.binary && !active.tooLarge && <ActiveEditor file={active} />}
        {active?.binary && <CenterNote>Binary file — open it in your editor of choice.</CenterNote>}
        {active?.tooLarge && <CenterNote>File is larger than 4 MB — not opened.</CenterNote>}
      </div>
    </div>
  )
})

function ActiveEditor({ file }: { file: OpenFile }): React.JSX.Element {
  const revealLine = file.pendingRevealLine
  return (
    <MonacoEditor
      path={file.path}
      language={file.language}
      value={file.content}
      revealLine={revealLine}
      onChange={(value) => useFilesStore.getState().updateBuffer(file.path, value)}
      onSave={() => void useFilesStore.getState().saveFile(file.path)}
    />
  )
}

function Tab({ file, active }: { file: OpenFile; active: boolean }): React.JSX.Element {
  const name = file.relativePath.split('/').pop() ?? file.relativePath
  return (
    <div
      className={clsx(
        'group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-t-lg border border-b-0 px-3 py-1.5 text-[12px] transition-colors',
        active
          ? 'border-border bg-surface text-text'
          : 'border-transparent text-text-tertiary hover:text-text',
      )}
      onClick={() => useFilesStore.getState().setActive(file.path)}
      title={file.relativePath}
    >
      <span className="max-w-40 truncate">{name}</span>
      {file.dirty && <span className="bg-accent h-1.5 w-1.5 shrink-0 rounded-full" />}
      <button
        onClick={(event) => {
          event.stopPropagation()
          useFilesStore.getState().closeFile(file.path)
        }}
        className={clsx(
          'text-text-tertiary hover:text-text -mr-1 rounded p-0.5 transition-opacity',
          !file.dirty && 'opacity-0 group-hover:opacity-100',
        )}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

function ConflictBar({ file }: { file: OpenFile }): React.JSX.Element {
  return (
    <div className="bg-warning/10 border-warning/30 flex items-center gap-2 border-b px-3 py-1.5 text-[12px]">
      <span className="text-text flex-1">File changed on disk while you had unsaved edits.</span>
      <button
        onClick={() => void useFilesStore.getState().reloadFromDisk(file.path)}
        className="border-border hover:bg-bg-secondary rounded-md border px-2 py-0.5 font-medium transition-colors"
      >
        Reload
      </button>
      <button
        onClick={() => useFilesStore.getState().keepBuffer(file.path)}
        className="border-border hover:bg-bg-secondary rounded-md border px-2 py-0.5 font-medium transition-colors"
      >
        Keep mine
      </button>
    </div>
  )
}

function CenterNote({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-text-tertiary text-[12.5px]">{children}</div>
    </div>
  )
}
