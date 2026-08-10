import { describe, expect, it } from 'vitest'
import { DEFAULT_SORT, nextSort, sortSessions, sortWorkspaces } from './usageSort'
import type { SessionMeta, WorkspaceUsage } from '@shared/models'

const meta = (overrides: Partial<SessionMeta>): SessionMeta => ({
  path: '/s.jsonl',
  sessionId: 's',
  cwd: '/repo',
  createdAt: '',
  userMessages: 0,
  assistantMessages: 0,
  toolCalls: 0,
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cost: 0,
  entryCount: 0,
  branchCount: 0,
  mtimeMs: 0,
  lastActivityAt: '',
  ...overrides,
})

describe('usageSort', () => {
  it('defaults to cost descending', () => {
    const sorted = sortSessions(
      [meta({ sessionId: 'a', cost: 1 }), meta({ sessionId: 'b', cost: 5 })],
      DEFAULT_SORT,
    )
    expect(sorted.map((s) => s.sessionId)).toEqual(['b', 'a'])
  })

  it('nextSort toggles direction on the same key and resets on a new key', () => {
    expect(nextSort(DEFAULT_SORT, 'cost')).toEqual({ key: 'cost', direction: 'asc' })
    expect(nextSort({ key: 'cost', direction: 'asc' }, 'messages')).toEqual({
      key: 'messages',
      direction: 'desc',
    })
  })

  it('sorts by messages (user + assistant)', () => {
    const sorted = sortSessions(
      [
        meta({ sessionId: 'a', userMessages: 1, assistantMessages: 1 }),
        meta({ sessionId: 'b', userMessages: 5, assistantMessages: 5 }),
      ],
      { key: 'messages', direction: 'desc' },
    )
    expect(sorted[0]?.sessionId).toBe('b')
  })

  it('sorts workspace groups by their totals and does not mutate input', () => {
    const ws = (path: string, cost: number): WorkspaceUsage => ({
      workspacePath: path,
      sessions: [],
      totals: {
        cost,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        messages: 0,
        toolCalls: 0,
        sessionCount: 0,
      },
    })
    const input = [ws('/a', 1), ws('/b', 9)]
    const sorted = sortWorkspaces(input, DEFAULT_SORT)
    expect(sorted.map((w) => w.workspacePath)).toEqual(['/b', '/a'])
    expect(input.map((w) => w.workspacePath)).toEqual(['/a', '/b'])
  })
})
