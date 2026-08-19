import clsx from 'clsx'

/**
 * Shared inline SVG glyphs.
 *
 * Every icon takes a `size` in px (width and height together, since all glyphs
 * are square on a 24x24 viewBox) and an optional `className` for color and
 * layout. Stroke-based glyphs inherit `currentColor`, so callers set color on
 * the icon or on an ancestor.
 */

interface IconProps {
  /** Width and height in px. */
  size?: number
  className?: string
}

/** Shared attributes for stroked, non-filled glyphs. */
function strokeProps(size: number): {
  width: number
  height: number
  viewBox: string
  fill: 'none'
  stroke: 'currentColor'
  strokeWidth: number
} {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
  }
}

/** Git branch: three nodes and a merge curve. */
export function BranchIcon({ size = 12, className }: IconProps): React.JSX.Element {
  return (
    <svg {...strokeProps(size)} className={className}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <path d="M6 8.5v7M18 8.5a9 9 0 0 1-9 9" />
    </svg>
  )
}

/**
 * Close / dismiss ✕. `strokeWidth` is overridable because the small pane
 * buttons use a heavier weight than the modal headers to stay legible.
 */
export function CloseIcon({
  size = 14,
  strokeWidth = 2,
  className,
}: IconProps & { strokeWidth?: number }): React.JSX.Element {
  return (
    <svg {...strokeProps(size)} strokeWidth={strokeWidth} className={className}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

/**
 * Disclosure chevron; rotates 90° when `expanded`. `strokeWidth` is
 * overridable because the smallest chevrons need a heavier weight to stay
 * legible at 8px.
 */
export function ChevronIcon({
  expanded = false,
  size = 12,
  strokeWidth = 2.5,
  className,
}: IconProps & { expanded?: boolean; strokeWidth?: number }): React.JSX.Element {
  return (
    <svg
      {...strokeProps(size)}
      strokeWidth={strokeWidth}
      className={clsx(
        'shrink-0 transition-transform duration-150',
        expanded && 'rotate-90',
        className,
      )}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

/** Checkmark, for selected rows and copy confirmation. */
export function CheckIcon({ size = 13, className }: IconProps): React.JSX.Element {
  return (
    <svg {...strokeProps(size)} strokeWidth={2.5} className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

/** Counter-clockwise rewind arrow, for "rewind to here" on a message row. */
export function RewindIcon({ size = 13, className }: IconProps): React.JSX.Element {
  return (
    <svg {...strokeProps(size)} className={className}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  )
}

/**
 * Indeterminate activity spinner. Colour comes from `className` so callers can
 * tint it (accent for tools, warning for retries) or inherit from an ancestor.
 */
export function Spinner({ className = 'text-accent' }: { className?: string }): React.JSX.Element {
  return (
    <svg
      className={clsx('h-3.5 w-3.5 shrink-0 animate-spin', className)}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2z"
      />
    </svg>
  )
}
