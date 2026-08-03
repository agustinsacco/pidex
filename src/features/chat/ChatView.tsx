import { useEffect, useState } from 'react'
import clsx from 'clsx'
import type { GitInfo } from '@shared/models'
import { useChatStore } from '@/stores/chat'
import { useSessionsStore } from '@/stores/sessions'
import { useLayoutStore } from '@/stores/layout'
import { useArtifactsStore } from '@/stores/artifacts'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
import { SessionMenu } from './SessionMenu'
import { ForkPickerModal } from './ForkPickerModal'
import { StatusStrip } from '@/features/extension-ui/ExtensionUiHosts'

export function ChatView({
  sessionId,
  workspacePath,
}: {
  sessionId: string
  workspacePath: string
}): React.JSX.Element {
  const workspaceName = workspacePath.split(/[/\\]/).filter(Boolean).pop() ?? workspacePath

  return (
    <div className="flex h-full flex-col">
      <Header sessionId={sessionId} workspaceName={workspaceName} />
      <CrashBanner sessionId={sessionId} workspacePath={workspacePath} />
      <NoModelsBanner sessionId={sessionId} />
      <MessageList sessionId={sessionId} />
      <Composer sessionId={sessionId} workspacePath={workspacePath} />
      <StatusStrip sessionId={sessionId} />
      <ForkPickerModal sessionId={sessionId} />
    </div>
  )
}

function Header({
  sessionId,
  workspaceName,
}: {
  sessionId: string
  workspaceName: string
}): React.JSX.Element {
  const sessionName = useChatStore((s) => s.sessions[sessionId]?.meta?.sessionName)
  const rightPane = useLayoutStore((s) => s.rightPane)
  const workspacePath = useSessionsStore((s) => s.live[sessionId]?.workspacePath)

  return (
    <header className="titlebar-drag flex h-11 shrink-0 items-center gap-2 pl-4 pr-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="text-text truncate text-[13px] font-semibold">
          {sessionName ?? 'New session'}
        </span>
        <span className="bg-bg-secondary text-text-secondary shrink-0 rounded-md px-2 py-0.5 text-[11.5px]">
          {workspaceName}
        </span>
        {workspacePath && <GitChips workspacePath={workspacePath} />}
      </div>
      <HeaderIconButton
        title="Files pane (⌘⇧E)"
        active={rightPane === 'files'}
        onClick={() => useLayoutStore.getState().toggleRightPane('files')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      </HeaderIconButton>
      <HeaderIconButton
        title="Changes pane (⌘⇧G)"
        active={rightPane === 'changes'}
        onClick={() => useLayoutStore.getState().toggleRightPane('changes')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3v6m0 6v6M5 12h14" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      </HeaderIconButton>
      <ArtifactsHeaderButton sessionId={sessionId} active={rightPane === 'artifacts'} />
      <SessionMenu sessionId={sessionId} />
    </header>
  )
}

function ArtifactsHeaderButton({
  sessionId,
  active,
}: {
  sessionId: string
  active: boolean
}): React.JSX.Element | null {
  const count = useArtifactsStore((s) => Object.keys(s.bySession[sessionId] ?? {}).length)
  const unseen = useArtifactsStore((s) => s.unseen[sessionId] ?? 0)
  if (count === 0) return null

  return (
    <div className="relative">
      <HeaderIconButton
        title="Artifacts pane"
        active={active}
        onClick={() => useLayoutStore.getState().toggleRightPane('artifacts')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="14" rx="2" />
          <path d="M3 9h18M9 21h6" />
        </svg>
      </HeaderIconButton>
      {unseen > 0 && !active && (
        <span className="bg-accent absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full" />
      )}
    </div>
  )
}

function HeaderIconButton({
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
        'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
        active
          ? 'bg-accent-soft text-accent'
          : 'text-text-tertiary hover:text-text hover:bg-bg-secondary',
      )}
    >
      {children}
    </button>
  )
}

/** Branch / ahead-behind / dirty chips, refreshed on fs changes. */
function GitChips({ workspacePath }: { workspacePath: string }): React.JSX.Element | null {
  const [info, setInfo] = useState<GitInfo | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = (): void => {
      void window.pidex.invoke('git:info', workspacePath).then(setInfo)
    }
    refresh()
    void window.pidex.invoke('fs:watchWorkspace', workspacePath)
    const unsubscribe = window.pidex.onFsChanged((payload) => {
      if (payload.workspacePath !== workspacePath) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(refresh, 500)
    })
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [workspacePath])

  if (!info?.isRepo || !info.branch) return null
  return (
    <span className="bg-bg-secondary text-text-secondary flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-[11.5px]">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="6" cy="18" r="2.5" />
        <circle cx="18" cy="6" r="2.5" />
        <path d="M6 8.5v7M18 8.5a9 9 0 0 1-9 9" />
      </svg>
      <span className="max-w-36 truncate">{info.branch}</span>
      {(info.ahead ?? 0) > 0 && <span className="text-success">↑{info.ahead}</span>}
      {(info.behind ?? 0) > 0 && <span className="text-info">↓{info.behind}</span>}
      {(info.dirtyCount ?? 0) > 0 && <span className="text-warning">·{info.dirtyCount}</span>}
    </span>
  )
}

/** pi crashed: inline banner with one-click resume (session file survives). */
function CrashBanner({
  sessionId,
  workspacePath,
}: {
  sessionId: string
  workspacePath: string
}): React.JSX.Element | null {
  const error = useChatStore((s) => s.sessions[sessionId]?.error)
  const diskPath = useSessionsStore((s) => s.live[sessionId]?.diskPath)
  if (!error || !error.includes('exited unexpectedly')) return null

  const resume = async (): Promise<void> => {
    const store = useSessionsStore.getState()
    await store.disposeSession(sessionId)
    if (diskPath) {
      const metas = await window.pidex.invoke('sessions:list', workspacePath)
      const meta = metas.find((m) => m.path === diskPath)
      if (meta) {
        await store.openDiskSession(workspacePath, meta)
        return
      }
    }
    await store.createSession(workspacePath)
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pt-2">
      <div className="bg-danger-soft border-danger/25 flex items-center gap-3 rounded-lg border px-3.5 py-2.5">
        <span className="text-danger text-[13px] font-medium">pi crashed</span>
        <span className="text-text-secondary flex-1 truncate text-[12.5px]">{error}</span>
        <button
          onClick={() => void resume()}
          className="bg-accent hover:bg-accent-hover text-accent-text shrink-0 rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors"
        >
          Resume session
        </button>
      </div>
    </div>
  )
}

/** No models configured: hand off to the built-in terminal for `pi` login. */
function NoModelsBanner({ sessionId }: { sessionId: string }): React.JSX.Element | null {
  const meta = useChatStore((s) => s.sessions[sessionId]?.meta)
  const models = useChatStore((s) => s.sessions[sessionId]?.models)
  const workspacePath = useSessionsStore((s) => s.live[sessionId]?.workspacePath)
  if (!meta || models === undefined || models === null) return null
  if (models.length > 0) return null

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pt-2">
      <div className="bg-warning/10 border-warning/30 rounded-lg border px-4 py-3 text-[13px]">
        <div className="flex items-center justify-between gap-3">
          <div className="text-text font-medium">No models configured</div>
          {workspacePath && (
            <button
              onClick={() => {
                void import('@/stores/terminal').then(({ runInTerminal }) =>
                  runInTerminal(workspacePath, 'pi'),
                )
              }}
              className="bg-accent hover:bg-accent-hover text-accent-text shrink-0 rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors"
            >
              Open terminal with `pi`
            </button>
          )}
        </div>
        <div className="text-text-secondary mt-1 leading-relaxed">
          Run <code className="bg-code-bg rounded px-1 font-mono text-[12px]">pi</code> in the
          terminal and use <code className="bg-code-bg rounded px-1 font-mono text-[12px]">/login</code> for OAuth
          providers, set an API key env var (e.g.{' '}
          <code className="bg-code-bg rounded px-1 font-mono text-[12px]">ANTHROPIC_API_KEY</code>), or add a custom
          endpoint in <code className="bg-code-bg rounded px-1 font-mono text-[12px]">~/.pi/agent/models.json</code>.
        </div>
      </div>
    </div>
  )
}
