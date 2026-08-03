/**
 * Typed IPC contract between main and renderer.
 *
 * Request/response methods use `ipcRenderer.invoke` on the channels in
 * `IpcInvokeMap`. Streams are pushed from main on per-session channels
 * (`pi:event:<sessionId>`) declared by `sessionEventChannel`.
 */
import type {
  RpcCommand,
  RpcResponse,
  ExtensionUIResponse,
  RpcResponseDataMap,
} from './rpc'
import type {
  AppPrefs,
  CreateSessionOptions,
  GitInfo,
  LiveSessionInfo,
  PiHealth,
  SessionMeta,
  SessionPush,
  ThemePreference,
  WorkspaceSessionStats,
} from './models'

/** Parsed session tree (subset of entries) for the tree view. */
export interface SessionTreeEntry {
  id: string
  parentId: string | null
  type: string
  timestamp: string
  role?: string
  preview?: string
  toolName?: string
  targetId?: string
  label?: string
  summary?: string
  name?: string
}

export interface SessionTree {
  sessionId: string
  cwd: string
  entries: SessionTreeEntry[]
  leafId: string | null
}

export interface IpcInvokeMap {
  'pi:health': { args: []; result: PiHealth }
  'pi:createSession': { args: [CreateSessionOptions]; result: LiveSessionInfo }
  'pi:command': { args: [sessionId: string, command: RpcCommand]; result: RpcResponse }
  'pi:extensionUiResponse': { args: [sessionId: string, response: ExtensionUIResponse]; result: void }
  'pi:disposeSession': { args: [sessionId: string]; result: void }
  'pi:listLiveSessions': { args: []; result: LiveSessionInfo[] }

  'app:getPrefs': { args: []; result: AppPrefs }
  'app:setTheme': { args: [ThemePreference]; result: void }
  'app:selectFolder': { args: []; result: string | null }
  'app:getPathForDisplay': { args: [string]; result: string }
  'app:setPinnedSessions': { args: [string[]]; result: void }
  'app:userInfo': { args: []; result: { username: string } }
  'app:saveDialog': {
    args: [{ title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }]
    result: string | null
  }
  'app:revealPath': { args: [string]; result: void }

  'fs:listFiles': { args: [workspacePath: string]; result: string[] }
  'pi:agentSettings': { args: [workspacePath?: string]; result: Record<string, unknown> }

  'sessions:list': { args: [workspacePath: string]; result: SessionMeta[] }
  'sessions:stats': { args: [workspacePath: string]; result: WorkspaceSessionStats }
  'sessions:watch': { args: [workspacePath: string]; result: void }
  'sessions:delete': { args: [sessionFilePath: string]; result: void }
  'sessions:readTree': { args: [sessionFilePath: string]; result: SessionTree }
  'sessions:appendLabel': {
    args: [sessionFilePath: string, targetId: string, label: string | undefined]
    result: void
  }
  'sessions:jump': { args: [sessionFilePath: string, targetId: string]; result: void }
  'sessions:forkAt': { args: [sessionFilePath: string, targetId: string]; result: string }

  'git:info': { args: [workspacePath: string]; result: GitInfo }
}

export type IpcInvokeChannel = keyof IpcInvokeMap

export const sessionEventChannel = (sessionId: string): string => `pi:event:${sessionId}`

/** The API surface exposed on window.pidex by the preload script. */
export interface PidexApi {
  invoke<C extends IpcInvokeChannel>(
    channel: C,
    ...args: IpcInvokeMap[C]['args']
  ): Promise<IpcInvokeMap[C]['result']>

  /**
   * Subscribe to a live session's pushed events.
   * Returns an unsubscribe function.
   */
  onSessionPush(sessionId: string, listener: (push: SessionPush) => void): () => void

  /** Session-dir change notifications (chokidar); returns unsubscribe. */
  onSessionsChanged(listener: (payload: { workspacePath: string }) => void): () => void

  /** Convenience wrapper: send an RPC command and get the typed response data. */
  piCommand<T extends RpcCommand['type']>(
    sessionId: string,
    command: Extract<RpcCommand, { type: T }>,
  ): Promise<RpcResponse<RpcResponseDataMap[T]>>
}

declare global {
  interface Window {
    pidex: PidexApi
  }
}
