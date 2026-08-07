import type { DirEntry } from '@shared/models'
import { dirname } from '@/lib/path'
import { useFilesStore } from '@/stores/files'

/** Create / rename / trash actions for the file explorer's context menu. */

export async function createIn(
  workspacePath: string,
  entry: DirEntry,
  kind: 'file' | 'folder',
): Promise<void> {
  const dir = entry.isDirectory ? entry.path : dirname(entry.path)
  const name = window.prompt(`New ${kind} name`)
  if (!name) return
  const target = `${dir}/${name}`
  if (kind === 'file') await window.pidex.invoke('fs:createFile', target)
  else await window.pidex.invoke('fs:createDir', target)
  const store = useFilesStore.getState()
  await store.refreshDir(workspacePath, dir)
  if (kind === 'file') await store.openFile(workspacePath, target)
}

export async function renameEntry(workspacePath: string, entry: DirEntry): Promise<void> {
  const name = window.prompt('New name', entry.name)
  if (!name || name === entry.name) return
  const dir = dirname(entry.path)
  await window.pidex.invoke('fs:rename', entry.path, `${dir}/${name}`)
  await useFilesStore.getState().refreshDir(workspacePath, dir)
}

export async function trashEntry(workspacePath: string, entry: DirEntry): Promise<void> {
  await window.pidex.invoke('fs:trash', entry.path)
  const dir = dirname(entry.path)
  const store = useFilesStore.getState()
  store.closeFile(workspacePath, entry.path)
  await store.refreshDir(workspacePath, dir)
}
