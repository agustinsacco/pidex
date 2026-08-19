import { memo, useEffect, useState } from 'react'
import clsx from 'clsx'
import type { AssistantBlock, AssistantItem, CustomItem, ToolState, UserItem } from './reducer'
import { Markdown } from '@/components/markdown/Markdown'
import { CopyButton } from '@/components/CopyButton'
import { PiSpark } from '@/components/PiSpark'
import { absoluteTime, relativeTime } from '@/lib/time'
import { useChatUiStore } from './uiState'
import { ActivityGroup } from './items/ActivityGroup'
import type { TranscriptRow } from './items/transcriptRows'
import { RunCommandRow } from '@/components/RunCommandRow'
import { matchErrorRemedy } from './errorRemedies'
import { useActiveWorkspace } from '@/stores/workspaces'
import { BranchIcon } from '@/components/icons'
import { BashExecution } from './items/BashExecution'
import { Divider } from './items/Divider'

interface MessageItemProps {
  row: TranscriptRow
  tools: Record<string, ToolState>
  hideThinking: boolean
  sessionId: string
  activityActive?: boolean
}

/**
 * One transcript row. Rows come from `buildTranscriptRows`, which groups agent
 * activity across pi's message boundaries — so an `activity` row can span
 * several assistant messages, while prose and outcomes stay per-message.
 */
export const MessageItemView = memo(function MessageItemView({
  row,
  tools,
  hideThinking,
  sessionId,
  activityActive = false,
}: MessageItemProps): React.JSX.Element | null {
  switch (row.kind) {
    case 'activity':
      return (
        <ActivityGroup
          steps={row.steps}
          tools={tools}
          hideThinking={hideThinking}
          sessionId={sessionId}
          active={activityActive}
        />
      )
    case 'text':
      return <AssistantText item={row.item} block={row.block} isLastInItem={row.isLastInItem} />
    case 'outcome':
      return <AssistantOutcome item={row.item} />
    case 'item':
      switch (row.item.kind) {
        case 'user':
          return <UserMessage item={row.item} sessionId={sessionId} />
        case 'assistant':
          // Only reached for an empty streaming turn (spinner placeholder).
          return (
            <div className="py-1">
              <PiSpark />
            </div>
          )
        case 'bash':
          return <BashExecution item={row.item} />
        case 'divider':
          return <Divider item={row.item} />
        case 'custom':
          return <CustomMessageItem item={row.item} />
      }
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

/**
 * One assistant prose block, with the hover meta pill.
 *
 * The pill copies the WHOLE message's prose (not just this block), since that
 * is what a reader means by "copy the answer" when a turn interleaves text
 * with tool calls.
 */
function AssistantText({
  item,
  block,
  isLastInItem,
}: {
  item: AssistantItem
  block: Extract<AssistantBlock, { type: 'text' }>
  isLastInItem: boolean
}): React.JSX.Element {
  const fullText = item.blocks
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n\n')
  const streamingTail = item.streaming && isLastInItem && !block.closed

  return (
    <div className="group/msg relative">
      <div className={clsx(streamingTail && 'streaming-tail')}>
        <Markdown text={block.text} streaming={item.streaming && !block.closed} />
      </div>

      {/*
       * Hover affordances float above the row's top-right corner as an
       * absolutely-positioned pill: zero layout height, so hover can never
       * reflow the virtualized transcript (measured heights stay stable).
       */}
      {!item.streaming && fullText && (
        <div className="pointer-events-none absolute -top-2 right-0 z-10 opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover/msg:pointer-events-auto group-hover/msg:opacity-100">
          <div className="border-border bg-surface-raised flex items-center gap-1 rounded-md border px-1.5 py-0.5 shadow-sm">
            <CopyButton text={fullText} label="Copy" />
            {item.timestamp != null && (
              <span className="text-text-tertiary text-[11px]" title={absoluteTime(item.timestamp)}>
                {relativeTime(item.timestamp)}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** How an assistant turn ended, when it did not end cleanly. */
function AssistantOutcome({ item }: { item: AssistantItem }): React.JSX.Element | null {
  if (item.stopReason === 'error') return <ErrorBlock message={item.errorMessage} />
  if (item.stopReason === 'aborted') {
    return (
      <div className="text-text-tertiary my-1 flex items-center gap-2.5 text-[11.5px]">
        <span className="bg-border h-px flex-1" />
        stopped
        <span className="bg-border h-px flex-1" />
      </div>
    )
  }
  return null
}

/**
 * Failed turn. When the message names a failure pidex knows the fix for, that
 * fix is offered inline instead of leaving the user to go find it: a runnable
 * command for the shell-fixable ones (expired AWS SSO token, missing pi login),
 * and for configuration failures that no command can fix (Bedrock's
 * account-level data retention mode) a docs link plus a pointer at the model
 * menu, which is the actual workaround.
 */
export function ErrorBlock({ message }: { message?: string }): React.JSX.Element {
  const workspacePath = useActiveWorkspace()
  const [awsProfile, setAwsProfile] = useState<string | undefined>(undefined)

  useEffect(() => {
    void window.pidex.invoke('app:userInfo').then((info) => setAwsProfile(info.awsProfile))
  }, [])

  const remedy = matchErrorRemedy(message, { awsProfile })

  return (
    <div className="bg-danger-soft border-danger/25 mt-2 rounded-lg border px-3.5 py-2.5 text-[13px]">
      <span className="text-danger font-medium">Error</span>
      <span className="text-text-secondary"> — {message ?? 'The model request failed.'}</span>
      {remedy && (
        <>
          <div className="text-text-secondary mt-1.5 text-[12px] leading-relaxed">
            {remedy.hint}
          </div>
          {remedy.command !== undefined && (
            <RunCommandRow
              command={remedy.command}
              label={remedy.label}
              workspacePath={workspacePath ?? undefined}
            />
          )}
          {(remedy.docsUrl || remedy.suggestModelSwitch) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
              {remedy.docsUrl && (
                <a
                  href={remedy.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  {remedy.label}
                </a>
              )}
              {remedy.suggestModelSwitch && (
                <span className="text-text-tertiary">
                  Switch models from the picker in the composer below.
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
