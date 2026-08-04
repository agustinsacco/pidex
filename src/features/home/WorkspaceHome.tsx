import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { GitInfo, WorkspaceSessionStats } from '@shared/models'
import { useSessionsStore } from '@/stores/sessions'
import { useWorkspacesStore } from '@/stores/workspaces'
import { MenuRow, PopupMenu } from '@/components/PopupMenu'

/** Greeting home for a workspace: stats card + heatmap + first-prompt composer. */
export function WorkspaceHome({ workspacePath }: { workspacePath: string }): React.JSX.Element {
  const [stats, setStats] = useState<WorkspaceSessionStats | null>(null)
  const [git, setGit] = useState<GitInfo | null>(null)
  const [username, setUsername] = useState('')
  const [text, setText] = useState('')
  const [starting, setStarting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const workspaceName = workspacePath.split(/[/\\]/).filter(Boolean).pop() ?? workspacePath

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
      await useSessionsStore.getState().createSession(workspacePath, { firstPrompt: message })
      setText('')
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
            <Chip icon={<MonitorIcon />}>Local</Chip>
            <WorkspaceChip workspacePath={workspacePath} name={workspaceName} />
            {git?.isRepo && git.branch && (
              <Chip icon={<BranchIcon />}>
                {git.branch}
                {git.dirtyCount ? (
                  <span className="text-warning ml-1">·{git.dirtyCount}</span>
                ) : null}
              </Chip>
            )}
          </div>
          {/* One seamless card: the submit affordance sits inside the field
              (a quiet ⏎ glyph), never as a second bordered row. */}
          <div className="border-border bg-surface focus-within:border-border-strong relative rounded-xl border shadow-sm transition-colors">
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
              placeholder="Describe a task or ask a question"
              rows={Math.min(8, Math.max(2, text.split('\n').length))}
              // Right padding keeps text clear of the ⏎ button.
              className="text-text placeholder:text-text-tertiary block w-full resize-none bg-transparent py-3.5 pl-4 pr-12 text-[14px] outline-none"
            />
            <button
              onClick={() => void start()}
              disabled={!text.trim() || starting}
              aria-label={starting ? 'Starting session' : 'Start session'}
              title="Start session (⏎)"
              className="text-text-tertiary hover:text-text hover:bg-bg-secondary absolute bottom-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-30"
            >
              {starting ? (
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="3"
                  />
                  <path
                    className="opacity-90"
                    fill="currentColor"
                    d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2z"
                  />
                </svg>
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
          </div>
        </div>
      </div>
    </div>
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

function Chip({
  icon,
  children,
}: {
  icon?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span className="border-border bg-surface text-text-secondary flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-medium">
      {icon}
      {children}
    </span>
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

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
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

function BranchIcon(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <path d="M6 8.5v7M18 8.5a9 9 0 0 1-9 9" />
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
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid="workspace-chip"
        title={workspacePath}
        className="border-border bg-surface text-text-secondary hover:text-text hover:border-border-strong flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-medium transition-colors"
      >
        <FolderIcon />
        {name}
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="text-text-tertiary"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

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
              {ws.path === workspacePath && (
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className="text-accent shrink-0"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
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
