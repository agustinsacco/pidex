import clsx from 'clsx'
import { useChatStore } from '@/stores/chat'
import { useSessionsStore } from '@/stores/sessions'
import { useLayoutStore } from '@/stores/layout'
import { useArtifactsStore } from '@/stores/artifacts'
import { runningCount, sessionTerminals, useTerminalStore } from '@/stores/terminal'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
import { SessionMenu } from './SessionMenu'
import { ForkPickerModal } from './ForkPickerModal'
import { StatusStrip } from '@/features/extension-ui/ExtensionUiHosts'
import { workspaceName as workspaceDisplayName } from '@/lib/path'
import { sessionTitle } from '@/lib/sessionTitle'
import { GitChips } from './GitChips'
import { CrashBanner, NoModelsBanner } from './banners'

export function ChatView({
  sessionId,
  workspacePath,
}: {
  sessionId: string
  workspacePath: string
}): React.JSX.Element {
  const workspaceName = workspaceDisplayName(workspacePath)

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
  // pi never auto-titles, so fall back to the thread's own first prompt — the
  // same chain the sidebar uses (see lib/sessionTitle).
  const firstUserText = useChatStore((s) => {
    const first = s.sessions[sessionId]?.items.find((item) => item.kind === 'user')
    return first?.kind === 'user' ? first.text : undefined
  })
  const title = sessionTitle({ explicitName: sessionName, firstUserText })
  const rightPane = useLayoutStore((s) => s.rightPane)
  const workspacePath = useSessionsStore((s) => s.live[sessionId]?.workspacePath)

  return (
    <header className="titlebar-drag flex h-11 shrink-0 items-center gap-2 pl-4 pr-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="text-text truncate text-[13px] font-semibold">
          {title ?? 'New session'}
        </span>
        <span className="bg-bg-secondary text-text-secondary shrink-0 rounded-md px-2 py-0.5 text-[11.5px]">
          {workspaceName}
        </span>
        {workspacePath && <GitChips workspacePath={workspacePath} />}
      </div>
      {/* Reference order: terminal, files, changes, artifacts, kebab. */}
      <TerminalHeaderButton sessionId={sessionId} active={rightPane === 'terminal'} />
      <HeaderIconButton
        title="Files pane (⌘⇧E)"
        active={rightPane === 'files'}
        onClick={() => useLayoutStore.getState().toggleRightPane('files')}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      </HeaderIconButton>
      <HeaderIconButton
        title="Changes pane (⌘⇧G)"
        active={rightPane === 'changes'}
        onClick={() => useLayoutStore.getState().toggleRightPane('changes')}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 3v6m0 6v6M5 12h14" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      </HeaderIconButton>
      <ArtifactsHeaderButton sessionId={sessionId} active={rightPane === 'artifacts'} />
      <SessionMenu sessionId={sessionId} />
    </header>
  )
}

/** Numeric badge anchored to a header button's bottom-right corner. */
function HeaderCountBadge({
  count,
  tone = 'neutral',
  title,
}: {
  count: number
  tone?: 'neutral' | 'success' | 'accent'
  title?: string
}): React.JSX.Element | null {
  if (count === 0) return null
  return (
    <span
      title={title}
      className={clsx(
        'pointer-events-none absolute -bottom-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[8.5px] font-bold',
        tone === 'success'
          ? 'bg-success/15 text-success'
          : tone === 'accent'
            ? 'bg-accent-soft text-accent'
            : 'bg-bg-secondary text-text-secondary',
      )}
    >
      {count > 9 ? '9+' : count}
    </span>
  )
}

function TerminalHeaderButton({
  sessionId,
  active,
}: {
  sessionId: string
  active: boolean
}): React.JSX.Element {
  const tabCount = useTerminalStore((s) => sessionTerminals(s, sessionId).tabs.length)
  const running = useTerminalStore((s) => runningCount(s, sessionId))

  return (
    <div className="relative">
      <HeaderIconButton
        title="Terminal pane (⌘`)"
        active={active}
        onClick={() => useLayoutStore.getState().toggleRightPane('terminal')}
      >
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
          <path d="m5 8 4 4-4 4M13 16h6" />
        </svg>
      </HeaderIconButton>
      <HeaderCountBadge
        count={tabCount}
        tone={running > 0 ? 'success' : 'neutral'}
        title={
          running > 0 ? `${running} running` : `${tabCount} terminal${tabCount > 1 ? 's' : ''}`
        }
      />
      {running > 0 && (
        <span
          className="bg-success absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full"
          title={`${running} process${running > 1 ? 'es' : ''} running`}
        />
      )}
    </div>
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
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="3" y="3" width="18" height="14" rx="2" />
          <path d="M3 9h18M9 21h6" />
        </svg>
      </HeaderIconButton>
      <HeaderCountBadge count={count} tone="accent" title={`${count} artifacts`} />
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
