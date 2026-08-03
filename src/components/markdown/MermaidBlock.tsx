import { memo, useEffect, useId, useState } from 'react'
import { useSettingsStore } from '@/stores/settings'
import { CodeBlock } from './CodeBlock'
import { Lightbox } from '../Lightbox'

let mermaidCounter = 0

export const MermaidBlock = memo(function MermaidBlock({
  code,
}: {
  code: string
}): React.JSX.Element {
  const resolvedTheme = useSettingsStore((s) => s.resolvedTheme)
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoomed, setZoomed] = useState(false)
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, '')

  useEffect(() => {
    let cancelled = false
    setError(null)
    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({
          startOnLoad: false,
          theme: resolvedTheme === 'dark' ? 'dark' : 'neutral',
          fontFamily: 'var(--px-font-sans)',
          securityLevel: 'strict',
        })
        const id = `mmd-${reactId}-${mermaidCounter++}`
        const result = await mermaid.render(id, code)
        if (!cancelled) setSvg(result.svg)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code, resolvedTheme, reactId])

  if (error) {
    return (
      <div>
        <CodeBlock code={code} language="mermaid" />
        <div className="text-danger -mt-2 mb-3 px-1 text-xs">Mermaid parse error: {error}</div>
      </div>
    )
  }

  if (!svg) {
    return (
      <div className="border-border bg-surface my-3 flex h-32 animate-pulse items-center justify-center rounded-lg border">
        <span className="text-text-tertiary text-xs">Rendering diagram…</span>
      </div>
    )
  }

  return (
    <>
      <div
        className="mermaid-svg border-border bg-surface my-3 cursor-zoom-in overflow-x-auto rounded-lg border p-4 [&_svg]:mx-auto [&_svg]:max-w-full"
        onClick={() => setZoomed(true)}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {zoomed && (
        <Lightbox onClose={() => setZoomed(false)}>
          <div
            className="max-h-[90vh] max-w-[90vw] overflow-auto rounded-lg bg-white p-6 [&_svg]:h-auto [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </Lightbox>
      )}
    </>
  )
})
