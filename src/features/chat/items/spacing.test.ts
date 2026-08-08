import { describe, expect, it } from 'vitest'
import { isToolOnlyTurn, spacingFor, STREAM_GAP, STREAM_GAP_TIGHT } from './spacing'
import type { AssistantItem, ChatItem, UserItem } from '../reducer'

const user = (id = 'u1'): UserItem => ({ id, kind: 'user', text: 'hi' })

const assistantText = (id = 'a1'): AssistantItem => ({
  id,
  kind: 'assistant',
  streaming: false,
  blocks: [{ type: 'text', index: 0, text: 'answer', closed: true }],
})

const assistantToolOnly = (id = 'a2'): AssistantItem => ({
  id,
  kind: 'assistant',
  streaming: false,
  blocks: [{ type: 'tool', index: 0, toolCallId: 't1' }],
})

const divider = (id = 'd1'): ChatItem => ({ id, kind: 'divider', variant: 'compaction' })

const bash = (id = 'b1'): ChatItem => ({
  id,
  kind: 'bash',
  command: 'ls',
  output: '',
  exitCode: 0,
  running: false,
  truncated: false,
})

describe('spacingFor', () => {
  it('gives the first row no leading gap', () => {
    expect(spacingFor(user(), undefined)).toBe('')
  })

  it('uses ONE step for every ordinary boundary', () => {
    // The invariant that replaced the old boundary-aware 8/16px scheme: one
    // owner, one step. Anything that wants to look grouped does it with ink.
    const boundaries: [ChatItem, ChatItem][] = [
      [assistantText(), user()],
      [user(), assistantText()],
      [assistantText('a3'), assistantText('a4')],
      [assistantToolOnly(), assistantText()],
      [assistantText(), assistantToolOnly()],
      [assistantText(), divider()],
      [divider(), assistantText()],
      [assistantText(), bash()],
      [bash(), assistantText()],
    ]
    for (const [previous, item] of boundaries) {
      expect(spacingFor(item, previous)).toBe(STREAM_GAP)
    }
  })

  it('tightens only between consecutive tool-only turns', () => {
    // One multi-step action, which pi splits into several assistant messages.
    expect(spacingFor(assistantToolOnly('x'), assistantToolOnly('y'))).toBe(STREAM_GAP_TIGHT)
  })

  it('never emits trailing padding (it doubled every gap)', () => {
    const classes = [
      spacingFor(user(), undefined),
      spacingFor(assistantText(), user()),
      spacingFor(assistantToolOnly('x'), assistantToolOnly('y')),
    ]
    for (const value of classes) expect(value).not.toMatch(/\bpb-/)
  })
})

describe('isToolOnlyTurn', () => {
  it('is true for tool calls with no prose', () => {
    expect(isToolOnlyTurn(assistantToolOnly())).toBe(true)
  })

  it('is true when only thinking accompanies the tools', () => {
    expect(
      isToolOnlyTurn({
        id: 'a',
        kind: 'assistant',
        streaming: false,
        blocks: [
          { type: 'thinking', index: 0, text: 'hmm', closed: true },
          { type: 'tool', index: 1, toolCallId: 't' },
        ],
      }),
    ).toBe(true)
  })

  it('is false once closed, non-blank text exists', () => {
    expect(isToolOnlyTurn(assistantText())).toBe(false)
  })

  it('ignores blank or still-streaming text', () => {
    expect(
      isToolOnlyTurn({
        id: 'a',
        kind: 'assistant',
        streaming: true,
        blocks: [
          { type: 'text', index: 0, text: '   ', closed: true },
          { type: 'text', index: 1, text: 'partial', closed: false },
        ],
      }),
    ).toBe(true)
  })
})
