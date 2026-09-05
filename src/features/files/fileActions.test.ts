import { expect, it, vi } from 'vitest'
vi.mock('@/lib/monaco', () => ({ languageForPath: () => 'typescript' }))
vi.mock('@/features/files/MonacoEditor', () => ({ releaseFileModel: vi.fn() }))
import { entryPath } from './fileActions'
import { useFilesStore } from '@/stores/files'

it('accepts file names, not traversal or absolute paths', () => {
  for (const name of ['..', '.', '../out', '/tmp/out', 'a\\b', '\0', ' ']) {
    expect(() => entryPath('/repo', name)).toThrow()
  }
  expect(entryPath('/repo/', 'notes.md')).toBe('/repo/notes.md')
  expect(entryPath('C:\\repo', 'notes.md')).toBe('C:\\repo\\notes.md')
})

it('retargets dirty descendants without losing buffers, and closes them after trash', () => {
  const file = (path: string) => ({
    path,
    relativePath: path.slice(6),
    language: 'typescript',
    savedContent: 'disk',
    content: 'unsaved',
    mtimeMs: 1,
    dirty: true,
  })
  useFilesStore.setState({
    byWorkspace: {
      '/repo': {
        openFiles: [file('/repo/src/a.ts'), file('/repo/src-other.ts')],
        activePath: '/repo/src/a.ts',
        gitStatus: {},
      },
      '/other': { openFiles: [file('/other/a.ts')], activePath: '/other/a.ts', gitStatus: {} },
    },
    entries: { '/repo': [], '/repo/src': [], '/repo/src/nested': [] },
    expanded: { '/repo/src': true },
  })
  const store = useFilesStore.getState()
  store.reconcilePath('/repo', '/repo/src', '/repo/lib')
  const slice = useFilesStore.getState().byWorkspace['/repo']!
  expect(slice.activePath).toBe('/repo/lib/a.ts')
  expect(slice.openFiles[0]).toMatchObject({
    path: '/repo/lib/a.ts',
    content: 'unsaved',
    dirty: true,
  })
  expect(useFilesStore.getState().entries).toEqual({ '/repo': [] })
  store.reconcilePath('/repo', '/repo/lib')
  expect(useFilesStore.getState().byWorkspace['/repo']!.openFiles.map((f) => f.path)).toEqual([
    '/repo/src-other.ts',
  ])
  expect(useFilesStore.getState().byWorkspace['/other']!.activePath).toBe('/other/a.ts')
})
