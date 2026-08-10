import { describe, expect, it } from 'vitest'
import { spacingFor, STREAM_GAP, STREAM_GAP_TIGHT } from './spacing'
import { buildTranscriptRows, type TranscriptRow } from './transcriptRows'
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
  blocks: [{ type: 'tool', index: 0, toolCallId: `t-${id}` }],
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

/** The row a single item produces, for pairwise boundary assertions. */
const rowOf = (item: ChatItem): TranscriptRow => {
  const rows = buildTranscriptRows([item])
  if (!rows[0]) throw new Error('item produced no row')
  return rows[0]
}

describe('spacingFor', () => {
  it('gives the first row no leading gap', () => {
    expect(spacingFor(rowOf(user()), undefined)).toBe('')
  })

  it('uses ONE step at every speaker or divider boundary', () => {
    // The invariant that replaced the old boundary-aware 8/16px scheme: one
    // owner, one step. Anything that wants to look grouped does it with ink.
    const boundaries: [ChatItem, ChatItem][] = [
      [assistantText(), user()],
      [user(), assistantText()],
      [assistantText(), divider()],
      [divider(), assistantText()],
      [user(), bash()],
      [divider('d2'), user()],
    ]
    for (const [previous, item] of boundaries) {
      expect(spacingFor(rowOf(item), rowOf(previous))).toBe(STREAM_GAP)
    }
  })

  it('tightens between rows of one assistant turn', () => {
    // Prose → activity → prose is one turn's own output, so it closes up.
    const rows = buildTranscriptRows([
      assistantText('a1'),
      assistantToolOnly('a2'),
      assistantText('a3'),
    ])
    expect(rows.map((r) => r.kind)).toEqual(['text', 'activity', 'text'])
    expect(spacingFor(rows[1]!, rows[0])).toBe(STREAM_GAP_TIGHT)
    expect(spacingFor(rows[2]!, rows[1])).toBe(STREAM_GAP_TIGHT)
  })

  it('needs no tool-only special case: consecutive tool turns are ONE row', () => {
    // What `isToolOnlyTurn` used to paper over is now structural — pi's
    // one-message-per-tool-call runs merge before spacing is consulted.
    const rows = buildTranscriptRows([
      assistantToolOnly('a1'),
      assistantToolOnly('a2'),
      assistantToolOnly('a3'),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('activity')
  })

  it('never emits trailing padding (it doubled every gap)', () => {
    const rows = buildTranscriptRows([user(), assistantText(), assistantToolOnly()])
    const classes = [
      spacingFor(rows[0]!, undefined),
      spacingFor(rows[1]!, rows[0]),
      spacingFor(rows[2]!, rows[1]),
    ]
    for (const value of classes) expect(value).not.toMatch(/\bpb-/)
  })
})
