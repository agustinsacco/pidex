import type { AssistantItem, ChatItem } from '../reducer'

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

/** One vertical step, matching `--px-stream-gap`. */
export const STREAM_GAP = 'pt-3'
/** Continuation of the same action (tool round after tool round). */
export const STREAM_GAP_TIGHT = 'pt-1'

/**
 * True when an assistant item never produced any closed, non-blank text — i.e.
 * it was purely tool calls (optionally with thinking), no reply prose. pi emits
 * a fresh `message_start`/`message_end` for each such round, so a multi-step
 * tool run arrives as several consecutive `AssistantItem`s rather than one.
 */
export function isToolOnlyTurn(item: AssistantItem): boolean {
  return !item.blocks.some((b) => b.type === 'text' && b.closed && b.text.trim() !== '')
}

export function spacingFor(item: ChatItem, previous: ChatItem | undefined): string {
  if (!previous) return ''
  const continuesSameAction =
    previous.kind === 'assistant' &&
    item.kind === 'assistant' &&
    isToolOnlyTurn(previous) &&
    isToolOnlyTurn(item)
  return continuesSameAction ? STREAM_GAP_TIGHT : STREAM_GAP
}
