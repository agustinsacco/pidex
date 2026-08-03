import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { GitInfo } from '@shared/models'

const execFileAsync = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: 10_000 })
  return stdout.trim()
}

export async function gitInfo(workspacePath: string): Promise<GitInfo> {
  try {
    const branch = await git(workspacePath, ['rev-parse', '--abbrev-ref', 'HEAD'])
    const info: GitInfo = { isRepo: true, branch }

    try {
      const status = await git(workspacePath, ['status', '--porcelain'])
      info.dirtyCount = status ? status.split('\n').filter(Boolean).length : 0
    } catch {
      // ignore
    }

    try {
      const counts = await git(workspacePath, [
        'rev-list',
        '--left-right',
        '--count',
        '@{upstream}...HEAD',
      ])
      const [behind, ahead] = counts.split(/\s+/).map((n) => parseInt(n, 10))
      info.behind = behind ?? 0
      info.ahead = ahead ?? 0
    } catch {
      // no upstream — fine
    }

    return info
  } catch {
    return { isRepo: false }
  }
}
