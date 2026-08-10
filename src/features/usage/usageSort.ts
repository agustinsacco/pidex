import type { SessionMeta, WorkspaceUsage } from '@shared/models'

export type UsageSortKey = 'cost' | 'tokens' | 'messages' | 'toolCalls' | 'lastActivity'
export type SortDirection = 'asc' | 'desc'

export interface UsageSort {
  key: UsageSortKey
  direction: SortDirection
}

export const DEFAULT_SORT: UsageSort = { key: 'cost', direction: 'desc' }

/** Toggle direction when re-clicking a column, else switch column (desc). */
export function nextSort(current: UsageSort, key: UsageSortKey): UsageSort {
  if (current.key === key) {
    return { key, direction: current.direction === 'desc' ? 'asc' : 'desc' }
  }
  return { key, direction: 'desc' }
}

function sessionValue(meta: SessionMeta, key: UsageSortKey): number {
  switch (key) {
    case 'cost':
      return meta.cost
    case 'tokens':
      return meta.totalTokens
    case 'messages':
      return meta.userMessages + meta.assistantMessages
    case 'toolCalls':
      return meta.toolCalls
    case 'lastActivity':
      return meta.mtimeMs
  }
}

export function sortSessions(sessions: SessionMeta[], sort: UsageSort): SessionMeta[] {
  const sign = sort.direction === 'desc' ? -1 : 1
  return [...sessions].sort(
    (a, b) => sign * (sessionValue(a, sort.key) - sessionValue(b, sort.key)),
  )
}

function workspaceValue(ws: WorkspaceUsage, key: UsageSortKey): number {
  switch (key) {
    case 'cost':
      return ws.totals.cost
    case 'tokens':
      return ws.totals.totalTokens
    case 'messages':
      return ws.totals.messages
    case 'toolCalls':
      return ws.totals.toolCalls
    case 'lastActivity':
      return Math.max(0, ...ws.sessions.map((s) => s.mtimeMs))
  }
}

export function sortWorkspaces(workspaces: WorkspaceUsage[], sort: UsageSort): WorkspaceUsage[] {
  const sign = sort.direction === 'desc' ? -1 : 1
  return [...workspaces].sort(
    (a, b) => sign * (workspaceValue(a, sort.key) - workspaceValue(b, sort.key)),
  )
}
