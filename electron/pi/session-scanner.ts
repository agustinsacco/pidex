import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { SessionMeta, WorkspaceSessionStats } from '@shared/models'
import { isOrchestratorSession } from '@shared/orchestratorIdentity'
import { compareSessionsByCreation } from '@shared/session-order'
import { sessionDirForCwd } from './pi-paths'
import { extractText } from './session-content'

export { piAgentDir, piSessionsRoot, sessionDirForCwd, sessionDirNameForCwd } from './pi-paths'

/**
 * On-disk session discovery — drives the sidebar and home stats without
 * spawning pi processes. The directory layout itself lives in `pi-paths.ts`.
 *
 * NOTE: plain readline is fine HERE (unlike the RPC stream) because we parse
 * whole persisted files line-by-line and pi writes each entry as one LF-
 * terminated line; a U+2028 inside a JSON string would only split a line with
 * readline if it appeared raw — pi JSON-escapes nothing extra, so to stay
 * safe we still parse defensively and skip unparseable lines.
 */

interface CacheEntry {
  mtimeMs: number
  size: number
  meta: SessionMeta
}

const metaCache = new Map<string, CacheEntry>()

export async function listSessions(workspacePath: string): Promise<SessionMeta[]> {
  return listSessionsInDir(sessionDirForCwd(workspacePath))
}

async function listSessionsInDir(dir: string): Promise<SessionMeta[]> {
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return []
  }

  const metas = await Promise.all(
    files.map(async (file) => {
      const path = join(dir, file)
      try {
        const info = await stat(path)
        const cached = metaCache.get(path)
        if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
          return cached.meta
        }
        const meta = await parseSessionFile(path, info.mtimeMs)
        if (meta) metaCache.set(path, { mtimeMs: info.mtimeMs, size: info.size, meta })
        return meta
      } catch {
        return null
      }
    }),
  )

  return metas.filter((m): m is SessionMeta => m !== null).sort(compareSessionsByCreation)
}

/** Single-pass parse: header, latest name, first user message, counts, tokens. */
export async function parseSessionFile(path: string, mtimeMs: number): Promise<SessionMeta | null> {
  const stream = createReadStream(path, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  interface HeaderFields {
    id?: string
    cwd?: string
    timestamp?: string
    parentSession?: string
  }
  let header: HeaderFields | null = null
  let name: string | undefined
  let firstUserText: string | undefined
  let userMessages = 0
  let assistantMessages = 0
  let toolCalls = 0
  let totalTokens = 0
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let cost = 0
  let entryCount = 0
  let lastTimestamp: string | undefined
  let branchCount = 0
  const seenParents = new Set<string>()

  try {
    for await (const line of rl) {
      if (!line.trim()) continue
      let entry: Record<string, unknown>
      try {
        entry = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }

      const type = entry.type as string
      if (type === 'session') {
        header = entry as unknown as {
          id?: string
          cwd?: string
          timestamp?: string
          parentSession?: string
        }
        continue
      }
      entryCount++
      if (typeof entry.timestamp === 'string') lastTimestamp = entry.timestamp
      const parentId = entry.parentId as string | null
      if (parentId) {
        if (seenParents.has(parentId)) branchCount++
        seenParents.add(parentId)
      }

      if (type === 'session_info') {
        name = (entry.name as string | undefined) || undefined
      } else if (type === 'message') {
        const message = entry.message as
          | {
              role?: string
              content?: unknown
              usage?: {
                totalTokens?: number
                input?: number
                output?: number
                cacheRead?: number
                cacheWrite?: number
                cost?: { total?: number }
              }
            }
          | undefined
        if (!message) continue
        if (message.role === 'user') {
          userMessages++
          if (!firstUserText) firstUserText = extractText(message.content)
        } else if (message.role === 'assistant') {
          assistantMessages++
          const content = message.content
          if (Array.isArray(content)) {
            toolCalls += content.filter((b) => (b as { type?: string }).type === 'toolCall').length
          }
          const usage = message.usage
          if (usage) {
            totalTokens +=
              usage.totalTokens ??
              (usage.input ?? 0) +
                (usage.output ?? 0) +
                (usage.cacheRead ?? 0) +
                (usage.cacheWrite ?? 0)
            inputTokens += usage.input ?? 0
            outputTokens += usage.output ?? 0
            cacheReadTokens += usage.cacheRead ?? 0
            cacheWriteTokens += usage.cacheWrite ?? 0
            cost += usage.cost?.total ?? 0
          }
        }
      }
    }
  } finally {
    rl.close()
    stream.close()
  }

  if (!header?.id) return null
  return {
    path,
    sessionId: header.id,
    cwd: header.cwd ?? '',
    createdAt: header.timestamp ?? '',
    parentSession: header.parentSession,
    name,
    firstUserText: firstUserText?.slice(0, 200),
    userMessages,
    assistantMessages,
    toolCalls,
    totalTokens,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cost,
    entryCount,
    branchCount,
    mtimeMs,
    lastActivityAt: lastTimestamp ?? header.timestamp ?? '',
  }
}

/**
 * Aggregate stats for the workspace home screen (tiles + heatmap).
 *
 * Orchestrator threads are excluded: they live in the project's own cwd, so
 * without filtering they would count as work the user did — inflating the
 * session count, the message count and the activity heatmap with the
 * manager's own chatter. See shared/orchestratorIdentity.ts.
 */
export async function workspaceStats(
  workspacePath: string,
  orchestratorPaths: Iterable<string> = [],
): Promise<WorkspaceSessionStats> {
  const all = await listSessions(workspacePath)
  const sessions = all.filter((meta) => !isOrchestratorSession(meta, orchestratorPaths))
  const activityByDay = new Map<string, number>()
  let messages = 0
  let tokens = 0
  let totalCost = 0

  for (const session of sessions) {
    messages += session.userMessages + session.assistantMessages
    tokens += session.totalTokens
    totalCost += session.cost
    const day = session.lastActivityAt.slice(0, 10)
    if (day)
      activityByDay.set(
        day,
        (activityByDay.get(day) ?? 0) + session.userMessages + session.assistantMessages,
      )
    const created = session.createdAt.slice(0, 10)
    if (created && created !== day) {
      activityByDay.set(created, (activityByDay.get(created) ?? 0) + 1)
    }
  }

  return {
    sessionCount: sessions.length,
    messages,
    tokens,
    cost: totalCost,
    activeDays: activityByDay.size,
    activityByDay: Object.fromEntries(activityByDay),
  }
}

export { readSessionTree } from './session-tree'
