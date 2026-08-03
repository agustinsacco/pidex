import { contextBridge, ipcRenderer } from 'electron'
import type { IpcInvokeChannel, IpcInvokeMap, PidexApi } from '@shared/ipc'
import { sessionEventChannel } from '@shared/ipc'
import type { SessionPush } from '@shared/models'
import type { RpcCommand } from '@shared/rpc'

const api: PidexApi = {
  invoke<C extends IpcInvokeChannel>(channel: C, ...args: IpcInvokeMap[C]['args']) {
    return ipcRenderer.invoke(channel, ...args) as Promise<IpcInvokeMap[C]['result']>
  },

  onSessionPush(sessionId: string, listener: (push: SessionPush) => void) {
    const channel = sessionEventChannel(sessionId)
    const wrapped = (_event: Electron.IpcRendererEvent, push: SessionPush) => listener(push)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },

  onSessionsChanged(listener: (payload: { workspacePath: string }) => void) {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: { workspacePath: string }) =>
      listener(payload)
    ipcRenderer.on('sessions:changed', wrapped)
    return () => ipcRenderer.removeListener('sessions:changed', wrapped)
  },

  onFsChanged(listener: (payload: { workspacePath: string; paths: string[] }) => void) {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      payload: { workspacePath: string; paths: string[] },
    ) => listener(payload)
    ipcRenderer.on('fs:changed', wrapped)
    return () => ipcRenderer.removeListener('fs:changed', wrapped)
  },

  onPtyData(ptyId: string, listener: (data: string) => void) {
    const channel = `pty:data:${ptyId}`
    const wrapped = (_event: Electron.IpcRendererEvent, data: string) => listener(data)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },

  onPtyExit(ptyId: string, listener: (exitCode: number) => void) {
    const channel = `pty:exit:${ptyId}`
    const wrapped = (_event: Electron.IpcRendererEvent, exitCode: number) => listener(exitCode)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },

  piCommand(sessionId: string, command: RpcCommand) {
    return ipcRenderer.invoke('pi:command', sessionId, command)
  },
}

contextBridge.exposeInMainWorld('pidex', api)
