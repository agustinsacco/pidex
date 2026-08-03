import { memo, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { highlightCode } from './highlighter'
import { CopyButton } from '../CopyButton'

interface CodeBlockProps {
  code: string
  language: string
  /** While the fence is still open we show plain mono (no flicker). */
  streaming?: boolean
  actions?: React.ReactNode
}

export const CodeBlock = memo(function CodeBlock({
  code,
  language,
  streaming = false,
  actions,
}: CodeBlockProps): React.JSX.Element {
  const [html, setHtml] = useState<string | null>(null)
  const requestRef = useRef(0)

  useEffect(() => {
    if (streaming) return
    const request = ++requestRef.current
    let cancelled = false
    void highlightCode(code, language || 'text').then((result) => {
      if (!cancelled && request === requestRef.current) setHtml(result)
    })
    return () => {
      cancelled = true
    }
  }, [code, language, streaming])

  return (
    <div className="code-block border-border bg-code-bg group/code relative my-3 overflow-hidden rounded-lg border">
      <div className="border-border text-text-tertiary flex h-8 items-center justify-between border-b px-3">
        <span className="font-mono text-[11px] uppercase tracking-wide">{language || 'text'}</span>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/code:opacity-100">
          {actions}
          <CopyButton text={code} />
        </div>
      </div>
      <div className="overflow-x-auto">
        {html && !streaming ? (
          <div
            className="shiki-container px-4 py-3 font-mono text-[12.5px] leading-relaxed"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className="m-0 px-4 py-3 font-mono text-[12.5px] leading-relaxed whitespace-pre">
            {code}
          </pre>
        )}
      </div>
    </div>
  )
})

interface InlineCodeProps {
  children: React.ReactNode
  className?: string
}

export function InlineCode({ children, className }: InlineCodeProps): React.JSX.Element {
  return (
    <code
      className={clsx(
        'bg-code-bg border-border rounded-[5px] border px-[5px] py-[1.5px] font-mono text-[0.86em]',
        className,
      )}
    >
      {children}
    </code>
  )
}
