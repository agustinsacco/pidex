import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { GitInfo, WorkspaceSessionStats } from '@shared/models'
import { useSessionsStore } from '@/stores/sessions'
import { useWorkspacesStore } from '@/stores/workspaces'
import { MenuRow, PopupMenu } from '@/components/PopupMenu'
import { HomeModelPicker } from './HomeModelPicker'
import { formatTokens } from '@/lib/format'
import { workspaceName as workspaceDisplayName } from '@/lib/path'
import { BranchIcon, CheckIcon, Spinner } from '@/components/icons'
import { bytesToBase64 } from '@/lib/base64'

interface PendingImage {
  data: string
  mimeType: string
}

/** Greeting home for a workspace: stats card + heatmap + first-prompt composer. */
export function WorkspaceHome({ workspacePath }: { workspacePath: string }): React.JSX.Element {
  const [stats, setStats] = useState<WorkspaceSessionStats | null>(null)
  const [git, setGit] = useState<GitInfo | null>(null)
  const [username, setUsername] = useState('')
  const [text, setText] = useState('')
  const [images, setImages] = useState<PendingImage[]>([])
  const [starting, setStarting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const workspaceName = workspaceDisplayName(workspacePath)

  const addImageFile = async (file: File): Promise<void> => {
    const data = bytesToBase64(await file.arrayBuffer())
    setImages((current) => [...current, { data, mimeType: file.type }])
  }

  const handlePaste = (event: React.ClipboardEvent): void => {
    const items = [...event.clipboardData.items].filter((item) => item.type.startsWith('image/'))
    if (items.length === 0) return
    event.preventDefault()
    for (const item of items) {
      const file = item.getAsFile()
      if (file) void addImageFile(file)
    }
  }

  const handleDrop = (event: React.DragEvent): void => {
    const files = [...event.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
    if (files.length === 0) return
    event.preventDefault()
    for (const file of files) void addImageFile(file)
  }

  /** Native file chooser for the "+" button (paste and drop also work). */
  const pickImages = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.onchange = () => {
      for (const file of [...(input.files ?? [])]) void addImageFile(file)
    }
    input.click()
  }

  useEffect(() => {
    void window.pidex.invoke('sessions:stats', workspacePath).then(setStats)
    void window.pidex.invoke('git:info', workspacePath).then(setGit)
    void window.pidex
      .invoke('app:userInfo')
      .then((info) => setUsername(prettifyName(info.username)))
    textareaRef.current?.focus()
  }, [workspacePath])

  const start = async (): Promise<void> => {
    const message = text.trim()
    if (!message || starting) return
    setStarting(true)
    try {
      await useSessionsStore.getState().createSession(workspacePath, {
        firstPrompt: message,
        firstImages: images.map((img) => ({
          type: 'image',
          data: img.data,
          mimeType: img.mimeType,
        })),
      })
      setText('')
      setImages([])
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="titlebar-drag h-11 shrink-0" />
      <div className="flex flex-1 flex-col items-center overflow-y-auto px-8">
        <div className="w-full max-w-2xl pt-10">
          <h1 className="text-center font-serif text-[30px] font-medium tracking-tight">
            <span className="text-accent mr-2">✳</span>
            What&apos;s up next{username ? `, ${username}` : ''}?
          </h1>

          {stats && stats.sessionCount > 0 && (
            <div className="border-border bg-bg-secondary/60 mt-8 rounded-xl border p-4">
              <div className="grid grid-cols-4 gap-2">
                <StatTile label="Sessions" value={formatNumber(stats.sessionCount)} />
                <StatTile label="Messages" value={formatNumber(stats.messages)} />
                <StatTile label="Total tokens" value={formatTokens(stats.tokens)} />
                <StatTile label="Active days" value={String(stats.activeDays)} />
              </div>
              <Heatmap activityByDay={stats.activityByDay} />
              {stats.cost > 0 && (
                <div className="text-text-tertiary mt-2 px-1 text-[11.5px]">
                  You&apos;ve spent ${stats.cost.toFixed(2)} thinking out loud in {workspaceName}.
                </div>
              )}
            </div>
          )}

          {stats && stats.sessionCount === 0 && (
            <p className="text-text-secondary mt-4 text-center text-[13.5px]">
              Start your first session in <span className="font-medium">{workspaceName}</span> —
              describe a task below.
            </p>
          )}
        </div>

        <div className="mt-auto w-full max-w-2xl pb-8 pt-8">
          <div className="mb-2 flex items-center gap-1.5 px-1">
            <EnvironmentChip />
            <WorkspaceChip workspacePath={workspacePath} name={workspaceName} />
            {git?.isRepo && git.branch && <BranchChip git={git} workspacePath={workspacePath} />}
          </div>
          {/* One seamless card: the submit affordance sits inside the field
              (a quiet ⏎ glyph), never as a second bordered row. */}
          <div className="border-border bg-surface hover:border-border-focus focus-within:border-border-focus relative rounded-xl border shadow-sm transition-colors">
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2 px-3 pt-3">
                {images.map((img, index) => (
                  <div key={index} className="group/img relative">
                    <img
                      src={`data:${img.mimeType};base64,${img.data}`}
                      className="border-border h-16 w-16 rounded-lg border object-cover"
                    />
                    <button
                      onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
                      aria-label="Remove image"
                      className="bg-text text-bg absolute -right-1.5 -top-1.5 hidden h-4.5 w-4.5 cursor-pointer items-center justify-center rounded-full text-[10px] group-hover/img:flex"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void start()
                }
              }}
              onPaste={handlePaste}
              onDrop={handleDrop}
              placeholder="Describe a task or ask a question"
              rows={Math.min(8, Math.max(2, text.split('\n').length))}
              className="composer-field text-text placeholder:text-text-tertiary block w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[14px] outline-none"
            />

            {/* Footer mirrors the chat composer: attachments on the left,
                model + thinking on the right, submit at the far right. */}
            <div className="flex items-center justify-between gap-2 px-2.5 pb-2">
              <button
                onClick={() => void pickImages()}
                aria-label="Attach images"
                title="Attach images"
                className="text-text-tertiary hover:text-text hover:bg-bg-secondary flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>

              <div className="flex shrink-0 items-center gap-0.5">
                <HomeModelPicker />
                <SubmitButton
                  starting={starting}
                  disabled={!text.trim()}
                  onClick={() => void start()}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SubmitButton({
  starting,
  disabled,
  onClick,
}: {
  starting: boolean
  disabled: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled || starting}
      aria-label={starting ? 'Starting session' : 'Start session'}
      title="Start session (⏎)"
      className="text-text-tertiary hover:text-text hover:bg-bg-secondary flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-30"
    >
      {starting ? (
        <Spinner className="text-current" />
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 10 4 15l5 5" />
          <path d="M20 4v7a4 4 0 0 1-4 4H4" />
        </svg>
      )}
    </button>
  )
}

function StatTile({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="bg-surface border-border rounded-lg border px-3 py-2.5">
      <div className="text-text-tertiary text-[11px]">{label}</div>
      <div className="text-text mt-0.5 text-[17px] font-semibold tabular-nums">{value}</div>
    </div>
  )
}

const WEEKS = 26

function Heatmap({ activityByDay }: { activityByDay: Record<string, number> }): React.JSX.Element {
  const cells = useMemo(() => {
    const today = new Date()
    const days: { key: string; count: number }[] = []
    for (let i = WEEKS * 7 - 1; i >= 0; i--) {
      const date = new Date(today)
      date.setDate(today.getDate() - i)
      const key = date.toISOString().slice(0, 10)
      days.push({ key, count: activityByDay[key] ?? 0 })
    }
    return days
  }, [activityByDay])

  const max = Math.max(1, ...cells.map((c) => c.count))

  return (
    <div className="mt-3 overflow-x-auto px-1">
      <div className="grid grid-flow-col gap-[3px]" style={{ gridTemplateRows: 'repeat(7, 10px)' }}>
        {cells.map((cell) => {
          const intensity = cell.count === 0 ? 0 : Math.max(0.25, Math.min(1, cell.count / max))
          return (
            <div
              key={cell.key}
              title={`${cell.key}: ${cell.count} messages`}
              className={clsx(
                'h-[10px] w-[10px] rounded-[2.5px]',
                cell.count === 0 && 'bg-border/60',
              )}
              style={
                cell.count > 0
                  ? {
                      backgroundColor: `color-mix(in srgb, var(--px-info) ${Math.round(intensity * 100)}%, var(--px-border) ${Math.round((1 - intensity) * 60)}%)`,
                    }
                  : undefined
              }
            />
          )
        })}
      </div>
    </div>
  )
}

/**
 * Composer chip. Every chip opens a popover, so all of them are buttons with
 * a pointer cursor and a caret — a chip that looks identical to its
 * neighbours but does nothing on click reads as broken.
 */
function Chip({
  icon,
  title,
  testId,
  onClick,
  open,
  children,
}: {
  icon?: React.ReactNode
  title?: string
  testId?: string
  onClick: () => void
  open: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      data-testid={testId}
      aria-expanded={open}
      className={clsx(
        'border-border flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-medium transition-colors',
        open
          ? 'bg-bg-secondary text-text border-border-strong'
          : 'bg-surface text-text-secondary hover:text-text hover:border-border-strong',
      )}
    >
      {icon}
      {children}
      <Caret />
    </button>
  )
}

function Caret(): React.JSX.Element {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      className="text-text-tertiary shrink-0"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function prettifyName(username: string): string {
  if (!username) return ''
  const cleaned = username.replace(/[._-]+/g, ' ').trim()
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

function MonitorIcon(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  )
}

function FolderIcon(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )
}

/**
 * Where the agent runs. pidex only ever spawns pi as a local subprocess, so
 * there is nothing to switch to yet; the popover says so plainly rather than
 * offering a disabled "Remote" row that implies a feature that does not
 * exist.
 */
function EnvironmentChip(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative">
      <Chip icon={<MonitorIcon />} onClick={() => setOpen((o) => !o)} open={open}>
        Local
      </Chip>
      {open && (
        <PopupMenu
          onClose={() => setOpen(false)}
          className="absolute bottom-full left-0 z-40 mb-1.5 w-64 p-3"
        >
          <div className="text-text text-[13px] font-medium">Local</div>
          <p className="text-text-secondary mt-1 text-[12px] leading-relaxed">
            pi runs as a subprocess on this machine, with the workspace folder as its working
            directory. Remote execution isn&apos;t available yet.
          </p>
        </PopupMenu>
      )}
    </span>
  )
}

/**
 * Branch status. Read-only on purpose: switching branches from a chip next to
 * the composer would mutate the working tree behind the user's back, and
 * there is no checkout IPC to do it safely. It reports state and hands off to
 * the terminal.
 */
function BranchChip({
  git,
  workspacePath,
}: {
  git: GitInfo
  workspacePath: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const dirty = git.dirtyCount ?? 0

  return (
    <span className="relative">
      <Chip
        icon={<BranchIcon />}
        onClick={() => setOpen((o) => !o)}
        open={open}
        title={`Branch ${git.branch ?? ''}`}
      >
        {git.branch}
        {dirty > 0 ? <span className="text-warning ml-1">·{dirty}</span> : null}
      </Chip>
      {open && (
        <PopupMenu
          onClose={() => setOpen(false)}
          className="absolute bottom-full left-0 z-40 mb-1.5 w-64 py-1.5"
        >
          <div className="px-3 pb-1.5 pt-1">
            <div className="text-text truncate text-[13px] font-medium">{git.branch}</div>
            <div className="text-text-secondary mt-1 text-[12px]">
              {dirty > 0
                ? `${dirty} uncommitted change${dirty === 1 ? '' : 's'}`
                : 'Working tree clean'}
              {git.ahead ? ` · ${git.ahead} ahead` : ''}
              {git.behind ? ` · ${git.behind} behind` : ''}
            </div>
          </div>
          <div className="border-border my-1 border-t" />
          <MenuRow
            active={false}
            onClick={() => {
              setOpen(false)
              void window.pidex.invoke('app:revealPath', workspacePath)
            }}
          >
            <span className="text-[13px]">Reveal in file manager</span>
          </MenuRow>
        </PopupMenu>
      )}
    </span>
  )
}

/**
 * The folder chip doubles as the workspace picker: clicking it opens a
 * popover of recents plus "Open folder…". Putting it here — rather than on
 * the New button — keeps the folder visible at the moment you compose, next
 * to the branch you are on.
 */
function WorkspaceChip({
  workspacePath,
  name,
}: {
  workspacePath: string
  name: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const recents = useWorkspacesStore((s) => s.recents)

  const choose = (path: string): void => {
    setOpen(false)
    if (path === workspacePath) return
    useWorkspacesStore.getState().openWorkspace(path)
    // Leave any active session, or the derived workspace keeps pointing at it.
    useSessionsStore.getState().activate(null)
  }

  return (
    <span className="relative">
      <Chip
        icon={<FolderIcon />}
        title={workspacePath}
        testId="workspace-chip"
        onClick={() => setOpen((o) => !o)}
        open={open}
      >
        {name}
      </Chip>

      {open && (
        <PopupMenu
          onClose={() => setOpen(false)}
          className="absolute bottom-full left-0 z-40 mb-1.5 max-h-80 w-64 overflow-y-auto py-1.5"
        >
          <div className="text-text-tertiary px-3 pb-1 pt-1 text-[10.5px] font-medium uppercase tracking-wide">
            Recent
          </div>
          {recents.map((ws) => (
            <MenuRow key={ws.path} active={false} onClick={() => choose(ws.path)}>
              <span className="min-w-0 flex-1 truncate text-[13px]">{ws.name}</span>
              {ws.path === workspacePath && <CheckIcon className="text-accent shrink-0" />}
            </MenuRow>
          ))}
          <div className="border-border my-1 border-t" />
          <MenuRow
            active={false}
            onClick={() => {
              setOpen(false)
              void useWorkspacesStore
                .getState()
                .pickAndOpen()
                .then((path) => {
                  if (path) useSessionsStore.getState().activate(null)
                })
            }}
          >
            <span className="text-[13px]">Open folder…</span>
          </MenuRow>
        </PopupMenu>
      )}
    </span>
  )
}
