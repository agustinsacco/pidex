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

/**
 * Disclosure chevron pointing down, for menu triggers that drop rather than
 * expand. Deliberately not `ChevronIcon` rotated: that one animates its
 * rotation, which would make a static trigger glyph spin on every re-render.
 */
export function ChevronDownIcon({
  size = 12,
  strokeWidth = 2.5,
  className,
}: IconProps & { strokeWidth?: number }): React.JSX.Element {
  return (
    <svg {...strokeProps(size)} strokeWidth={strokeWidth} className={className}>
      <path d="m6 9 6 6 6-6" />
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

/** Plus, for "new" and "attach" affordances. */
export function PlusIcon({
  size = 12,
  strokeWidth = 2,
  className,
}: IconProps & { strokeWidth?: number }): React.JSX.Element {
  return (
    <svg
      {...strokeProps(size)}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      className={className}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

/** Artifact: a framed pane on a stand — the sidebar nav, top bar and code block all use it. */
export function ArtifactsIcon({ size = 14, className }: IconProps): React.JSX.Element {
  return (
    <svg {...strokeProps(size)} className={className}>
      <rect x="3" y="3" width="18" height="14" rx="2" />
      <path d="M3 9h18M9 21h6" />
    </svg>
  )
}

/** Document with a folded corner. */
export function FileIcon({ size = 14, className }: IconProps): React.JSX.Element {
  return (
    <svg {...strokeProps(size)} className={className}>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

/** Panel with a left rail — the show/hide sidebar switch. */
export function SidebarToggleIcon({ size = 14, className }: IconProps): React.JSX.Element {
  return (
    <svg {...strokeProps(size)} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  )
}

/** Shell prompt caret and line. */
export function TerminalIcon({ size = 14, className }: IconProps): React.JSX.Element {
  return (
    <svg {...strokeProps(size)} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m5 8 4 4-4 4M13 16h6" />
    </svg>
  )
}

/** Circled plus/minus — the working tree's changes. */
export function ChangesIcon({ size = 14, className }: IconProps): React.JSX.Element {
  return (
    <svg {...strokeProps(size)} className={className}>
      <path d="M12 3v6m0 6v6M5 12h14" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  )
}

/** Bar chart, for the usage rollup. */
export function UsageIcon({ size = 14, className }: IconProps): React.JSX.Element {
  return (
    <svg {...strokeProps(size)} strokeLinecap="round" className={className}>
      <path d="M3 20h18M7 20V10M12 20V4M17 20v-8" />
    </svg>
  )
}

/** Heartbeat trace, for the resource monitor. */
export function ResourcesIcon({ size = 14, className }: IconProps): React.JSX.Element {
  return (
    <svg {...strokeProps(size)} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 12h4l2 6 4-14 2 8h6" />
    </svg>
  )
}

/** Settings cog. */
export function GearIcon({ size = 14, className }: IconProps): React.JSX.Element {
  return (
    <svg {...strokeProps(size)} className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

/** Pinned marker — solid, so a pinned row reads at a glance. */
export function PinIcon({ size = 11, className }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M16 3a1 1 0 0 1 .97 1.24l-1.09 4.34 3.83 3.83a1 1 0 0 1-.7 1.71H13.5v6.38a1 1 0 0 1-2 0v-6.38H6a1 1 0 0 1-.71-1.71l3.83-3.83L8.03 4.24A1 1 0 0 1 9 3h7z" />
    </svg>
  )
}

/** Tray with a down arrow, for "save to disk". */
export function DownloadIcon({ size = 12, className }: IconProps): React.JSX.Element {
  return (
    <svg {...strokeProps(size)} className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
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
