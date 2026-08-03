import { createReadStream, realpathSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { SessionMeta, WorkspaceSessionStats } from '@shared/models'
import type { SessionTree, SessionTreeEntry } from '@shared/ipc'

/**
 * On-disk session discovery — drives the sidebar and home stats without
 * spawning pi processes.
 *
 * Layout (verified against the local install):
 *   ~/.pi/agent/sessions/--<cwd segments joined by dashes>--/<ts>_<uuid>.jsonl
 *
 * NOTE: plain readline is fine HERE (unlike the RPC stream) because we parse
 * whole persisted files line-by-line and pi writes each entry as one LF-
 * terminated line; a U+2028 inside a JSON string would only split a line with
 * readline if it appeared raw — pi JSON-escapes nothing extra, so to stay
 * safe we still parse defensively and skip unparseable lines.
 */

export function piAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent')
}

export function piSessionsRoot(): string {
  return process.env.PI_CODING_AGENT_SESSION_DIR ?? join(piAgentDir(), 'sessions')
}

/** `/Users/x/proj` → `--Users-x-proj--` (verified against real dirs). */
export function sessionDirNameForCwd(cwd: string): string {
  const segments = cwd.split(/[/\\]/).filter(Boolean)
  return `--${segments.join('-')}--`
}

export function sessionDirForCwd(cwd: string): string {
  // pi mangles the REAL path (symlinks resolved — /var → /private/var etc.),
  // verified against the local install.
  let resolved = cwd
  try {
    resolved = realpathSync.native(cwd)
  } catch {
    // keep the given path
  }
  return join(piSessionsRoot(), sessionDirNameForCwd(resolved))
}

interface CacheEntry {
  mtimeMs: number
  size: number
  meta: SessionMeta
}

const metaCache = new Map<string, CacheEntry>()

export async function listSessions(workspacePath: string): Promise<SessionMeta[]> {
  const dir = sessionDirForCwd(workspacePath)
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

  return metas.filter((m): m is SessionMeta => m !== null).sort((a, b) => b.mtimeMs - a.mtimeMs)
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
    cost,
    entryCount,
    branchCount,
    mtimeMs,
    lastActivityAt: lastTimestamp ?? header.timestamp ?? '',
  }
}

function extractText(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = content
      .filter((b) => (b as { type?: string }).type === 'text')
      .map((b) => (b as { text?: string }).text ?? '')
      .join(' ')
      .trim()
    return text || undefined
  }
  return undefined
}

/** Aggregate stats for the workspace home screen (tiles + heatmap). */
export async function workspaceStats(workspacePath: string): Promise<WorkspaceSessionStats> {
  const sessions = await listSessions(workspacePath)
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

// ---------- tree reading (P2 tree view) ----------

export async function readSessionTree(path: string): Promise<SessionTree> {
  const raw = await readFile(path, 'utf8')
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  const entries: SessionTreeEntry[] = []
  let sessionId = ''
  let cwd = ''
  let leafId: string | null = null

  for (const line of lines) {
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    const type = entry.type as string
    if (type === 'session') {
      sessionId = (entry.id as string) ?? ''
      cwd = (entry.cwd as string) ?? ''
      continue
    }
    const id = entry.id as string
    if (!id) continue
    leafId = id

    const node: SessionTreeEntry = {
      id,
      parentId: (entry.parentId as string | null) ?? null,
      type,
      timestamp: (entry.timestamp as string) ?? '',
    }

    if (type === 'message') {
      const message = entry.message as { role?: string; content?: unknown } | undefined
      node.role = message?.role
      if (message?.role === 'user') {
        node.preview = extractText(message.content)?.slice(0, 160)
      } else if (message?.role === 'assistant') {
        const content = message?.content
        if (Array.isArray(content)) {
          const text = content
            .filter((b) => (b as { type?: string }).type === 'text')
            .map((b) => (b as { text?: string }).text ?? '')
            .join(' ')
            .trim()
          node.preview = text.slice(0, 160) || undefined
          const tools = content.filter((b) => (b as { type?: string }).type === 'toolCall')
          if (tools.length > 0) {
            node.toolName = tools
              .map((t) => (t as { name?: string }).name)
              .filter(Boolean)
              .join(', ')
          }
        }
      } else if (message?.role === 'toolResult') {
        node.toolName = (message as { toolName?: string }).toolName
      }
    } else if (type === 'label') {
      node.targetId = entry.targetId as string
      node.label = entry.label as string | undefined
    } else if (type === 'branch_summary' || type === 'compaction') {
      node.summary = (entry.summary as string | undefined)?.slice(0, 400)
    } else if (type === 'session_info') {
      node.name = entry.name as string | undefined
    }

    entries.push(node)
  }

  return { sessionId, cwd, entries, leafId }
}
