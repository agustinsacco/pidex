import { memo } from 'react'
import clsx from 'clsx'
import type { AssistantItem, ChatItem, CustomItem, ToolState, UserItem } from './reducer'
import { Markdown } from '@/components/markdown/Markdown'
import { ThinkingBlock } from './blocks/ThinkingBlock'
import { ToolCard } from './tools/ToolCard'
import { CopyButton } from '@/components/CopyButton'
import { PiSpark } from '@/components/PiSpark'
import { absoluteTime, relativeTime } from '@/lib/time'
import { useChatUiStore } from './uiState'
import { groupBlocks } from './items/groupBlocks'
import { BranchIcon } from '@/components/icons'
import { BashExecution } from './items/BashExecution'
import { Divider } from './items/Divider'

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
        <span className="text-info text-[10.5px] font-semibold font-mono uppercase tracking-wide">
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
    <div className="group flex flex-col items-end gap-1">
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
              <BranchIcon size={12} />
            </button>
            <CopyButton text={item.text} />
          </div>
        </div>
      )}
      {item.timestamp != null && (
        <span
          className="text-text-tertiary h-3.5 pr-1 text-[11px] leading-none opacity-0 transition-opacity group-hover:opacity-100"
          title={absoluteTime(item.timestamp)}
        >
          {relativeTime(item.timestamp)}
        </span>
      )}
    </div>
  )
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
        <div className="mt-0.5 flex h-5 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/msg:opacity-100">
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
