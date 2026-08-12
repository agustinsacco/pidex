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
  ThinkingLevelMap,
} from './rpc'
import type {
  McpCacheEntry,
  McpConfigsResult,
  McpScope,
  McpServerConfig,
  McpWriteScope,
} from './mcp'
import type {
  AddWorktreeBranch,
  AppPrefs,
  AboutInfo,
  AgentSettingsHealth,
  BranchInfo,
  CreateSessionOptions,
  DirEntry,
  FileContent,
  FontPrefs,
  GhPullRequest,
  GitInfo,
  LiveSessionInfo,
  PiHealth,
  PiResources,
  ResourceSnapshot,
  SaveDialogOptions,
  SessionMeta,
  SessionPush,
  UpdateState,
  ThemePreference,
  UsageSummary,
  WorkspaceInfo,
  WorkspaceSessionStats,
  WorktreeInfo,
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
  /** model_change entries. */
  provider?: string
  modelId?: string
  /** thinking_level_change entries. */
  thinkingLevel?: string
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
  'pi:extensionUiResponse': {
    args: [sessionId: string, response: ExtensionUIResponse]
    result: void
  }
  'pi:disposeSession': { args: [sessionId: string]; result: void }
  'pi:listLiveSessions': { args: []; result: LiveSessionInfo[] }

  'app:getPrefs': { args: []; result: AppPrefs }
  'app:setTheme': { args: [ThemePreference]; result: void }
  'app:selectFolder': { args: []; result: string | null }
  'app:getPathForDisplay': { args: [string]; result: string }
  'app:setPinnedSessions': { args: [string[]]; result: void }
  'app:setLastSession': { args: [sessionPath: string | undefined]; result: void }
  /**
   * Where to land on launch, with existence already validated in main so the
   * renderer never routes to a folder or session file that has been deleted.
   */
  'app:resumeTarget': {
    args: []
    result:
      | { kind: 'session'; sessionPath: string; workspacePath: string }
      | { kind: 'workspace'; workspacePath: string }
      | { kind: 'none' }
  }
  'app:setFontPrefs': { args: [FontPrefs]; result: void }
  'app:setRecentWorkspaces': { args: [WorkspaceInfo[]]; result: void }
  'app:setCollapsedWorkspaces': { args: [paths: string[]]; result: void }
  /**
   * Persist "this workspace is now the home target": bumps it in recents and
   * records it as lastWorkspacePath so the next launch lands here even if no
   * session is ever created.
   */
  'app:recordWorkspace': { args: [path: string]; result: void }
  /** Mark a session file as viewed now (unseen-pill bookkeeping). */
  'app:markSessionSeen': { args: [sessionPath: string]; result: void }
  /** `awsProfile` lets error remedies suggest the right `aws sso login`. */
  'app:userInfo': { args: []; result: { username: string; awsProfile?: string } }
  'app:about': { args: []; result: AboutInfo }
  'app:saveDialog': { args: [SaveDialogOptions]; result: string | null }
  'app:revealPath': { args: [string]; result: void }
  'app:openExternal': { args: [string]; result: void }

  'fs:listFiles': { args: [workspacePath: string]; result: string[] }
  'pi:agentSettings': { args: [workspacePath?: string]; result: Record<string, unknown> }
  /** Models from pi's models.json, for pickers with no live session yet. */
  'pi:catalogueModels': {
    args: []
    result: {
      id: string
      name: string
      provider: string
      reasoning: boolean
      thinkingLevelMap?: ThinkingLevelMap | null
    }[]
  }
  'pi:readConfigFile': {
    args: [name: 'settings' | 'models']
    result: { path: string; content: string }
  }
  'pi:writeConfigFile': { args: [name: 'settings' | 'models', content: string]; result: void }
  'pi:patchAgentSettings': {
    args: [
      scope: 'global' | 'project',
      workspacePath: string | undefined,
      patch: Record<string, unknown>,
    ]
    result: void
  }
  'pi:checkAgentSettings': { args: [workspacePath?: string]; result: AgentSettingsHealth }
  'pi:listResources': { args: []; result: PiResources }

  /**
   * MCP config chain (pi-mcp-adapter). The renderer names scopes; paths are
   * resolved in main only.
   */
  'mcp:readConfigs': { args: [workspacePath?: string]; result: McpConfigsResult }
  'mcp:upsertServer': {
    args: [
      scope: McpWriteScope,
      workspacePath: string | undefined,
      name: string,
      config: McpServerConfig,
    ]
    result: void
  }
  'mcp:removeServer': {
    args: [scope: McpScope, workspacePath: string | undefined, name: string]
    result: void
  }
  'mcp:setDisabled': {
    args: [scope: McpScope, workspacePath: string | undefined, name: string, disabled: boolean]
    result: void
  }
  'mcp:readCache': { args: []; result: McpCacheEntry[] }
  'mcp:readFile': {
    args: [scope: McpScope, workspacePath: string | undefined]
    result: { path: string; content: string }
  }
  'mcp:writeFile': {
    args: [scope: McpScope, workspacePath: string | undefined, content: string]
    result: void
  }

  'sessions:list': { args: [workspacePath: string]; result: SessionMeta[] }
  /** Usage rollup across all workspaces (Usage view; user-initiated). */
  'sessions:usage': { args: []; result: UsageSummary }
  'sessions:stats': { args: [workspacePath: string]; result: WorkspaceSessionStats }
  'sessions:watch': { args: [workspacePath: string]; result: void }
  'sessions:unwatch': { args: [workspacePath: string]; result: void }
  'sessions:delete': { args: [sessionFilePath: string]; result: void }
  'sessions:readTree': { args: [sessionFilePath: string]; result: SessionTree }
  'sessions:appendLabel': {
    args: [sessionFilePath: string, targetId: string, label: string | undefined]
    result: void
  }
  'sessions:jump': { args: [sessionFilePath: string, targetId: string]; result: void }
  'sessions:forkAt': { args: [sessionFilePath: string, targetId: string]; result: string }

  /** PR for a branch via the `gh` CLI; null when gh/auth/remote is absent. */
  'gh:prForBranch': {
    args: [repoPath: string, branch: string]
    result: GhPullRequest | null
  }
  'gh:available': { args: []; result: boolean }

  'git:info': { args: [workspacePath: string]; result: GitInfo }
  /** Cheap cached summaries (branch/worktree/dirty) for many cwds at once. */
  'git:infoBatch': { args: [cwds: string[]]; result: Record<string, GitInfo> }
  'git:statusMap': { args: [workspacePath: string]; result: Record<string, string> }
  'git:sessionBaseline': { args: [workspacePath: string]; result: string | null }
  'git:showFileAt': {
    args: [workspacePath: string, ref: string, relativePath: string]
    result: string | null
  }
  'git:restoreFileTo': {
    args: [workspacePath: string, ref: string, relativePath: string]
    result: { restored: boolean; deleted: boolean }
  }
  'git:listWorktrees': { args: [repoPath: string]; result: WorktreeInfo[] }
  'git:listBranches': {
    args: [repoPath: string]
    result: { branches: BranchInfo[]; defaultBranch: string }
  }
  /** Create `<repo>/.pidex/worktrees/<name>` on a new or existing branch. */
  'git:addWorktree': {
    args: [repoPath: string, name: string, branch: AddWorktreeBranch]
    result: WorktreeInfo
  }
  /** Dirty worktrees are refused unless forced; branch delete is `-d` only. */
  'git:removeWorktree': {
    args: [
      repoPath: string,
      worktreePath: string,
      options: { force?: boolean; deleteBranch?: boolean },
    ]
    result:
      | { removed: true; branchDeleted: boolean; branchError?: string }
      | { removed: false; dirtyCount: number }
  }
  'git:pruneWorktrees': { args: [repoPath: string]; result: { pruned: string[] } }
  'git:commitAll': { args: [worktreePath: string, message: string]; result: { sha: string } }
  /** Merge into the main tree's current branch; aborts cleanly on conflict. */
  'git:mergeBranch': {
    args: [repoPath: string, branch: string]
    result:
      | { merged: true; sha: string }
      | { merged: false; reason: 'dirty'; dirtyCount: number }
      | { merged: false; reason: 'conflict'; conflicts: string[] }
  }

  'fs:readDir': {
    args: [
      workspacePath: string,
      dirPath: string,
      options: { showHidden?: boolean; respectGitignore?: boolean },
    ]
    result: DirEntry[]
  }
  'fs:readFile': { args: [path: string]; result: FileContent }
  'fs:writeFile': { args: [path: string, content: string]; result: { mtimeMs: number } }
  'fs:createFile': { args: [path: string]; result: void }
  'fs:createDir': { args: [path: string]; result: void }
  'fs:rename': { args: [from: string, to: string]; result: void }
  'fs:trash': { args: [path: string]; result: void }
  'fs:watchWorkspace': { args: [workspacePath: string]; result: void }

  'pty:create': {
    /**
     * `sessionId` is the OWNING chat session. Main needs it to attribute a
     * terminal's process tree (a build, a test run, a dev server) to that
     * session in the resource monitor; without it that mapping lives only in
     * the renderer's terminal store and main cannot see it.
     */
    args: [workspacePath: string, cols: number, rows: number, sessionId?: string]
    result: { ptyId: string }
  }
  'pty:write': { args: [ptyId: string, data: string]; result: void }
  'pty:resize': { args: [ptyId: string, cols: number, rows: number]; result: void }
  'pty:kill': { args: [ptyId: string]; result: void }

  /**
   * Resource monitor. Sampling is reference-counted and OFF until something
   * subscribes — a monitor that polls when nobody is watching would be its own
   * resource bug. Samples arrive on the `resources:sample` push channel.
   */
  'resources:subscribe': { args: []; result: ResourceSnapshot | null }
  'resources:unsubscribe': { args: []; result: void }
  'resources:openWindow': { args: []; result: void }
  'resources:closeWindow': { args: []; result: void }

  /**
   * Auto-update. Checks are driven by main on a timer; the renderer only reads
   * state and asks for the install. Installing is ALWAYS user-initiated.
   */
  'updates:state': { args: []; result: UpdateState }
  'updates:check': { args: []; result: void }
  'updates:restartAndInstall': { args: []; result: void }
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

  /** Workspace file-change notifications; returns unsubscribe. */
  onFsChanged(listener: (payload: { workspacePath: string; paths: string[] }) => void): () => void

  /** PTY output stream; returns unsubscribe. */
  onPtyData(ptyId: string, listener: (data: string) => void): () => void
  /** PTY exit notification; returns unsubscribe. */
  onPtyExit(ptyId: string, listener: (exitCode: number) => void): () => void
  /** Busy map broadcast (ptyId → foreground process running); unsubscribe. */
  onPtyStatus(listener: (statuses: Record<string, boolean>) => void): () => void
  /** Resource monitor ticks; only fires while something is subscribed. */
  onResourceSample(listener: (snapshot: ResourceSnapshot) => void): () => void
  /** Update lifecycle changes (checking / downloading / ready to install). */
  onUpdateEvent(listener: (state: UpdateState) => void): () => void

  /**
   * Absolute path for a dropped File (Electron `webUtils`). Non-image
   * attachments are handed to pi as paths, so it needs the real location.
   */
  pathForFile(file: File): string

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
