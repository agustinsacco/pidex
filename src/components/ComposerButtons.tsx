import { PlusIcon } from './icons'

/**
 * Quiet icon controls shared by the chat composer and the home composer.
 *
 * The reference composer never shows a filled "Send" pill: attachments live
 * behind a "+" on the left, and submit is a small ⏎ glyph on the far right
 * that only reads as active once there is something to send.
 */

const iconButtonClass =
  'text-text-tertiary hover:text-text hover:bg-bg-secondary flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-30'

export function AttachButton({ onFiles }: { onFiles: (files: File[]) => void }): React.JSX.Element {
  const pick = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    // Any file: images inline, everything else is attached by path.
    input.multiple = true
    input.onchange = () => {
      onFiles([...(input.files ?? [])])
    }
    input.click()
  }

  return (
    <button
      onClick={pick}
      aria-label="Attach files"
      title="Attach files — images inline, other files by path"
      className={iconButtonClass}
    >
      <PlusIcon size={16} />
    </button>
  )
}

/**
 * Bullet / numbered / code, next to Attach.
 *
 * Three, deliberately. The composer is a prompt box, not a document editor —
 * anything past these is faster to type as markdown than to reach for.
 */
export function FormatButtons({
  onBullet,
  onOrdered,
  onCode,
}: {
  onBullet: () => void
  onOrdered: () => void
  onCode: () => void
}): React.JSX.Element {
  const mod = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl'
  return (
    <div className="flex items-center" data-testid="format-buttons">
      <button
        onClick={onBullet}
        aria-label="Bullet list"
        title={`Bullet list (${mod}⇧8) · ⇧⏎ continues the list`}
        className={iconButtonClass}
      >
        <BulletListIcon />
      </button>
      <button
        onClick={onOrdered}
        aria-label="Numbered list"
        title={`Numbered list (${mod}⇧7) · ⇧⏎ continues the list`}
        className={iconButtonClass}
      >
        <OrderedListIcon />
      </button>
      <button
        onClick={onCode}
        aria-label="Code block"
        title={`Code block (${mod}⇧C)`}
        className={iconButtonClass}
      >
        <CodeIcon />
      </button>
    </div>
  )
}

function BulletListIcon(): React.JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="3.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function OrderedListIcon(): React.JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M9 6h12M9 12h12M9 18h12" />
      <text x="1" y="8" fontSize="7" fill="currentColor" stroke="none">
        1
      </text>
      <text x="1" y="14.5" fontSize="7" fill="currentColor" stroke="none">
        2
      </text>
      <text x="1" y="21" fontSize="7" fill="currentColor" stroke="none">
        3
      </text>
    </svg>
  )
}

function CodeIcon(): React.JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m8 17-5-5 5-5M16 7l5 5-5 5" />
    </svg>
  )
}

export function SubmitIconButton({
  busy,
  disabled,
  onClick,
  label,
}: {
  busy?: boolean
  disabled: boolean
  onClick: () => void
  label: string
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      aria-label={label}
      title={`${label} (⏎)`}
      className={iconButtonClass}
    >
      {busy ? (
        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path
            className="opacity-90"
            fill="currentColor"
            d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2z"
          />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 10 4 15l5 5" />
          <path d="M20 4v7a4 4 0 0 1-4 4H4" />
        </svg>
      )}
    </button>
  )
}

/** Stop control while streaming. Esc does the same; this is the visible way. */
export function StopIconButton({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      aria-label="Stop"
      title="Stop (Esc)"
      className="border-border text-text-secondary hover:border-danger hover:text-danger flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors"
    >
      <span className="h-2.5 w-2.5 rounded-[3px] bg-current" />
    </button>
  )
}
