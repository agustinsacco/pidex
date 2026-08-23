import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceInfo } from '@shared/models'

const invoke = vi.fn().mockResolvedValue(undefined)

const workspaces = (paths: string[]): WorkspaceInfo[] =>
  paths.map((path, index) => ({ path, name: path.slice(1), lastOpenedAt: index }))

beforeEach(async () => {
  invoke.mockClear()
  vi.stubGlobal('window', { pidex: { invoke } })
  const { useWorkspacesStore } = await import('./workspaces')
  useWorkspacesStore.setState({ homePath: null, recents: workspaces(['/a', '/b', '/c']) })
})

describe('workspace ordering', () => {
  it('keeps an existing workspace in place when it is opened', async () => {
    const { useWorkspacesStore } = await import('./workspaces')

    useWorkspacesStore.getState().openWorkspace('/b')

    expect(useWorkspacesStore.getState().recents.map((workspace) => workspace.path)).toEqual([
      '/a',
      '/b',
      '/c',
    ])
    expect(invoke).toHaveBeenCalledWith('app:recordWorkspace', '/b')
  })

  it('moves a workspace only when the user asks to move it', async () => {
    const { useWorkspacesStore } = await import('./workspaces')

    useWorkspacesStore.getState().moveWorkspace('/b', 'up')

    expect(useWorkspacesStore.getState().recents.map((workspace) => workspace.path)).toEqual([
      '/b',
      '/a',
      '/c',
    ])
    expect(invoke).toHaveBeenCalledWith('app:setRecentWorkspaces', [
      expect.objectContaining({ path: '/b' }),
      expect.objectContaining({ path: '/a' }),
      expect.objectContaining({ path: '/c' }),
    ])
  })

  it('does not add a worktree folder as a workspace (a branch, not a project)', async () => {
    const { useWorkspacesStore } = await import('./workspaces')
    const wt = '/a/.pidex/worktrees/my-task'

    useWorkspacesStore.getState().openWorkspace(wt)

    expect(useWorkspacesStore.getState().recents.map((workspace) => workspace.path)).toEqual([
      '/a',
      '/b',
      '/c',
    ])
    // The screen does point at it (resume target / top bar), and the main
    // process is told so it can remember `lastWorkspacePath`.
    expect(useWorkspacesStore.getState().homePath).toBe(wt)
    expect(invoke).toHaveBeenCalledWith('app:recordWorkspace', wt)
  })
})
