import { create } from 'zustand'
import type { DirEntry } from '@shared/models'
import { languageForPath } from '@/lib/monaco'

export interface OpenFile {
  path: string
  relativePath: string
  language: string
  /** Disk content at load/save time. */
  savedContent: string
  /** Editor buffer (== savedContent when clean). */
  content: string
  mtimeMs: number
  dirty: boolean
  binary?: boolean
  tooLarge?: boolean
  /** Set when the file changed on disk while dirty (conflict bar). */
  diskConflict?: boolean
  /** Line to reveal when the editor mounts / re-focuses. */
  pendingRevealLine?: number
}

/**
 * Editor + git state for ONE workspace. Keyed per workspace so switching to a
 * session in another project shows that project's editors, not the previous
 * one's — a stale editor from another repo is worse than no editor.
 */
interface WorkspaceFiles {
  openFiles: OpenFile[]
  activePath: string | null
  gitStatus: Record<string, string>
}

/** Stable empty value so selectors don't allocate a new object per render. */
const EMPTY_WORKSPACE_FILES: WorkspaceFiles = Object.freeze({
  openFiles: [],
  activePath: null,
  gitStatus: {},
})

interface FilesState {
  // explorer — keyed by absolute dir path, so already collision-free
  entries: Record<string, DirEntry[] | undefined>
  expanded: Record<string, boolean>
  showHidden: boolean
  respectGitignore: boolean
  /** workspacePath → that workspace's editors and git status. */
  byWorkspace: Record<string, WorkspaceFiles>

  toggleDir: (workspacePath: string, dirPath: string) => Promise<void>
  refreshDir: (workspacePath: string, dirPath: string) => Promise<void>
  refreshGitStatus: (workspacePath: string) => Promise<void>
  setShowHidden: (workspacePath: string, value: boolean) => void
  setRespectGitignore: (workspacePath: string, value: boolean) => void

  openFile: (workspacePath: string, path: string, line?: number) => Promise<void>
  closeFile: (workspacePath: string, path: string) => void
  setActive: (workspacePath: string, path: string) => void
  updateBuffer: (workspacePath: string, path: string, content: string) => void
  saveFile: (workspacePath: string, path: string) => Promise<void>
  consumeReveal: (workspacePath: string, path: string) => number | undefined
  /** Called on chokidar changes: reload clean buffers, flag dirty ones. */
  handleExternalChanges: (workspacePath: string, paths: string[]) => Promise<void>
  reloadFromDisk: (workspacePath: string, path: string) => Promise<void>
  keepBuffer: (workspacePath: string, path: string) => void
}

/** Files state for a workspace; the shared empty value when none exists yet. */
export function workspaceFiles(state: FilesState, workspacePath: string): WorkspaceFiles {
  return state.byWorkspace[workspacePath] ?? EMPTY_WORKSPACE_FILES
}

function relativeTo(workspacePath: string, path: string): string {
  const prefix = workspacePath.endsWith('/') ? workspacePath : workspacePath + '/'
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

/** Apply a patch to one workspace's slice, creating it if absent. */
function patchWorkspace(
  state: FilesState,
  workspacePath: string,
  update: (current: WorkspaceFiles) => WorkspaceFiles,
): Pick<FilesState, 'byWorkspace'> {
  const current = state.byWorkspace[workspacePath] ?? EMPTY_WORKSPACE_FILES
  return { byWorkspace: { ...state.byWorkspace, [workspacePath]: update(current) } }
}

export const useFilesStore = create<FilesState>((set, get) => ({
  entries: {},
  expanded: {},
  showHidden: false,
  respectGitignore: true,
  byWorkspace: {},

  toggleDir: async (workspacePath, dirPath) => {
    const { expanded } = get()
    const isOpen = expanded[dirPath] ?? false
    set((s) => ({ expanded: { ...s.expanded, [dirPath]: !isOpen } }))
    if (!isOpen && !get().entries[dirPath]) {
      await get().refreshDir(workspacePath, dirPath)
    }
  },

  refreshDir: async (workspacePath, dirPath) => {
    const { showHidden, respectGitignore } = get()
    try {
      const list = await window.pidex.invoke('fs:readDir', workspacePath, dirPath, {
        showHidden,
        respectGitignore,
      })
      set((s) => ({ entries: { ...s.entries, [dirPath]: list } }))
    } catch {
      set((s) => ({ entries: { ...s.entries, [dirPath]: [] } }))
    }
  },

  refreshGitStatus: async (workspacePath) => {
    const gitStatus = await window.pidex.invoke('git:statusMap', workspacePath)
    set((s) => patchWorkspace(s, workspacePath, (w) => ({ ...w, gitStatus })))
  },

  setShowHidden: (workspacePath, value) => {
    set({ showHidden: value, entries: {} })
    void get().refreshDir(workspacePath, workspacePath)
  },

  setRespectGitignore: (workspacePath, value) => {
    set({ respectGitignore: value, entries: {} })
    void get().refreshDir(workspacePath, workspacePath)
  },

  openFile: async (workspacePath, path, line) => {
    const existing = workspaceFiles(get(), workspacePath).openFiles.find((f) => f.path === path)
    if (existing) {
      set((s) =>
        patchWorkspace(s, workspacePath, (w) => ({
          ...w,
          activePath: path,
          openFiles: w.openFiles.map((f) =>
            f.path === path ? { ...f, pendingRevealLine: line ?? f.pendingRevealLine } : f,
          ),
        })),
      )
      return
    }
    const file = await window.pidex.invoke('fs:readFile', path)
    const openFile: OpenFile = {
      path,
      relativePath: relativeTo(workspacePath, path),
      language: languageForPath(path),
      savedContent: file.content,
      content: file.content,
      mtimeMs: file.mtimeMs,
      dirty: false,
      binary: file.binary,
      tooLarge: file.tooLarge,
      pendingRevealLine: line,
    }
    set((s) =>
      patchWorkspace(s, workspacePath, (w) => ({
        ...w,
        openFiles: [...w.openFiles, openFile],
        activePath: path,
      })),
    )
  },

  closeFile: (workspacePath, path) => {
    set((s) =>
      patchWorkspace(s, workspacePath, (w) => {
        const openFiles = w.openFiles.filter((f) => f.path !== path)
        return {
          ...w,
          openFiles,
          activePath:
            w.activePath === path ? (openFiles[openFiles.length - 1]?.path ?? null) : w.activePath,
        }
      }),
    )
  },

  setActive: (workspacePath, path) => {
    set((s) => patchWorkspace(s, workspacePath, (w) => ({ ...w, activePath: path })))
  },

  updateBuffer: (workspacePath, path, content) => {
    set((s) =>
      patchWorkspace(s, workspacePath, (w) => ({
        ...w,
        openFiles: w.openFiles.map((f) =>
          f.path === path ? { ...f, content, dirty: content !== f.savedContent } : f,
        ),
      })),
    )
  },

  saveFile: async (workspacePath, path) => {
    const file = workspaceFiles(get(), workspacePath).openFiles.find((f) => f.path === path)
    if (!file || !file.dirty) return
    const { mtimeMs } = await window.pidex.invoke('fs:writeFile', path, file.content)
    set((s) =>
      patchWorkspace(s, workspacePath, (w) => ({
        ...w,
        openFiles: w.openFiles.map((f) =>
          f.path === path
            ? { ...f, savedContent: f.content, dirty: false, mtimeMs, diskConflict: false }
            : f,
        ),
      })),
    )
  },

  consumeReveal: (workspacePath, path) => {
    const file = workspaceFiles(get(), workspacePath).openFiles.find((f) => f.path === path)
    const line = file?.pendingRevealLine
    if (line !== undefined) {
      set((s) =>
        patchWorkspace(s, workspacePath, (w) => ({
          ...w,
          openFiles: w.openFiles.map((f) =>
            f.path === path ? { ...f, pendingRevealLine: undefined } : f,
          ),
        })),
      )
    }
    return line
  },

  handleExternalChanges: async (workspacePath, paths) => {
    const changed = new Set(paths)
    const affected = workspaceFiles(get(), workspacePath).openFiles.filter((f) =>
      changed.has(f.path),
    )
    for (const file of affected) {
      if (file.dirty) {
        set((s) =>
          patchWorkspace(s, workspacePath, (w) => ({
            ...w,
            openFiles: w.openFiles.map((f) =>
              f.path === file.path ? { ...f, diskConflict: true } : f,
            ),
          })),
        )
      } else {
        await get().reloadFromDisk(workspacePath, file.path)
      }
    }
  },

  reloadFromDisk: async (workspacePath, path) => {
    try {
      const file = await window.pidex.invoke('fs:readFile', path)
      set((s) =>
        patchWorkspace(s, workspacePath, (w) => ({
          ...w,
          openFiles: w.openFiles.map((f) =>
            f.path === path
              ? {
                  ...f,
                  savedContent: file.content,
                  content: file.content,
                  mtimeMs: file.mtimeMs,
                  dirty: false,
                  diskConflict: false,
                }
              : f,
          ),
        })),
      )
    } catch {
      // Deleted externally — keep the buffer, flag the conflict.
      set((s) =>
        patchWorkspace(s, workspacePath, (w) => ({
          ...w,
          openFiles: w.openFiles.map((f) => (f.path === path ? { ...f, diskConflict: true } : f)),
        })),
      )
    }
  },

  keepBuffer: (workspacePath, path) => {
    set((s) =>
      patchWorkspace(s, workspacePath, (w) => ({
        ...w,
        openFiles: w.openFiles.map((f) =>
          f.path === path ? { ...f, diskConflict: false, dirty: true } : f,
        ),
      })),
    )
  },
}))
