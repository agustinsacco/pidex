import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

/**
 * Careful, format-compliant appends to session JSONL files.
 * ONLY safe while no pi process owns the file — callers must dispose any
 * live subprocess for the session first.
 */

function newEntryId(): string {
  return randomBytes(4).toString('hex')
}

async function currentLeafId(path: string): Promise<string | null> {
  const raw = await readFile(path, 'utf8')
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]!) as { id?: string; type?: string }
      if (entry.type !== 'session' && entry.id) return entry.id
    } catch {
      continue
    }
  }
  return null
}

/** Append a label entry (bookmark) targeting `targetId`. */
export async function appendLabel(
  path: string,
  targetId: string,
  label: string | undefined,
): Promise<void> {
  const leafId = await currentLeafId(path)
  const entry = {
    type: 'label',
    id: newEntryId(),
    parentId: leafId,
    timestamp: new Date().toISOString(),
    targetId,
    label,
  }
  await appendFile(path, JSON.stringify(entry) + '\n', 'utf8')
}

/**
 * Move the session leaf to `targetId` by appending a branch_summary entry
 * whose parent is the target — the documented mechanism behind /tree jumps.
 * On next resume, pi continues from this new leaf.
 */
export async function appendBranchJump(path: string, targetId: string): Promise<void> {
  const leafId = await currentLeafId(path)
  if (leafId === targetId) return
  const entry = {
    type: 'branch_summary',
    id: newEntryId(),
    parentId: targetId,
    timestamp: new Date().toISOString(),
    fromId: leafId,
    summary: 'Jumped here from another branch in pidex (tree view).',
  }
  await appendFile(path, JSON.stringify(entry) + '\n', 'utf8')
}

/**
 * Fork a session AT a specific entry: copy the file into a new session
 * (fresh header id, parentSession = source) and move its leaf to `targetId`.
 * Returns the new session file path.
 */
export async function forkSessionAt(path: string, targetId: string): Promise<string> {
  const raw = await readFile(path, 'utf8')
  const newlineIndex = raw.indexOf('\n')
  if (newlineIndex === -1) throw new Error('Malformed session file (no header line)')
  const header = JSON.parse(raw.slice(0, newlineIndex)) as Record<string, unknown>
  if (header.type !== 'session') throw new Error('Malformed session file (bad header)')

  const now = new Date()
  const newId = randomUUID()
  const newHeader = {
    ...header,
    id: newId,
    timestamp: now.toISOString(),
    parentSession: path,
  }
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const newPath = join(dirname(path), `${stamp}_${newId}.jsonl`)
  await writeFile(newPath, JSON.stringify(newHeader) + '\n' + raw.slice(newlineIndex + 1), 'utf8')
  await appendBranchJump(newPath, targetId)
  return newPath
}
