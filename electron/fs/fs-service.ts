import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { DirEntry, FileContent } from '@shared/models'

const ALWAYS_HIDDEN = new Set(['.git'])
const MAX_FILE_BYTES = 4 * 1024 * 1024

/**
 * List one directory level for the explorer tree (lazy loading).
 * Gitignore filtering uses `git check-ignore --stdin` when available.
 */
export async function listDir(
  workspacePath: string,
  dirPath: string,
  options: { showHidden?: boolean; respectGitignore?: boolean },
): Promise<DirEntry[]> {
  const entries = await readdir(dirPath, { withFileTypes: true })
  let visible = entries.filter((entry) => {
    if (ALWAYS_HIDDEN.has(entry.name)) return false
    if (!options.showHidden && entry.name.startsWith('.')) return false
    return entry.isDirectory() || entry.isFile()
  })

  if (options.respectGitignore !== false && visible.length > 0) {
    const ignored = await checkIgnored(
      workspacePath,
      visible.map((e) => join(dirPath, e.name)),
    )
    if (ignored) visible = visible.filter((e) => !ignored.has(join(dirPath, e.name)))
  }

  const result: DirEntry[] = visible.map((entry) => ({
    name: entry.name,
    path: join(dirPath, entry.name),
    relativePath: relative(workspacePath, join(dirPath, entry.name)).split(sep).join('/'),
    isDirectory: entry.isDirectory(),
  }))

  result.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return result
}

/** Returns the subset of paths that are gitignored, or null when not a repo. */
function checkIgnored(workspacePath: string, paths: string[]): Promise<Set<string> | null> {
  return new Promise((resolve) => {
    const child = spawn('git', ['check-ignore', '--stdin'], { cwd: workspacePath })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
    child.on('error', () => resolve(null))
    child.on('close', (code) => {
      // 0 = some ignored, 1 = none ignored; anything else = not a repo/error.
      if (code === 0 || code === 1) resolve(new Set(out.split('\n').filter(Boolean)))
      else resolve(null)
    })
    child.stdin.write(paths.join('\n'))
    child.stdin.end()
  })
}

export async function readTextFile(path: string): Promise<FileContent> {
  const info = await stat(path)
  if (info.size > MAX_FILE_BYTES) {
    return { path, content: '', tooLarge: true, size: info.size, mtimeMs: info.mtimeMs }
  }
  const buffer = await readFile(path)
  // Cheap binary sniff: NUL byte in the first 8k.
  const probe = buffer.subarray(0, 8192)
  if (probe.includes(0)) {
    return { path, content: '', binary: true, size: info.size, mtimeMs: info.mtimeMs }
  }
  return { path, content: buffer.toString('utf8'), size: info.size, mtimeMs: info.mtimeMs }
}

export async function writeTextFile(path: string, content: string): Promise<{ mtimeMs: number }> {
  await writeFile(path, content, 'utf8')
  const info = await stat(path)
  return { mtimeMs: info.mtimeMs }
}

export async function createFile(path: string): Promise<void> {
  await writeFile(path, '', { flag: 'wx' })
}

export async function createDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

export async function renamePath(from: string, to: string): Promise<void> {
  await rename(from, to)
}
