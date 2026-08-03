import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

const execFileAsync = promisify(execFile)

const MAX_FILES = 20_000
const DEFAULT_IGNORES = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'build',
  'target',
  '.next',
  '.venv',
  'venv',
  '__pycache__',
  '.cache',
])

/**
 * List workspace files for @-mentions and the fuzzy finder.
 * Prefers `git ls-files` (gitignore-aware, fast); falls back to a bounded
 * recursive walk with standard ignores.
 */
export async function listWorkspaceFiles(workspacePath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd: workspacePath, maxBuffer: 32 * 1024 * 1024 },
    )
    const files = stdout.split('\n').filter(Boolean)
    if (files.length > 0) return files.slice(0, MAX_FILES)
  } catch {
    // not a git repo — fall through
  }
  const results: string[] = []
  await walk(workspacePath, workspacePath, results)
  return results
}

async function walk(root: string, dir: string, results: string[]): Promise<void> {
  if (results.length >= MAX_FILES) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (results.length >= MAX_FILES) return
    if (entry.name.startsWith('.') && entry.isDirectory()) continue
    if (DEFAULT_IGNORES.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(root, full, results)
    } else if (entry.isFile()) {
      results.push(relative(root, full))
    }
  }
}
