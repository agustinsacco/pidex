import { useState } from 'react'
import clsx from 'clsx'
import { CheckIcon } from '@/components/icons'

export function CopyButton({
  text,
  label,
  size = 'md',
  className,
}: {
  text: string
  label?: string
  /** 'sm' matches the compact hover-popover rows (message meta rows). */
  size?: 'sm' | 'md'
  className?: string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  const copy = (): void => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    })
  }

  const iconSize = size === 'sm' ? 11 : 13

  return (
    <button
      onClick={copy}
      title="Copy"
      className={clsx(
        'text-text-tertiary hover:text-text flex items-center gap-1 transition-colors',
        size === 'sm'
          ? 'h-4 text-[11px]'
          : 'hover:bg-bg-secondary h-6 rounded-md px-1.5 text-[11px]',
        className,
      )}
    >
      {copied ? <CheckIcon size={iconSize} /> : <CopyIcon size={iconSize} />}
      {label && <span>{copied ? 'Copied' : label}</span>}
    </button>
  )
}

function CopyIcon({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
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
