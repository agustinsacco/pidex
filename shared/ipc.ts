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
  LiveSessionInfo,
  PiHealth,
  SessionPush,
  ThemePreference,
} from './models'

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
