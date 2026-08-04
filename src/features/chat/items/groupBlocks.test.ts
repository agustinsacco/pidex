import { describe, it, expect } from 'vitest'
import { groupBlocks } from './groupBlocks'
import type { AssistantBlock } from '../reducer'

let nextIndex = 0
const text = (t: string): AssistantBlock => ({
  type: 'text',
  index: nextIndex++,
  text: t,
  closed: true,
})
const tool = (id: string): AssistantBlock => ({ type: 'tool', index: nextIndex++, toolCallId: id })
const thinking = (t: string): AssistantBlock => ({
  type: 'thinking',
  index: nextIndex++,
  text: t,
  closed: true,
})

describe('groupBlocks', () => {
  it('returns an empty list for no blocks', () => {
    expect(groupBlocks([])).toEqual([])
  })

  it('leaves standalone non-tool blocks ungrouped', () => {
    const a = text('a')
    const b = text('b')
    expect(groupBlocks([a, b])).toEqual([a, b])
  })

  it('wraps a lone tool block in an array', () => {
    const t1 = tool('1')
    expect(groupBlocks([t1])).toEqual([[t1]])
  })

  it('merges consecutive tool blocks into one group', () => {
    const [t1, t2, t3] = [tool('1'), tool('2'), tool('3')]
    expect(groupBlocks([t1!, t2!, t3!])).toEqual([[t1, t2, t3]])
  })

  it('starts a new group when a non-tool block interrupts the run', () => {
    const t1 = tool('1')
    const a = text('a')
    const t2 = tool('2')
    expect(groupBlocks([t1, a, t2])).toEqual([[t1], a, [t2]])
  })

  it('preserves overall ordering with mixed runs', () => {
    const a = text('a')
    const t1 = tool('1')
    const t2 = tool('2')
    const b = text('b')
    const t3 = tool('3')
    expect(groupBlocks([a, t1, t2, b, t3])).toEqual([a, [t1, t2], b, [t3]])
  })

  it('groups thinking blocks as non-tool standalone entries', () => {
    const th = thinking('hmm')
    const t1 = tool('1')
    expect(groupBlocks([th, t1])).toEqual([th, [t1]])
  })

  it('does not mutate the input array', () => {
    const blocks = [tool('1'), tool('2')]
    const snapshot = JSON.parse(JSON.stringify(blocks))
    groupBlocks(blocks)
    expect(blocks).toEqual(snapshot)
  })
})
