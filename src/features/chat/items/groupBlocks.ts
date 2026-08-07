import type { AssistantBlock } from '../reducer'

/**
 * Group runs of consecutive tool blocks into arrays so they render as one
 * bordered run; non-tool blocks stay standalone. Order is always preserved.
 */
export function groupBlocks(blocks: AssistantBlock[]): Array<AssistantBlock | AssistantBlock[]> {
  const groups: Array<AssistantBlock | AssistantBlock[]> = []
  for (const block of blocks) {
    if (block.type === 'tool') {
      const last = groups[groups.length - 1]
      if (Array.isArray(last)) {
        last.push(block)
        continue
      }
      groups.push([block])
    } else {
      groups.push(block)
    }
  }
  return groups
}
