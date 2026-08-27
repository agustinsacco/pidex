import { MessageList } from './MessageList'
import { Composer } from './Composer'
import { ForkPickerModal } from './ForkPickerModal'
import { StatusStrip } from '@/features/extension-ui/ExtensionUiHosts'
import { CrashBanner, NoModelsBanner } from './banners'
import { LaneBanner } from '@/features/lanes/LaneBanner'

/**
 * The chat column: banners, transcript, composer.
 *
 * It deliberately has no header of its own. Session title, workspace, branch,
 * and the pane switches all live in the window's single top bar
 * (src/app/TopBar.tsx) — a per-column header here could not know whether it was
 * the element sitting under the OS window controls, which is precisely how the
 * right-hand pane's buttons ended up rendering beneath them.
 */
export function ChatView({
  sessionId,
  workspacePath,
}: {
  sessionId: string
  workspacePath: string
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <CrashBanner sessionId={sessionId} workspacePath={workspacePath} />
      <NoModelsBanner sessionId={sessionId} />
      <MessageList sessionId={sessionId} />
      {/* The lane's STATE, directly above where you decide what to type next.
          The transcript above is only its history. */}
      <LaneBanner sessionId={sessionId} className="mx-auto w-full max-w-3xl px-4" />
      <Composer sessionId={sessionId} workspacePath={workspacePath} />
      <StatusStrip sessionId={sessionId} />
      <ForkPickerModal sessionId={sessionId} />
    </div>
  )
}
