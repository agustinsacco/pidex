import { useChatStore } from '@/stores/chat'
import { useSessionsStore } from '@/stores/sessions'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
import { SessionMenu } from './SessionMenu'
import { ForkPickerModal } from './ForkPickerModal'

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

  return (
    <header className="titlebar-drag flex h-11 shrink-0 items-center gap-2 pl-4 pr-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="text-text truncate text-[13px] font-semibold">
          {sessionName ?? 'New session'}
        </span>
        <span className="bg-bg-secondary text-text-secondary shrink-0 rounded-md px-2 py-0.5 text-[11.5px]">
          {workspaceName}
        </span>
      </div>
      <SessionMenu sessionId={sessionId} />
    </header>
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

/** No models configured: point at terminal login / config (terminal lands in P4). */
function NoModelsBanner({ sessionId }: { sessionId: string }): React.JSX.Element | null {
  const meta = useChatStore((s) => s.sessions[sessionId]?.meta)
  const models = useChatStore((s) => s.sessions[sessionId]?.models)
  if (!meta || models === undefined || models === null) return null
  if (models.length > 0) return null

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pt-2">
      <div className="bg-warning/10 border-warning/30 rounded-lg border px-4 py-3 text-[13px]">
        <div className="text-text font-medium">No models configured</div>
        <div className="text-text-secondary mt-1 leading-relaxed">
          pi has no providers set up yet. Run <code className="bg-code-bg rounded px-1 font-mono text-[12px]">pi</code>{' '}
          in a terminal and use <code className="bg-code-bg rounded px-1 font-mono text-[12px]">/login</code> for OAuth
          providers, set an API key env var (e.g.{' '}
          <code className="bg-code-bg rounded px-1 font-mono text-[12px]">ANTHROPIC_API_KEY</code>), or add a custom
          endpoint in <code className="bg-code-bg rounded px-1 font-mono text-[12px]">~/.pi/agent/models.json</code>.
          pidex&apos;s built-in terminal arrives in P4.
        </div>
      </div>
    </div>
  )
}
