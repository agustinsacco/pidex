import { useChatStore } from '@/stores/chat'

/**
 * Queued steering / follow-up messages (from queue_update).
 * pi's RPC protocol has no queue-removal command, so chips offer "recall"
 * (copy back into the composer) rather than delete.
 */
export function QueueChips({
  sessionId,
  onRecall,
}: {
  sessionId: string
  onRecall: (text: string) => void
}): React.JSX.Element | null {
  const queues = useChatStore((s) => s.sessions[sessionId]?.queues)
  if (!queues || (queues.steering.length === 0 && queues.followUp.length === 0)) return null

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-wrap gap-1.5 px-1 pb-2">
      {queues.steering.map((text, i) => (
        <QueueChip key={`s-${i}`} kind="steer" text={text} onRecall={() => onRecall(text)} />
      ))}
      {queues.followUp.map((text, i) => (
        <QueueChip key={`f-${i}`} kind="follow-up" text={text} onRecall={() => onRecall(text)} />
      ))}
    </div>
  )
}

function QueueChip({
  kind,
  text,
  onRecall,
}: {
  kind: 'steer' | 'follow-up'
  text: string
  onRecall: () => void
}): React.JSX.Element {
  const steer = kind === 'steer'
  return (
    <button
      onClick={onRecall}
      title="Click to copy back into the composer"
      className={
        steer
          ? 'bg-accent-soft text-accent border-accent/25 flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition-opacity hover:opacity-80'
          : 'bg-info/10 text-info border-info/25 flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition-opacity hover:opacity-80'
      }
    >
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide">
        {steer ? 'Steer' : 'Follow-up'}
      </span>
      <span className="truncate">{text}</span>
    </button>
  )
}
