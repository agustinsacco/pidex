import { memo, useState } from 'react'
import clsx from 'clsx'
import { Markdown } from '@/components/markdown/Markdown'

export const ThinkingBlock = memo(function ThinkingBlock({
  text,
  streaming,
}: {
  text: string
  streaming: boolean
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <button
        onClick={() => setExpanded((e) => !e)}
        className="text-text-tertiary hover:text-text-secondary flex items-center gap-1.5 py-0.5 text-base italic transition-colors"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className={clsx('transition-transform duration-150', expanded && 'rotate-90')}
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
        {streaming ? (
          <span className="thinking-shimmer">Thinking…</span>
        ) : (
          <span>Thought process</span>
        )}
      </button>
      {expanded && (
        <div className="border-border text-text-secondary mt-1 mb-0.5 border-l-2 pl-3 text-lg italic opacity-90 [&_.md-content]:text-lg">
          <Markdown text={text} streaming={streaming} />
        </div>
      )}
    </div>
  )
})
