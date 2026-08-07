import { useState } from 'react'
import clsx from 'clsx'
import { CheckIcon } from '@/components/icons'

export function CopyButton({
  text,
  label,
  className,
}: {
  text: string
  label?: string
  className?: string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  const copy = (): void => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    })
  }

  return (
    <button
      onClick={copy}
      title="Copy"
      className={clsx(
        'text-text-tertiary hover:text-text hover:bg-bg-secondary flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] transition-colors',
        className,
      )}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {label && <span>{copied ? 'Copied' : label}</span>}
    </button>
  )
}

function CopyIcon(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}
