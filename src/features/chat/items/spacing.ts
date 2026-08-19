import type { TranscriptRow } from './transcriptRows'

/**
 * Leading space for a transcript row — the single owner of vertical rhythm.
 *
 * The reference (Claude Desktop) uses *one* step for the whole stream and
 * encodes grouping with colour and weight: gray tool lines, full-contrast
 * prose. pidex previously did the opposite — a boundary-aware 8/16px gap here
 * *plus* per-block margins inside each item (tool group `my-2`, thinking
 * `my-1.5`, divider `my-1`, markdown paragraphs) — so 4–6 independent sources
 * of space stacked and the effective gap varied by block type even when this
 * function returned the same class.
 *
 * Measured in the e2e harness: a collapsed tool row's wrapper was 63px tall for
 * ~20px of text (16px `pt-4` + 2px `pb-0.5` + 16px `my-2` + 8px row padding).
 * With one owner it is ~36px, and the transcript reads as grouped blocks
 * instead of an evenly-spaced list.
 *
 * One step at EVERY non-first boundary — the sole exception is the first row,
 * which needs no leading gap. Uniform steps keep each row symmetric: the gap
 * above a message or tool group always equals the gap below it. Grouping is
 * carried by ink, not air: the activity card's border and surface, the user
 * bubble, and weight/colour contrast. A previous two-step scheme (4px inside
 * a turn, 12px after the final activity card) left tool groups 4px from the
 * text above and 12px from the text below; `buildTranscriptRows` merging tool
 * rounds into one row made the in-turn step redundant anyway.
 */

/** The one vertical step (pt-3 = 12px). The literal IS the single source. */
export const STREAM_GAP = 'pt-3'

/**
 * Leading class for a row. One step at every boundary after the first —
 * identical above and below every message and tool group.
 */
export function spacingFor(row: TranscriptRow, previous: TranscriptRow | undefined): string {
  if (!previous) return ''
  return STREAM_GAP
}
