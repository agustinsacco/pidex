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
})
