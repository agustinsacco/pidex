import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { ImageContent } from '@shared/rpc'
import { useChatStore } from '@/stores/chat'
import { fuzzyFilter } from '@/lib/fuzzy'
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
import { Spinner } from './tools/ToolCard'
import { useChatUiStore } from './uiState'
import { WidgetSlot } from '@/features/extension-ui/ExtensionUiHosts'

interface PendingImage {
  data: string
  mimeType: string
}

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
  const [images, setImages] = useState<PendingImage[]>([])
  const [mention, setMention] = useState<MentionState | null>(null)
  const [command, setCommand] = useState<CommandState | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
        run: () => void runExport(sessionId),
      },
      {
        name: 'name',
        description: 'Rename this session',
        run: () => {
          const name = window.prompt('Session name')
          if (name)
            void window.pidex.piCommand(sessionId, { type: 'set_session_name', name }).then((r) => {
              if (r.success) useChatStore.getState().patchMeta(sessionId, { sessionName: name })
            })
        },
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
            output: (error as Error).message,
            exitCode: -1,
            running: false,
          })
        }
        return
      }

      const imagePayload: ImageContent[] = images.map((img) => ({
        type: 'image',
        data: img.data,
        mimeType: img.mimeType,
      }))

      setText('')
      setImages([])
      setCommand(null)
      setMention(null)

      // Only non-command prompts render as user bubbles immediately; extension
      // commands echo through the event stream if they produce messages.
      chat.addUserMessage(sessionId, message, imagePayload.length ? imagePayload : undefined)

      try {
        const response = await window.pidex.piCommand(sessionId, {
          type: 'prompt',
          message,
          ...(imagePayload.length ? { images: imagePayload } : {}),
          ...(isStreaming ? { streamingBehavior: behavior ?? 'steer' } : {}),
        })
        if (!response.success) chat.setError(sessionId, response.error)
      } catch (error) {
        chat.setError(sessionId, (error as Error).message)
      }
    },
    [sessionId, text, images, isStreaming],
  )

  const abort = useCallback(async () => {
    const chat = useChatStore.getState()
    const queues = chat.sessions[sessionId]?.queues
    const queuedText = [...(queues?.steering ?? []), ...(queues?.followUp ?? [])].join('\n')
    try {
      await window.pidex.piCommand(sessionId, { type: 'abort' })
      // Escape semantics: restore queued messages into the composer.
      if (queuedText) {
        setText((current) => (current ? current + '\n' + queuedText : queuedText))
        textareaRef.current?.focus()
      }
    } catch (error) {
      chat.setError(sessionId, (error as Error).message)
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
    const items = [...event.clipboardData.items].filter((item) => item.type.startsWith('image/'))
    if (items.length === 0) return
    event.preventDefault()
    for (const item of items) {
      const file = item.getAsFile()
      if (file) void addImageFile(file)
    }
  }

  const handleDrop = (event: React.DragEvent): void => {
    const files = [...event.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
    if (files.length === 0) return
    event.preventDefault()
    for (const file of files) void addImageFile(file)
  }

  const addImageFile = async (file: File): Promise<void> => {
    const buffer = await file.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buffer)
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    setImages((current) => [...current, { data: btoa(binary), mimeType: file.type }])
  }

  const placeholder = isStreaming
    ? 'Steer with Enter · queue follow-up with ⌥Enter · Esc to stop'
    : 'Describe a task…  ( / commands · @ files · ! shell )'

  return (
    <div className="shrink-0 px-6 pb-4 pt-1">
      <RetryStrip sessionId={sessionId} />
      <WidgetSlot sessionId={sessionId} placement="aboveEditor" />
      <QueueChips
        sessionId={sessionId}
        onRecall={(queued) => {
          setText((current) => (current ? current + '\n' + queued : queued))
          textareaRef.current?.focus()
        }}
      />

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

        <div className="border-border bg-surface focus-within:border-border-strong rounded-xl border shadow-sm transition-colors">
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {images.map((img, index) => (
                <div key={index} className="group/img relative">
                  <img
                    src={`data:${img.mimeType};base64,${img.data}`}
                    className="border-border h-16 w-16 rounded-lg border object-cover"
                  />
                  <button
                    onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
                    className="bg-text text-bg absolute -right-1.5 -top-1.5 hidden h-4.5 w-4.5 items-center justify-center rounded-full text-[10px] group-hover/img:flex"
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
            onDrop={handleDrop}
            placeholder={placeholder}
            rows={Math.min(10, Math.max(1, text.split('\n').length))}
            className="text-text placeholder:text-text-tertiary block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[14px] outline-none"
          />

          <div className="flex items-center justify-between gap-2 px-2.5 pb-2">
            <div className="flex min-w-0 items-center gap-1">
              {isStreaming ? (
                <button
                  onClick={() => void abort()}
                  className="border-border hover:border-danger hover:text-danger flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors"
                >
                  <span className="bg-danger inline-block h-2 w-2 rounded-[3px]" />
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => void send()}
                  disabled={!text.trim() && images.length === 0}
                  className="bg-accent hover:bg-accent-hover text-accent-text shrink-0 rounded-md px-3 py-1 text-[12px] font-medium transition-colors disabled:opacity-40"
                >
                  Send ⏎
                </button>
              )}
              {isCompacting && (
                <span className="text-text-tertiary flex items-center gap-1.5 px-1.5 text-[11.5px]">
                  <Spinner /> compacting…
                </span>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-0.5">
              <ContextMeter sessionId={sessionId} />
              <ModelPicker sessionId={sessionId} />
              {isStreaming && <Spinner />}
            </div>
          </div>
        </div>

        <div
          className={clsx(
            'text-text-tertiary px-2 pt-1.5 text-[10.5px]',
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
  const chat = useChatStore.getState()
  const response = await window.pidex.piCommand(sessionId, { type: 'compact' })
  if (!response.success) chat.setError(sessionId, response.error)
}

async function runExport(sessionId: string): Promise<void> {
  const chat = useChatStore.getState()
  const outputPath = await window.pidex.invoke('app:saveDialog', {
    title: 'Export session as HTML',
    defaultPath: 'session.html',
    filters: [{ name: 'HTML', extensions: ['html'] }],
  })
  if (!outputPath) return
  const response = await window.pidex.piCommand(sessionId, { type: 'export_html', outputPath })
  if (response.success && response.data) {
    await window.pidex.invoke('app:revealPath', response.data.path)
  } else if (!response.success) {
    chat.setError(sessionId, response.error)
  }
}
