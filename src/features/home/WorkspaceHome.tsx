import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { GitInfo, WorkspaceSessionStats } from '@shared/models'
import { useSessionsStore } from '@/stores/sessions'
import { useWorkspacesStore } from '@/stores/workspaces'
import { MenuRow, PopupMenu } from '@/components/PopupMenu'
import { AttachButton, SubmitIconButton } from '@/components/ComposerButtons'
import { HomeModelPicker } from './HomeModelPicker'
import { formatCost, formatTokens } from '@/lib/format'
import { StatTile } from '@/components/StatTile'
import { workspaceName as workspaceDisplayName } from '@/lib/path'
import { CheckIcon } from '@/components/icons'
import {
  composePrompt,
  formatFileSize,
  toAttachment,
  toImageContents,
  type PendingAttachment,
} from '@/features/chat/attachments'
import { BranchWorktreeChip, type StartTarget } from '@/features/worktrees/BranchWorktreeChip'

/** Greeting home for a workspace: stats card + heatmap + first-prompt composer. */
export function WorkspaceHome({ workspacePath }: { workspacePath: string }): React.JSX.Element {
  const [stats, setStats] = useState<WorkspaceSessionStats | null>(null)
  const [git, setGit] = useState<GitInfo | null>(null)
  const [username, setUsername] = useState('')
  const [text, setText] = useState('')
  const [images, setImages] = useState<PendingAttachment[]>([])
  const [dragging, setDragging] = useState(false)
  const [starting, setStarting] = useState(false)
  /** Where the next session runs: null = this workspace, else a worktree. */
  const [startTarget, setStartTarget] = useState<StartTarget | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const workspaceName = workspaceDisplayName(workspacePath)

  /** Images inline; everything else attaches by path (see attachments.ts). */
  const addFile = async (file: File): Promise<void> => {
    const attachment = await toAttachment(file, (f) => window.pidex.pathForFile(f))
    if (!attachment) return
    setImages((current) => [...current, attachment])
  }

  const handlePaste = (event: React.ClipboardEvent): void => {
    const files = [...event.clipboardData.items]
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (files.length === 0) return
    event.preventDefault()
    for (const file of files) void addFile(file)
  }

  /** Without preventDefault on dragover the card is never a drop target. */
  const handleDragOver = (event: React.DragEvent): void => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    if (!dragging) setDragging(true)
  }

  const handleDragLeave = (event: React.DragEvent): void => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setDragging(false)
  }

  const handleDrop = (event: React.DragEvent): void => {
    const files = [...event.dataTransfer.files]
    setDragging(false)
    if (files.length === 0) return
    event.preventDefault()
    for (const file of files) void addFile(file)
  }

  useEffect(() => {
    setStartTarget(null)
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
      // Worktree sessions start in the worktree's cwd — pi records sessions
      // under that folder, so the sidebar groups them under the worktree.
      await useSessionsStore.getState().createSession(startTarget?.cwd ?? workspacePath, {
        firstPrompt: composePrompt(message, images),
        firstImages: toImageContents(images),
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
          <h1 className="text-center text-[28px] font-semibold tracking-tight">
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
                  You&apos;ve spent {formatCost(stats.cost)} thinking out loud in {workspaceName}.
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
            <WorkspaceChip workspacePath={workspacePath} name={workspaceName} />
            {git?.isRepo && git.branch && (
              <BranchWorktreeChip
                workspacePath={workspacePath}
                git={git}
                target={startTarget}
                onSelect={setStartTarget}
              />
            )}
          </div>
          {/* One seamless card: the submit affordance sits inside the field
              (a quiet ⏎ glyph), never as a second bordered row. */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={clsx(
              'bg-surface relative rounded-xl border shadow-sm transition-colors',
              dragging
                ? 'border-accent ring-accent/25 ring-2'
                : 'border-border hover:border-border-focus focus-within:border-border-focus',
            )}
          >
            {dragging && (
              <div className="bg-surface/85 pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl">
                <span className="text-text text-[12.5px] font-medium">
                  Drop to attach — images inline, other files by path
                </span>
              </div>
            )}
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2 px-3 pt-3">
                {images.map((attachment, index) => (
                  <div key={index} className="group/img relative">
                    {attachment.kind === 'image' ? (
                      <img
                        src={`data:${attachment.mimeType};base64,${attachment.data}`}
                        className="border-border h-16 w-16 rounded-lg border object-cover"
                      />
                    ) : (
                      <div
                        title={attachment.path}
                        className="border-border bg-bg-secondary flex h-16 max-w-48 flex-col justify-center gap-0.5 rounded-lg border px-2.5"
                      >
                        <span className="text-text truncate text-[11.5px] font-medium">
                          {attachment.name}
                        </span>
                        <span className="text-text-tertiary font-mono text-[10px]">
                          {formatFileSize(attachment.size)} · sent as path
                        </span>
                      </div>
                    )}
                    <button
                      onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
                      aria-label="Remove attachment"
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
              placeholder="Describe a task or ask a question"
              rows={Math.min(8, Math.max(2, text.split('\n').length))}
              className="composer-field text-text placeholder:text-text-tertiary block w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[14px] outline-none"
            />

            {/* Footer mirrors the chat composer: attachments on the left,
                model + thinking on the right, submit at the far right. */}
            <div className="flex items-center justify-between gap-2 px-2.5 pb-2">
              <AttachButton
                onFiles={(files) => {
                  for (const file of files) void addFile(file)
                }}
              />

              <div className="flex shrink-0 items-center gap-0.5">
                <HomeModelPicker />
                <SubmitIconButton
                  busy={starting}
                  disabled={!text.trim()}
                  onClick={() => void start()}
                  label={starting ? 'Starting session' : 'Start session'}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
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
                      backgroundColor: `color-mix(in srgb, var(--px-accent) ${Math.round(intensity * 100)}%, var(--px-border) ${Math.round((1 - intensity) * 60)}%)`,
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
  triggerRef,
  children,
}: {
  icon?: React.ReactNode
  title?: string
  testId?: string
  onClick: () => void
  open: boolean
  /** Passed to PopupMenu so a second click closes instead of re-opening. */
  triggerRef?: React.RefObject<HTMLButtonElement | null>
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      ref={triggerRef}
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
  const triggerRef = useRef<HTMLButtonElement>(null)
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
        triggerRef={triggerRef}
      >
        {name}
      </Chip>

      {open && (
        <PopupMenu
          onClose={() => setOpen(false)}
          triggerRef={triggerRef}
          className="absolute bottom-full left-0 z-40 mb-1.5 max-h-80 w-64 overflow-y-auto py-1.5"
        >
          <div className="text-text-tertiary px-3 pb-1 pt-1 text-[10.5px] font-medium font-mono uppercase tracking-wide">
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
