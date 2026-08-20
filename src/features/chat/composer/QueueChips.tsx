import { useChatStore } from '@/stores/chat'

/**
 * Pending steering / follow-up messages (from queue_update).
 *
 * These are status chips, not buttons. Pi's RPC protocol can clear all queues
 * via abort, but cannot remove one entry; the old click handler only copied
 * the text into the editor while leaving it queued, which looked broken and
 * could make users submit the same instruction twice.
 */
export function QueueChips({ sessionId }: { sessionId: string }): React.JSX.Element | null {
  const queues = useChatStore((s) => s.sessions[sessionId]?.queues)
  if (!queues || (queues.steering.length === 0 && queues.followUp.length === 0)) return null

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-wrap gap-1.5 px-1 pb-2">
      {queues.steering.map((text, i) => (
        <QueueChip key={`s-${i}`} kind="steer" text={text} />
      ))}
      {queues.followUp.map((text, i) => (
        <QueueChip key={`f-${i}`} kind="follow-up" text={text} />
      ))}
    </div>
  )
}

function QueueChip({
  kind,
  text,
}: {
  kind: 'steer' | 'follow-up'
  text: string
}): React.JSX.Element {
  const steer = kind === 'steer'
  return (
    <div
      title={text || (steer ? 'Steering message queued' : 'Follow-up message queued')}
      className={
        steer
          ? 'bg-accent-soft text-accent border-accent/25 flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-base transition-opacity hover:opacity-80'
          : 'bg-info/10 text-info border-info/25 flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-base transition-opacity hover:opacity-80'
      }
    >
      <span className="shrink-0 text-xs font-semibold font-mono uppercase tracking-wide">
        {steer ? 'Steer queued' : 'Follow-up queued'}
      </span>
      {text && <span className="truncate">{text}</span>}
    </div>
  )
}
