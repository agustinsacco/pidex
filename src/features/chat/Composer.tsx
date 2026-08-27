import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { ImageContent } from '@shared/rpc'
import { useChatStore } from '@/stores/chat'
import { fuzzyFilter } from '@/lib/fuzzy'
import { ChatImage } from './ChatImage'
import { QueueChips } from './composer/QueueChips'
import { ModelPicker } from './composer/ModelPicker'
import { ContextMeter } from './composer/ContextMeter'
import {
  buildCommandEntries,
  CommandMenu,
  filterCommandEntries,
  type CommandEntry,
  type NativeCommand,
} from './composer/CommandMenu'
import { FileMentionMenu } from './composer/FileMentionMenu'
import { RetryStrip } from './RetryStrip'
import { AgentLaunchStrip, WorkingIndicator } from './WorkingIndicator'
import { Spinner } from '@/components/icons'
import { AttachButton, StopIconButton, SubmitIconButton } from '@/components/ComposerButtons'
import { useChatUiStore } from './uiState'
import { WidgetSlot } from '@/features/extension-ui/ExtensionUiHosts'
import { exportSessionHtml, renameSession } from '@/features/sessions/sessionActions'
import { piCallOk } from '@/lib/rpc'
import { formatShortcut } from '@/lib/shortcuts'
import { COMPOSER_MAX_HEIGHT, useAutoResizeTextarea } from '@/lib/useAutoResizeTextarea'
import {
  composePrompt,
  formatFileSize,
  toAttachment,
  toImageContents,
  type PendingAttachment,
} from './attachments'
import { errorText } from '@shared/errors'

interface MentionState {
  /** Index of the '@' in the textarea value. */
  anchor: number
  query: string
}

interface CommandState {
  query: string
}

export function Composer({
  sessionId,
  workspacePath,
}: {
  sessionId: string
  workspacePath: string
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [images, setImages] = useState<PendingAttachment[]>([])
  const [dragging, setDragging] = useState(false)
  const [mention, setMention] = useState<MentionState | null>(null)
  const [command, setCommand] = useState<CommandState | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useAutoResizeTextarea(textareaRef, text, COMPOSER_MAX_HEIGHT)

  const isStreaming = useChatStore((s) => s.sessions[sessionId]?.isStreaming ?? false)
  const isCompacting = useChatStore((s) => s.sessions[sessionId]?.isCompacting ?? false)
  const piCommands = useChatStore((s) => s.sessions[sessionId]?.commands) ?? []

  // Lazy-load the workspace file index the first time an @-mention opens.
  const filesLoaded = useRef(false)
  useEffect(() => {
    if (mention && !filesLoaded.current) {
      filesLoaded.current = true
      void window.pidex.invoke('fs:listFiles', workspacePath).then(setWorkspaceFiles)
    }
  }, [mention, workspacePath])

  // Prefill from fork (edit-and-refork) or extension set_editor_text.
  const prefill = useChatUiStore((s) => s.prefill[sessionId])
  useEffect(() => {
    if (prefill !== undefined) {
      const text = useChatUiStore.getState().consumePrefill(sessionId)
      if (text !== undefined) {
        setText(text)
        textareaRef.current?.focus()
      }
    }
  }, [prefill, sessionId])

  const nativeCommands = useMemo<NativeCommand[]>(
    () => [
      {
        name: 'compact',
        description: 'Compact conversation context now',
        run: () => void runCompact(sessionId),
      },
      {
        name: 'export',
        description: 'Export this session as HTML',
        run: () => void exportSessionHtml(sessionId),
      },
      {
        name: 'name',
        description: 'Rename this session',
        run: () => void renameSession(sessionId),
      },
    ],
    [sessionId],
  )

  const commandEntries = useMemo(
    () => buildCommandEntries(piCommands, nativeCommands),
    [piCommands, nativeCommands],
  )

  const mentionMatches = useMemo(
    () => (mention ? fuzzyFilter(mention.query, workspaceFiles, (f) => f, 12) : []),
    [mention, workspaceFiles],
  )
  const commandMatches = useMemo(
    () => (command ? filterCommandEntries(command.query, commandEntries) : []),
    [command, commandEntries],
  )

  const updateOverlays = (value: string, caret: number): void => {
    // '/' command menu: only when the input starts with '/' and has no spaces yet.
    if (value.startsWith('/') && !/\s/.test(value)) {
      setCommand({ query: value.slice(1) })
    } else {
      setCommand(null)
    }
    // '@' mention: the token containing the caret starts with '@'.
    const before = value.slice(0, caret)
    const atMatch = /(^|\s)@([^\s@]*)$/.exec(before)
    if (atMatch) {
      setMention({ anchor: caret - atMatch[2]!.length - 1, query: atMatch[2]! })
    } else {
      setMention(null)
    }
    setActiveIndex(0)
  }

  const send = useCallback(
    async (behavior?: 'steer' | 'followUp') => {
      const message = text.trim()
      if (!message && images.length === 0) return

      const chat = useChatStore.getState()

      // `!command` / `!!command` → RPC bash execution.
      if (message.startsWith('!') && !isStreaming) {
        const exclude = message.startsWith('!!')
        const shellCommand = message.slice(exclude ? 2 : 1).trim()
        if (!shellCommand) return
        setText('')
        const itemId = chat.addBashItem(sessionId, {
          command: shellCommand,
          output: '',
          exitCode: null,
          running: true,
          truncated: false,
          excludeFromContext: exclude,
        })
        try {
          // Deliberately raw rather than `piCall` (CLAUDE.md fact 3): a failed
          // `!command` belongs in the bash item's own output next to the
          // command that produced it, not on the session-wide error surface.
          const response = await window.pidex.piCommand(sessionId, {
            type: 'bash',
            command: shellCommand,
            excludeFromContext: exclude,
          })
          if (response.success && response.data) {
            chat.updateBashItem(sessionId, itemId, {
              output: response.data.output,
              exitCode: response.data.exitCode,
              running: false,
              truncated: response.data.truncated,
              fullOutputPath: response.data.fullOutputPath,
            })
          } else if (!response.success) {
            chat.updateBashItem(sessionId, itemId, {
              output: response.error,
              exitCode: -1,
              running: false,
            })
          }
        } catch (error) {
          chat.updateBashItem(sessionId, itemId, {
            output: errorText(error),
            exitCode: -1,
            running: false,
          })
        }
        return
      }

      const imagePayload: ImageContent[] = toImageContents(images)
      // Non-image attachments ride along as paths in the prompt: pi's protocol
      // has no document type, so the agent opens them with its own tools.
      const messageWithFiles = composePrompt(message, images)

      setText('')
      setImages([])
      setCommand(null)
      setMention(null)

      // Only non-command prompts render as user bubbles immediately; extension
      // commands echo through the event stream if they produce messages.
      chat.addUserMessage(
        sessionId,
        messageWithFiles,
        imagePayload.length ? imagePayload : undefined,
      )

      try {
        await piCallOk(sessionId, {
          type: 'prompt',
          message: messageWithFiles,
          ...(imagePayload.length ? { images: imagePayload } : {}),
          ...(isStreaming ? { streamingBehavior: behavior ?? 'steer' } : {}),
        })
      } catch (error) {
        // `piCallOk` reports a rejected envelope; an IPC-level rejection (the
        // session's process died mid-send) still lands here.
        chat.setError(sessionId, errorText(error))
      }
    },
    [sessionId, text, images, isStreaming],
  )

  const abort = useCallback(async () => {
    const chat = useChatStore.getState()
    const queues = chat.sessions[sessionId]?.queues
    const queuedText = [...(queues?.steering ?? []), ...(queues?.followUp ?? [])].join('\n')
    try {
      await piCallOk(sessionId, { type: 'abort' })
      // Escape semantics: restore queued messages into the composer.
      if (queuedText) {
        setText((current) => (current ? current + '\n' + queuedText : queuedText))
        textareaRef.current?.focus()
      }
    } catch (error) {
      chat.setError(sessionId, errorText(error))
    }
  }, [sessionId])

  const pickMention = (file: string): void => {
    if (!mention) return
    const after = text.slice(mention.anchor + 1 + mention.query.length)
    const next = text.slice(0, mention.anchor) + file + (after.startsWith(' ') ? '' : ' ') + after
    setText(next)
    setMention(null)
    textareaRef.current?.focus()
  }

  const pickCommand = (entry: CommandEntry): void => {
    setCommand(null)
    if (entry.native) {
      setText('')
      entry.native.run()
      return
    }
    // pi commands: prefill "/name " so the user can add arguments, or send on Enter.
    setText(`/${entry.name} `)
    textareaRef.current?.focus()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // Popup navigation captures arrows/enter/escape while open.
    const popupItems = command ? commandMatches.length : mention ? mentionMatches.length : 0
    if (popupItems > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((i) => (i + 1) % popupItems)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((i) => (i - 1 + popupItems) % popupItems)
        return
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        if (command) {
          const entry = commandMatches[activeIndex]
          if (entry) pickCommand(entry)
        } else if (mention) {
          const file = mentionMatches[activeIndex]
          if (file) pickMention(file)
        }
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setCommand(null)
        setMention(null)
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        if (command) {
          const entry = commandMatches[activeIndex]
          if (entry) pickCommand(entry)
        } else if (mention) {
          const file = mentionMatches[activeIndex]
          if (file) pickMention(file)
        }
        return
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      // Alt/Cmd+Enter during streaming → follow-up; plain Enter → steer.
      void send(event.altKey || event.metaKey ? 'followUp' : 'steer')
      return
    }
    if (event.key === 'Escape' && isStreaming) {
      event.preventDefault()
      void abort()
    }
  }

  const handlePaste = (event: React.ClipboardEvent): void => {
    const files = [...event.clipboardData.items]
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (files.length === 0) return
    event.preventDefault()
    for (const file of files) void addFile(file)
  }

  /**
   * `dragover` must preventDefault or the element is never a valid drop
   * target: the drop then either never fires or Electron navigates the window
   * to the dropped file. This was the whole reason drag-and-drop appeared
   * broken even though the drop handler existed.
   */
  const handleDragOver = (event: React.DragEvent): void => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    if (!dragging) setDragging(true)
  }

  const handleDragLeave = (event: React.DragEvent): void => {
    // Only clear when the pointer leaves the drop zone itself, not when it
    // crosses between children.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setDragging(false)
  }

  const handleDrop = (event: React.DragEvent): void => {
    const files = [...event.dataTransfer.files]
    setDragging(false)
    if (files.length === 0) return
    event.preventDefault()
    for (const file of files) void addFile(file)
  }

  /** Images inline; everything else attaches by path (see attachments.ts). */
  const addFile = async (file: File): Promise<void> => {
    const attachment = await toAttachment(file, (f) => window.pidex.pathForFile(f))
    if (!attachment) return
    setImages((current) => [...current, attachment])
  }

  const placeholder = isStreaming
    ? `Steer with Enter · queue follow-up with ${formatShortcut('alt', 'Enter')} · Esc to stop`
    : 'Describe a task…  ( / commands · @ files · ! shell )'

  return (
    <div className="shrink-0 px-6 pb-4 pt-1">
      <WorkingIndicator sessionId={sessionId} />
      <AgentLaunchStrip sessionId={sessionId} />
      <RetryStrip sessionId={sessionId} />
      <WidgetSlot sessionId={sessionId} placement="aboveEditor" />
      <QueueChips sessionId={sessionId} />

      <div className="relative mx-auto max-w-3xl">
        {command && commandMatches.length > 0 && (
          <CommandMenu
            query={command.query}
            entries={commandEntries}
            activeIndex={activeIndex}
            onHover={setActiveIndex}
            onPick={pickCommand}
            onClose={() => setCommand(null)}
          />
        )}
        {mention && mentionMatches.length > 0 && (
          <FileMentionMenu
            files={mentionMatches}
            activeIndex={activeIndex}
            onHover={setActiveIndex}
            onPick={pickMention}
            onClose={() => setMention(null)}
          />
        )}

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={clsx(
            'bg-surface relative rounded-xl border shadow-sm transition-colors',
            dragging
              ? 'border-accent ring-accent/25 ring-2'
              : 'border-border hover:border-border-focus focus-within:border-border-focus',
          )}
        >
          {dragging && (
            <div className="bg-surface/85 pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl">
              <span className="text-text text-base font-medium">
                Drop to attach — images inline, other files by path
              </span>
            </div>
          )}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {images.map((attachment, index) => (
                <div key={index} className="group/img relative">
                  {attachment.kind === 'image' ? (
                    // Openable (click) and copyable (right-click) like the
                    // same image in the transcript; the ✕ above stays for
                    // removing it before sending.
                    <ChatImage
                      image={{
                        type: 'image',
                        data: attachment.data,
                        mimeType: attachment.mimeType,
                      }}
                      className="border-border h-16 w-16 rounded-lg border object-cover"
                    />
                  ) : (
                    <div
                      title={attachment.path}
                      className="border-border bg-bg-secondary flex h-16 max-w-48 flex-col justify-center gap-0.5 rounded-lg border px-2.5"
                    >
                      <span className="text-text truncate text-sm font-medium">
                        {attachment.name}
                      </span>
                      <span className="text-text-tertiary font-mono text-xs">
                        {formatFileSize(attachment.size)} · sent as path
                      </span>
                    </div>
                  )}
                  <button
                    onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
                    className="bg-text text-bg absolute -right-1.5 -top-1.5 hidden h-4.5 w-4.5 items-center justify-center rounded-full text-xs group-hover/img:flex"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              updateOverlays(
                event.target.value,
                event.target.selectionStart ?? event.target.value.length,
              )
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            rows={1}
            className="composer-field text-text placeholder:text-text-tertiary block w-full resize-none overflow-y-auto bg-transparent px-4 pt-3 pb-1 text-lg outline-none"
          />

          {/* Footer mirrors the reference: attach on the left, model +
              thinking + meter on the right, submit/stop as a quiet icon at
              the far right — never a filled pill. */}
          <div className="flex items-center justify-between gap-3 px-2.5 pb-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <AttachButton
                onFiles={(files) => {
                  for (const file of files) void addFile(file)
                }}
              />
              {isCompacting && (
                <span className="text-text-tertiary flex items-center gap-1.5 px-1 text-sm">
                  <Spinner /> compacting…
                </span>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {/*
                The orchestrator's mode used to sit here, beside model and
                thinking level, which read as a per-message setting. It is
                neither: it is per-project, persisted, and governs what the
                thread may do to other sessions. It lives in the orchestrator's
                banner now, next to the rest of its controls.
              */}
              <ContextMeter sessionId={sessionId} />
              <ModelPicker sessionId={sessionId} />
              <div className="flex items-center gap-1.5">
                {isStreaming && <Spinner />}
                {isStreaming ? (
                  <StopIconButton onClick={() => void abort()} />
                ) : (
                  <SubmitIconButton
                    disabled={!text.trim() && images.length === 0}
                    onClick={() => void send()}
                    label="Send message"
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        <div
          className={clsx(
            'text-text-tertiary px-2 pt-1.5 text-xs',
            !text.startsWith('!') && 'opacity-0',
          )}
        >
          <span className="font-mono">!cmd</span> runs in your shell and enters context on the next
          prompt · <span className="font-mono">!!cmd</span> keeps the output out of context
        </div>
        <WidgetSlot sessionId={sessionId} placement="belowEditor" />
      </div>
    </div>
  )
}

async function runCompact(sessionId: string): Promise<void> {
  await piCallOk(sessionId, { type: 'compact' })
}
