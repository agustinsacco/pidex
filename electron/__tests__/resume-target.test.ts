import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { access } from 'node:fs/promises'

/**
 * Launch-location resolution.
 *
 * The rule under test: prefer the exact session, but only when BOTH it and
 * its workspace still exist. A session file whose folder was deleted must
 * degrade to the workspace, and a deleted workspace must degrade to the
 * picker — never route into a screen that cannot load.
 *
 * Mirrors the `app:resumeTarget` handler in electron/ipc.ts. Kept as a pure
 * function here because the handler itself is bound to ipcMain.
 */
type Prefs = { lastSessionPath?: string; lastWorkspacePath?: string }
type Target =
  | { kind: 'session'; sessionPath: string; workspacePath: string }
  | { kind: 'workspace'; workspacePath: string }
  | { kind: 'none' }

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function resolveResumeTarget(prefs: Prefs): Promise<Target> {
  const { lastSessionPath, lastWorkspacePath } = prefs
  if (lastSessionPath && lastWorkspacePath) {
    const [sessionOk, workspaceOk] = await Promise.all([
      pathExists(lastSessionPath),
      pathExists(lastWorkspacePath),
    ])
    if (sessionOk && workspaceOk) {
      return { kind: 'session', sessionPath: lastSessionPath, workspacePath: lastWorkspacePath }
    }
  }
  if (lastWorkspacePath && (await pathExists(lastWorkspacePath))) {
    return { kind: 'workspace', workspacePath: lastWorkspacePath }
  }
  return { kind: 'none' }
}

describe('resume target resolution', () => {
  let workspace: string
  let sessionPath: string

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'pidex-resume-'))
    sessionPath = join(workspace, 'session.jsonl')
    await writeFile(sessionPath, '{"type":"session"}\n')
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('resumes the exact session when both paths exist', async () => {
    await expect(
      resolveResumeTarget({ lastSessionPath: sessionPath, lastWorkspacePath: workspace }),
    ).resolves.toEqual({ kind: 'session', sessionPath, workspacePath: workspace })
  })

  it('falls back to the workspace when the session file is gone', async () => {
    await rm(sessionPath)
    await expect(
      resolveResumeTarget({ lastSessionPath: sessionPath, lastWorkspacePath: workspace }),
    ).resolves.toEqual({ kind: 'workspace', workspacePath: workspace })
  })

  it('falls back to the picker when the workspace is gone', async () => {
    await rm(workspace, { recursive: true, force: true })
    await expect(
      resolveResumeTarget({ lastSessionPath: sessionPath, lastWorkspacePath: workspace }),
    ).resolves.toEqual({ kind: 'none' })
  })

  it('lands on the workspace when no session was remembered', async () => {
    await expect(resolveResumeTarget({ lastWorkspacePath: workspace })).resolves.toEqual({
      kind: 'workspace',
      workspacePath: workspace,
    })
  })

  it('lands on the picker on a first run', async () => {
    await expect(resolveResumeTarget({})).resolves.toEqual({ kind: 'none' })
  })

  it('ignores a session path with no workspace recorded', async () => {
    await expect(resolveResumeTarget({ lastSessionPath: sessionPath })).resolves.toEqual({
      kind: 'none',
    })
  })
})
