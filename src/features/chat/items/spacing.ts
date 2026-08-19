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
 * Exceptions are deliberately minimal:
 * - the first row needs no leading gap;
 * - consecutive tool-only assistant turns are one ongoing action (pi emits a
 *   fresh message per tool round), so they close up to a tight gap.
 */

/** One vertical step (pt-3 = 12px). The literal IS the single source. */
export const STREAM_GAP = 'pt-3'
/** Continuation of the same action (tool round after tool round). */
export const STREAM_GAP_TIGHT = 'pt-1'

/**
 * True when an assistant item has produced no visible prose — i.e. it is
 * purely tool calls (optionally with thinking). pi emits a fresh
 * `message_start`/`message_end` for each such round, so a multi-step tool run
 * arrives as several consecutive `AssistantItem`s rather than one.
 *
 * Streaming (not-yet-closed) text counts as prose the moment it is non-blank:
 * classifying on `closed` made the gap jump 8px at `text_end` — a reflow of
 * the very row the user is reading — for every tools-then-prose turn.
 */
/**
 * Rows that belong to one assistant turn's own output (prose, grouped
 * activity, outcome) as opposed to a speaker change or a system divider.
 *
 * This replaces the previous `isToolOnlyTurn` heuristic: consecutive
 * tool-only *messages* no longer need a spacing special-case, because
 * `buildTranscriptRows` merges them into a single activity row before this
 * function ever sees them.
 */
function isAssistantSide(row: TranscriptRow): boolean {
  if (row.kind !== 'item') return true
  return row.item.kind !== 'user' && row.item.kind !== 'divider'
}

function isDivider(row: TranscriptRow): boolean {
  return row.kind === 'item' && row.item.kind === 'divider'
}

export function spacingFor(row: TranscriptRow, previous: TranscriptRow | undefined): string {
  if (!previous) return ''
  if (isDivider(row) || isDivider(previous)) return STREAM_GAP
  // Final prose deserves a full beat after the activity card. Keeping this at
  // the tight in-turn gap made the streamed answer look attached to the card.
  if (row.kind === 'text' && previous.kind === 'activity') return STREAM_GAP
  const continuesSameTurn = isAssistantSide(row) && isAssistantSide(previous)
  return continuesSameTurn ? STREAM_GAP_TIGHT : STREAM_GAP
}
