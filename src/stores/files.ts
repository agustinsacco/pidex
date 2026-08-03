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

interface FilesState {
  // explorer
  entries: Record<string, DirEntry[] | undefined>
  expanded: Record<string, boolean>
  showHidden: boolean
  respectGitignore: boolean
  gitStatus: Record<string, string>
  // editor
  openFiles: OpenFile[]
  activePath: string | null

  toggleDir: (workspacePath: string, dirPath: string) => Promise<void>
  refreshDir: (workspacePath: string, dirPath: string) => Promise<void>
  refreshGitStatus: (workspacePath: string) => Promise<void>
  setShowHidden: (workspacePath: string, value: boolean) => void
  setRespectGitignore: (workspacePath: string, value: boolean) => void

  openFile: (workspacePath: string, path: string, line?: number) => Promise<void>
  closeFile: (path: string) => void
  setActive: (path: string) => void
  updateBuffer: (path: string, content: string) => void
  saveFile: (path: string) => Promise<void>
  consumeReveal: (path: string) => number | undefined
  /** Called on chokidar changes: reload clean buffers, flag dirty ones. */
  handleExternalChanges: (paths: string[]) => Promise<void>
  reloadFromDisk: (path: string) => Promise<void>
  keepBuffer: (path: string) => void
}

function relativeTo(workspacePath: string, path: string): string {
  const prefix = workspacePath.endsWith('/') ? workspacePath : workspacePath + '/'
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

export const useFilesStore = create<FilesState>((set, get) => ({
  entries: {},
  expanded: {},
  showHidden: false,
  respectGitignore: true,
  gitStatus: {},
  openFiles: [],
  activePath: null,

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
    set({ gitStatus })
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
    const existing = get().openFiles.find((f) => f.path === path)
    if (existing) {
      set((s) => ({
        activePath: path,
        openFiles: s.openFiles.map((f) =>
          f.path === path ? { ...f, pendingRevealLine: line ?? f.pendingRevealLine } : f,
        ),
      }))
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
    set((s) => ({ openFiles: [...s.openFiles, openFile], activePath: path }))
  },

  closeFile: (path) => {
    set((s) => {
      const openFiles = s.openFiles.filter((f) => f.path !== path)
      const activePath =
        s.activePath === path ? (openFiles[openFiles.length - 1]?.path ?? null) : s.activePath
      return { openFiles, activePath }
    })
  },

  setActive: (path) => set({ activePath: path }),

  updateBuffer: (path, content) => {
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, content, dirty: content !== f.savedContent } : f,
      ),
    }))
  },

  saveFile: async (path) => {
    const file = get().openFiles.find((f) => f.path === path)
    if (!file || !file.dirty) return
    const { mtimeMs } = await window.pidex.invoke('fs:writeFile', path, file.content)
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === path
          ? { ...f, savedContent: f.content, dirty: false, mtimeMs, diskConflict: false }
          : f,
      ),
    }))
  },

  consumeReveal: (path) => {
    const file = get().openFiles.find((f) => f.path === path)
    const line = file?.pendingRevealLine
    if (line !== undefined) {
      set((s) => ({
        openFiles: s.openFiles.map((f) =>
          f.path === path ? { ...f, pendingRevealLine: undefined } : f,
        ),
      }))
    }
    return line
  },

  handleExternalChanges: async (paths) => {
    const changed = new Set(paths)
    const affected = get().openFiles.filter((f) => changed.has(f.path))
    for (const file of affected) {
      if (file.dirty) {
        set((s) => ({
          openFiles: s.openFiles.map((f) =>
            f.path === file.path ? { ...f, diskConflict: true } : f,
          ),
        }))
      } else {
        await get().reloadFromDisk(file.path)
      }
    }
  },

  reloadFromDisk: async (path) => {
    try {
      const file = await window.pidex.invoke('fs:readFile', path)
      set((s) => ({
        openFiles: s.openFiles.map((f) =>
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
      }))
    } catch {
      // deleted externally — keep buffer, mark conflict
      set((s) => ({
        openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, diskConflict: true } : f)),
      }))
    }
  },

  keepBuffer: (path) => {
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, diskConflict: false, dirty: true } : f,
      ),
    }))
  },
}))
