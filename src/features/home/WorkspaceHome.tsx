import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { WorkspaceSessionStats } from '@shared/models'
import { useSessionsStore } from '@/stores/sessions'
import { AttachButton, SubmitIconButton } from '@/components/ComposerButtons'
import { HomeModelPicker } from './HomeModelPicker'
import { formatCost, formatTokens } from '@/lib/format'
import { StatTile } from '@/components/StatTile'
import { workspaceName as workspaceDisplayName } from '@/lib/path'
import { COMPOSER_MAX_HEIGHT, useAutoResizeTextarea } from '@/lib/useAutoResizeTextarea'
import { ChatImage } from '@/features/chat/ChatImage'
import {
  composePrompt,
  formatFileSize,
  toAttachment,
  toImageContents,
  type PendingAttachment,
} from '@/features/chat/attachments'

/** Greeting home for a workspace: stats card + heatmap + first-prompt composer. */
export function WorkspaceHome({ workspacePath }: { workspacePath: string }): React.JSX.Element {
  const [stats, setStats] = useState<WorkspaceSessionStats | null>(null)
  const [username, setUsername] = useState('')
  const [text, setText] = useState('')
  const [images, setImages] = useState<PendingAttachment[]>([])
  const [dragging, setDragging] = useState(false)
  const [starting, setStarting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useAutoResizeTextarea(textareaRef, text, COMPOSER_MAX_HEIGHT)
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
    void window.pidex.invoke('sessions:stats', workspacePath).then(setStats)
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
      // The session starts in whatever workspace is open — including a
      // worktree, which pi records sessions under, so the sidebar groups them
      // there. The top bar's branch control is what changes that workspace;
      // this screen no longer keeps a second, competing notion of "target".
      await useSessionsStore.getState().createSession(workspacePath, {
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
      <div className="flex flex-1 flex-col items-center overflow-y-auto px-8">
        <div className="w-full max-w-2xl pt-10">
          <h1 className="text-center text-4xl font-semibold tracking-tight">
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
                <div className="text-text-tertiary mt-2 px-1 text-sm">
                  You&apos;ve spent {formatCost(stats.cost)} thinking out loud in {workspaceName}.
                </div>
              )}
            </div>
          )}

          {stats && stats.sessionCount === 0 && (
            <p className="text-text-secondary mt-4 text-center text-lg">
              Start your first session in <span className="font-medium">{workspaceName}</span> —
              describe a task below.
            </p>
          )}
        </div>

        {/*
          No folder/branch chips above the composer any more. Both now live in
          the top bar, which is visible from every screen — previously the
          branch control existed here AND in the chat header, so "which branch
          will this run on?" had two answers that could disagree, and neither
          was visible from the other screen.
        */}
        <div className="mt-auto w-full max-w-2xl pb-8 pt-8">
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
                <span className="text-text text-base font-medium">
                  Drop to attach — images inline, other files by path
                </span>
              </div>
            )}
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2 px-3 pt-3">
                {images.map((attachment, index) => (
                  <div key={index} className="group/img relative">
                    {attachment.kind === 'image' ? (
                      // Openable (click) and copyable (right-click) like the
                      // same image once it lands in the transcript.
                      <ChatImage
                        image={{
                          type: 'image',
                          data: attachment.data,
                          mimeType: attachment.mimeType,
                        }}
                        className="border-border h-16 w-16 rounded-lg border object-cover"
                      />
                    ) : (
                      <div
                        title={attachment.path}
                        className="border-border bg-bg-secondary flex h-16 max-w-48 flex-col justify-center gap-0.5 rounded-lg border px-2.5"
                      >
                        <span className="text-text truncate text-sm font-medium">
                          {attachment.name}
                        </span>
                        <span className="text-text-tertiary font-mono text-xs">
                          {formatFileSize(attachment.size)} · sent as path
                        </span>
                      </div>
                    )}
                    <button
                      onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
                      aria-label="Remove attachment"
                      className="bg-text text-bg absolute -right-1.5 -top-1.5 hidden h-4.5 w-4.5 cursor-pointer items-center justify-center rounded-full text-xs group-hover/img:flex"
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
              rows={2}
              className="composer-field text-text placeholder:text-text-tertiary block w-full resize-none overflow-y-auto bg-transparent px-4 pb-1 pt-3.5 text-lg outline-none"
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

function prettifyName(username: string): string {
  if (!username) return ''
  const cleaned = username.replace(/[._-]+/g, ' ').trim()
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}
