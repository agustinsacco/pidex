import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Where an orchestrator's rules and memory live.
 *
 * Both sit in `<mainRepo>/.pidex/`, which `electron/fs/git-worktrees.ts`
 * already adds to `.git/info/exclude` — so they are **personal, not
 * team-shared**, and adding them never dirties the user's working tree. A team
 * that wants shared rules commits a file elsewhere and points at it.
 */

export function rulesPath(workspacePath: string): string {
  return join(workspacePath, '.pidex', 'orchestrator.md')
}

export function memoryPath(workspacePath: string): string {
  return join(workspacePath, '.pidex', 'orchestrator-memory.md')
}

/** Read a file, treating "absent" as empty rather than as an error. */
async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

async function writeEnsuringDir(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')
}

export async function readRules(
  workspacePath: string,
): Promise<{ content: string; exists: boolean }> {
  const content = await readOrEmpty(rulesPath(workspacePath))
  return { content, exists: content.length > 0 }
}

export function writeRules(workspacePath: string, content: string): Promise<void> {
  return writeEnsuringDir(rulesPath(workspacePath), content)
}

export function readMemory(workspacePath: string): Promise<string> {
  return readOrEmpty(memoryPath(workspacePath))
}

/**
 * Replace the memory file wholesale.
 *
 * Whole-file rather than append: the orchestrator owns these notes and is told
 * to keep them current, and an append-only log would grow without bound and
 * re-enter its context on every read.
 */
export function writeMemory(workspacePath: string, content: string): Promise<void> {
  return writeEnsuringDir(memoryPath(workspacePath), content)
}

/** Starter rules, written on first use so the file is discoverable. */
export const DEFAULT_RULES = `# Orchestrator rules

Standing instructions for this project's orchestration agent. Plain language;
these are appended to its system prompt.

- Tell me when a session has been idle for more than 30 minutes with
  uncommitted changes.
- Tell me when two sessions are touching the same files.
- Don't steer a session that is mid-refactor.
- When a session's branch has merged, say so and suggest archiving the chat.
`
