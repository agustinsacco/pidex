import clsx from 'clsx'
import { ModalOverlay } from '@/components/Modal'
import { MARKER_CATEGORIES, autoMarker } from '@/lib/laneMarker'

/**
 * Pick a lane's marker.
 *
 * Three outcomes, not two: a glyph, "Auto" (forget the choice and go back to
 * the branch-derived marker), and "None" (an explicit empty marker). Auto and
 * None look the same on a row that happens to be unmarked but mean different
 * things, and conflating them means you can never get back to Auto once you
 * have chosen anything.
 *
 * Glyphs already in use by another lane in the same group are dimmed rather
 * than disabled. Uniqueness is a nudge: enforcing it breaks the moment a
 * project has more lanes than the palette has glyphs.
 */
export function MarkerPickerModal({
  title,
  current,
  autoKey,
  usedMarkers,
  onPick,
  onClose,
}: {
  title: string
  /** Explicit choice, or undefined when the lane is on Auto. */
  current: string | undefined
  /** Branch (or cwd) the Auto marker derives from. */
  autoKey: string | null | undefined
  usedMarkers: ReadonlySet<string>
  onPick: (marker: string | null) => void
  onClose: () => void
}): React.JSX.Element {
  const auto = autoMarker(autoKey)

  return (
    <ModalOverlay onClose={onClose}>
      <div className="bg-surface-raised border-border w-[min(28rem,92vw)] rounded-lg border shadow-2xl">
        <div className="border-border border-b px-4 py-3">
          <h2 className="text-base font-semibold">Lane marker</h2>
          <p className="text-text-secondary mt-0.5 truncate text-sm">{title}</p>
        </div>

        <div className="border-border flex items-center gap-2 border-b px-4 py-2">
          <button
            onClick={() => onPick(null)}
            className={clsx(
              'flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm',
              current === undefined
                ? 'border-accent/40 bg-accent-soft text-accent'
                : 'border-border text-text-secondary hover:text-text',
            )}
            title="Derive the marker from the branch name"
          >
            <span>{auto}</span> Auto
          </button>
          <button
            onClick={() => onPick('')}
            className={clsx(
              'rounded-md border px-2 py-1 text-sm',
              current === ''
                ? 'border-accent/40 bg-accent-soft text-accent'
                : 'border-border text-text-secondary hover:text-text',
            )}
            title="No marker for this lane"
          >
            None
          </button>
          <span className="text-text-tertiary ml-auto text-xs">dimmed = used by another lane</span>
        </div>

        <div className="max-h-72 overflow-y-auto px-4 py-3">
          {MARKER_CATEGORIES.map((category) => (
            <div key={category.name} className="mb-3 last:mb-0">
              <div className="text-text-tertiary mb-1.5 text-2xs font-semibold tracking-wider uppercase">
                {category.name}
              </div>
              <div className="grid grid-cols-10 gap-1">
                {category.markers.map((glyph) => (
                  <button
                    key={glyph}
                    onClick={() => onPick(glyph)}
                    title={usedMarkers.has(glyph) ? 'Already used by another lane' : glyph}
                    className={clsx(
                      'grid h-8 place-items-center rounded-md text-lg',
                      current === glyph
                        ? 'bg-accent-soft ring-accent ring-1 ring-inset'
                        : 'hover:bg-sidebar-hover',
                      usedMarkers.has(glyph) && current !== glyph && 'opacity-35',
                    )}
                  >
                    {glyph}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </ModalOverlay>
  )
}
