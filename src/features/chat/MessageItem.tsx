import { memo } from 'react'
import clsx from 'clsx'
import type {
  AssistantBlock,
  AssistantItem,
  BashItem,
  ChatItem,
  CustomItem,
  DividerItem,
  ToolState,
  UserItem,
} from './reducer'
import { Markdown } from '@/components/markdown/Markdown'
import { ThinkingBlock } from './blocks/ThinkingBlock'
import { ToolCard } from './tools/ToolCard'
import { CopyButton } from '@/components/CopyButton'
import { PiSpark } from '@/components/PiSpark'
import { absoluteTime, relativeTime } from '@/lib/time'
import { useChatUiStore } from './uiState'

interface MessageItemProps {
  item: ChatItem
  tools: Record<string, ToolState>
  hideThinking: boolean
  sessionId: string
}

export const MessageItemView = memo(function MessageItemView({
  item,
  tools,
  hideThinking,
  sessionId,
}: MessageItemProps): React.JSX.Element {
  switch (item.kind) {
    case 'user':
      return <UserMessage item={item} sessionId={sessionId} />
    case 'assistant':
      return <AssistantMessage item={item} tools={tools} hideThinking={hideThinking} />
    case 'bash':
      return <BashExecution item={item} />
    case 'divider':
      return <Divider item={item} />
    case 'custom':
      return <CustomMessageItem item={item} />
  }
})

/** Extension-injected message; badged when it also reaches the LLM. */
function CustomMessageItem({ item }: { item: CustomItem }): React.JSX.Element {
  return (
    <div className="border-info/30 bg-info/5 rounded-lg border border-dashed px-3.5 py-2.5">
      <div className="mb-1 flex items-center gap-1.5">
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-info shrink-0"
        >
          <path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
        <span className="text-info text-[10.5px] font-semibold uppercase tracking-wide">
          {item.customType ? `Extension · ${item.customType}` : 'Extension message'}
        </span>
        {item.inContext && (
          <span
            className="bg-info/15 text-info rounded px-1.5 py-px text-[9.5px] font-medium"
            title="This message is included in the model's context"
          >
            in context
          </span>
        )}
      </div>
      {item.images && item.images.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-2">
          {item.images.map((img, i) => (
            <img
              key={i}
              src={`data:${img.mimeType};base64,${img.data}`}
              className="max-h-32 rounded-md"
            />
          ))}
        </div>
      )}
      {item.text && <Markdown text={item.text} />}
    </div>
  )
}

function UserMessage({
  item,
  sessionId,
}: {
  item: UserItem
  sessionId: string
}): React.JSX.Element {
  return (
    <div className="group flex flex-col items-end gap-1.5">
      {item.images && item.images.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {item.images.map((img, i) => (
            <img
              key={i}
              src={`data:${img.mimeType};base64,${img.data}`}
              className="max-h-40 rounded-lg"
            />
          ))}
        </div>
      )}
      {item.text && (
        <div className="bg-user-bubble relative max-w-[85%] rounded-xl px-4 py-2.5 text-[14px] whitespace-pre-wrap">
          {item.text}
          <div className="absolute -left-14 top-1.5 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={() => useChatUiStore.getState().openForkPicker(sessionId)}
              title="Fork from here (edit & resend)"
              className="text-text-tertiary hover:text-text hover:bg-bg-secondary flex h-6 items-center rounded-md px-1.5 transition-colors"
            >
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
            </button>
            <CopyButton text={item.text} />
          </div>
        </div>
      )}
      {item.timestamp != null && (
        <span
          className="text-text-tertiary h-4 pr-1 text-[11px] opacity-0 transition-opacity group-hover:opacity-100"
          title={absoluteTime(item.timestamp)}
        >
          {relativeTime(item.timestamp)}
        </span>
      )}
    </div>
  )
}

/** Group consecutive tool blocks so they render as one bordered run. */
function groupBlocks(blocks: AssistantBlock[]): Array<AssistantBlock | AssistantBlock[]> {
  const groups: Array<AssistantBlock | AssistantBlock[]> = []
  for (const block of blocks) {
    if (block.type === 'tool') {
      const last = groups[groups.length - 1]
      if (Array.isArray(last)) {
        last.push(block)
        continue
      }
      groups.push([block])
    } else {
      groups.push(block)
    }
  }
  return groups
}

function AssistantMessage({
  item,
  tools,
  hideThinking,
}: {
  item: AssistantItem
  tools: Record<string, ToolState>
  hideThinking: boolean
}): React.JSX.Element {
  const groups = groupBlocks(item.blocks)
  const failed = item.stopReason === 'error'
  const aborted = item.stopReason === 'aborted'
  const fullText = item.blocks
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n\n')

  return (
    <div className="group/msg relative">
      {groups.map((group, i) => {
        if (Array.isArray(group)) {
          return (
            <div key={`tools-${i}`} className="my-2">
              {group.map((block) =>
                block.type === 'tool' ? (
                  <ToolBlockView
                    key={block.toolCallId}
                    toolCallId={block.toolCallId}
                    tools={tools}
                  />
                ) : null,
              )}
            </div>
          )
        }
        if (group.type === 'thinking') {
          if (hideThinking) return null
          const isLast = i === groups.length - 1
          return (
            <ThinkingBlock
              key={`b-${group.index}`}
              text={group.text}
              streaming={item.streaming && isLast && !group.closed}
            />
          )
        }
        if (group.type === 'text') {
          const isLast = i === groups.length - 1
          return (
            <div
              key={`b-${group.index}`}
              className={clsx(item.streaming && isLast && !group.closed && 'streaming-tail')}
            >
              <Markdown text={group.text} streaming={item.streaming && !group.closed} />
            </div>
          )
        }
        return null
      })}

      {item.streaming && item.blocks.length === 0 && (
        <div className="py-1">
          <PiSpark />
        </div>
      )}

      {failed && (
        <div className="bg-danger-soft border-danger/25 mt-2 rounded-lg border px-3.5 py-2.5 text-[13px]">
          <span className="text-danger font-medium">Error</span>
          <span className="text-text-secondary">
            {' '}
            — {item.errorMessage ?? 'The model request failed.'}
          </span>
        </div>
      )}
      {aborted && (
        <div className="text-text-tertiary my-2 flex items-center gap-2.5 text-[11.5px]">
          <span className="bg-border h-px flex-1" />
          stopped
          <span className="bg-border h-px flex-1" />
        </div>
      )}

      {/*
       * Reserved-height affordance row: rendering it always (rather than
       * conditionally) keeps hovering from shifting the transcript.
       */}
      {!item.streaming && fullText && (
        <div className="mt-1 flex h-6 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/msg:opacity-100">
          <CopyButton text={fullText} label="Copy" />
          {item.timestamp != null && (
            <span className="text-text-tertiary text-[11px]" title={absoluteTime(item.timestamp)}>
              {relativeTime(item.timestamp)}
            </span>
          )}
          {item.usage?.cost?.total != null && (
            <span className="text-text-tertiary text-[10.5px]">
              ${item.usage.cost.total.toFixed(4)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function ToolBlockView({
  toolCallId,
  tools,
}: {
  toolCallId: string
  tools: Record<string, ToolState>
}): React.JSX.Element | null {
  const tool = tools[toolCallId]
  if (!tool) return null
  return <ToolCard tool={tool} />
}

function BashExecution({ item }: { item: BashItem }): React.JSX.Element {
  return (
    <div className="border-border bg-surface overflow-hidden rounded-lg border">
      <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-2">
        <code className="text-text flex-1 truncate font-mono text-[12px]">
          <span className="text-accent font-semibold">!</span> {item.command}
        </code>
        <div className="flex shrink-0 items-center gap-2">
          {item.excludeFromContext && (
            <span className="bg-bg-secondary text-text-tertiary rounded px-1.5 py-px text-[10.5px]">
              not sent to model
            </span>
          )}
          {item.running ? (
            <span className="text-text-tertiary text-[11px]">running…</span>
          ) : (
            <span
              className={clsx(
                'rounded px-1.5 py-px font-mono text-[10.5px] font-medium',
                item.exitCode === 0 ? 'bg-success/15 text-success' : 'bg-danger-soft text-danger',
              )}
            >
              exit {item.exitCode ?? '?'}
            </span>
          )}
        </div>
      </div>
      <pre className="max-h-72 overflow-auto px-3 py-2.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
        {item.output || (item.running ? '…' : '(no output)')}
      </pre>
      {item.truncated && item.fullOutputPath && (
        <div className="border-border text-text-tertiary border-t px-3 py-1.5 text-[11px]">
          Truncated — full output at <code className="font-mono">{item.fullOutputPath}</code>
        </div>
      )}
    </div>
  )
}

function Divider({ item }: { item: DividerItem }): React.JSX.Element {
  const [label, tone] =
    item.variant === 'compaction'
      ? [
          `Context compacted${item.tokensBefore ? ` — ${formatTokens(item.tokensBefore)} tokens summarized` : ''}`,
          'default' as const,
        ]
      : item.variant === 'branchSummary'
        ? ['Branched from earlier conversation', 'default' as const]
        : [item.summary ?? 'Error', 'error' as const]

  return (
    <DividerShell label={label} tone={tone}>
      {item.variant !== 'error' && item.summary ? (
        <details className="text-text-secondary mx-auto mt-1 max-w-lg text-[12px]">
          <summary className="text-text-tertiary hover:text-text cursor-pointer text-center text-[11px]">
            show summary
          </summary>
          <div className="border-border bg-surface mt-1.5 max-h-56 overflow-auto rounded-lg border px-3 py-2 whitespace-pre-wrap">
            {item.summary}
          </div>
        </details>
      ) : null}
    </DividerShell>
  )
}

function DividerShell({
  label,
  tone,
  children,
}: {
  label: string
  tone: 'default' | 'error'
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="my-1">
      <div
        className={clsx(
          'flex items-center gap-2.5 text-[11.5px]',
          tone === 'error' ? 'text-danger' : 'text-text-tertiary',
        )}
      >
        <span className={clsx('h-px flex-1', tone === 'error' ? 'bg-danger/30' : 'bg-border')} />
        <span className="max-w-[80%] truncate">{label}</span>
        <span className={clsx('h-px flex-1', tone === 'error' ? 'bg-danger/30' : 'bg-border')} />
      </div>
      {children}
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}
