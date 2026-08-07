import { create } from 'zustand'
import type { SessionMeta, SessionPush } from '@shared/models'
import type { ImageContent } from '@shared/rpc'
import { useChatStore } from './chat'

/**
 * Live pi subprocesses + on-disk session catalogue.
 * Multiple sessions stream concurrently; switching is instant because chat
 * state is keyed by pidex session id and background handlers keep reducing.
 */

interface LiveSessionEntry {
  pidexId: string
  workspacePath: string
  /** Disk session file, learned from get_state after spawn. */
  diskPath?: string
}

interface SessionsState {
  activeSessionId: string | null
  /** pidexId → live entry. */
  live: Record<string, LiveSessionEntry>
  /** workspacePath → on-disk metas (sidebar). */
  disk: Record<string, SessionMeta[]>
  /** pidexId → unread activity count for background sessions. */
  unread: Record<string, number>
  /** pidexId → git session baseline ref (null = not a repo). */
  baselines: Record<string, string | null>
  pinned: string[]
  creating: boolean

  hydratePinned: () => Promise<void>
  refreshDisk: (workspacePath: string) => Promise<void>
  /** Scan many workspaces in parallel (capped); powers the grouped sidebar. */
  refreshAllDisk: (workspacePaths: string[], limit?: number) => Promise<void>
  /** Start session-dir watchers for these workspaces (idempotent). */
  watchWorkspaces: (workspacePaths: string[]) => void
  /** Stop watching these workspaces (collapsed sidebar groups). */
  unwatchWorkspaces: (workspacePaths: string[]) => void
  createSession: (
    workspacePath: string,
    options?: {
      sessionPath?: string
      forkFrom?: string
      name?: string
      firstPrompt?: string
      firstImages?: ImageContent[]
    },
  ) => Promise<string>
  openDiskSession: (workspacePath: string, meta: SessionMeta) => Promise<string>
  activate: (sessionId: string | null) => void
  disposeSession: (sessionId: string) => Promise<void>
  deleteDiskSession: (workspacePath: string, meta: SessionMeta) => Promise<void>
  togglePin: (path: string) => void
}

const unsubscribers = new Map<string, () => void>()
/** Workspaces already being watched, so repeat calls are no-ops. */
const watchedWorkspaces = new Set<string>()

async function bootstrapSession(pidexId: string): Promise<void> {
  const chat = useChatStore.getState()
  const [state, models, commands, stats] = await Promise.allSettled([
    window.pidex.piCommand(pidexId, { type: 'get_state' }),
    window.pidex.piCommand(pidexId, { type: 'get_available_models' }),
    window.pidex.piCommand(pidexId, { type: 'get_commands' }),
    window.pidex.piCommand(pidexId, { type: 'get_session_stats' }),
  ])
  if (state.status === 'fulfilled' && state.value.success && state.value.data) {
    chat.setMeta(pidexId, state.value.data)
    const diskPath = state.value.data.sessionFile
    if (diskPath) {
      useSessionsStore.setState((s) => ({
        live: {
          ...s.live,
          [pidexId]: { ...(s.live[pidexId] ?? { pidexId, workspacePath: '' }), diskPath },
        },
      }))
      // The path only becomes known here (get_state resolves after spawn), so
      // persist it now if this session is the one on screen.
      if (useSessionsStore.getState().activeSessionId === pidexId) {
        void window.pidex.invoke('app:setLastSession', diskPath)
      }
    }
  }
  if (models.status === 'fulfilled' && models.value.success && models.value.data) {
    chat.setModels(pidexId, models.value.data.models)
  }
  if (commands.status === 'fulfilled' && commands.value.success && commands.value.data) {
    chat.setCommands(pidexId, commands.value.data.commands)
  }
  if (stats.status === 'fulfilled' && stats.value.success && stats.value.data) {
    chat.setStats(pidexId, stats.value.data)
  }
}

async function refreshStats(pidexId: string): Promise<void> {
  try {
    const response = await window.pidex.piCommand(pidexId, { type: 'get_session_stats' })
    if (response.success && response.data) {
      useChatStore.getState().setStats(pidexId, response.data)
    }
  } catch {
    // session gone
  }
}

function attachSessionPushHandler(pidexId: string): void {
  const unsubscribe = window.pidex.onSessionPush(pidexId, (push: SessionPush) => {
    const chatStore = useChatStore.getState()
    switch (push.kind) {
      case 'event': {
        chatStore.applyEvent(pidexId, push.event)
        if (
          push.event.type === 'tool_execution_end' &&
          !push.event.isError &&
          (push.event.toolName === 'artifact_create' || push.event.toolName === 'artifact_update')
        ) {
          void import('./artifacts').then(({ useArtifactsStore }) =>
            useArtifactsStore
              .getState()
              .ingest(
                pidexId,
                (push.event as { toolName: string }).toolName,
                (push.event as { result?: { details?: unknown } }).result?.details,
              ),
          )
        }
        const { activeSessionId } = useSessionsStore.getState()
        if (
          activeSessionId !== pidexId &&
          (push.event.type === 'message_end' || push.event.type === 'agent_end')
        ) {
          useSessionsStore.setState((s) => ({
            unread: { ...s.unread, [pidexId]: (s.unread[pidexId] ?? 0) + 1 },
          }))
        }
        if (push.event.type === 'agent_end' || push.event.type === 'compaction_end') {
          void refreshStats(pidexId)
        }
        break
      }
      case 'exit':
        if (!push.expected) {
          chatStore.setError(
            pidexId,
            `pi exited unexpectedly (code ${push.code ?? 'unknown'}). The session file is preserved.`,
          )
        }
        break
      case 'stderr':
        console.warn(`[pi stderr] ${push.text}`)
        break
      case 'extension-ui':
        void import('./extensionUi').then(({ useExtensionUiStore }) =>
          useExtensionUiStore.getState().handleRequest(pidexId, push.request),
        )
        break
    }
  })
  unsubscribers.set(pidexId, unsubscribe)
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  activeSessionId: null,
  live: {},
  disk: {},
  unread: {},
  baselines: {},
  pinned: [],
  creating: false,

  hydratePinned: async () => {
    const prefs = await window.pidex.invoke('app:getPrefs')
    set({ pinned: prefs.pinnedSessions })
  },

  refreshDisk: async (workspacePath) => {
    const metas = await window.pidex.invoke('sessions:list', workspacePath)
    set((s) => ({ disk: { ...s.disk, [workspacePath]: metas } }))
  },

  /**
   * Scan several workspaces at once so the sidebar can list every project's
   * sessions, not just the active one.
   *
   * Capped and parallel: the scanner has an mtime+size cache so warm boots
   * are cheap, but a cold start with many known folders would otherwise do
   * unbounded directory walks before first paint. Remaining workspaces load
   * when their group is expanded.
   */
  refreshAllDisk: async (workspacePaths, limit = 8) => {
    const targets = workspacePaths.slice(0, limit)
    const results = await Promise.allSettled(
      targets.map(async (path) => ({
        path,
        metas: await window.pidex.invoke('sessions:list', path),
      })),
    )
    set((s) => {
      const disk = { ...s.disk }
      for (const result of results) {
        // A workspace that has been deleted just yields no sessions.
        if (result.status === 'fulfilled') disk[result.value.path] = result.value.metas
      }
      return { disk }
    })
  },

  watchWorkspaces: (workspacePaths) => {
    for (const path of workspacePaths) {
      if (watchedWorkspaces.has(path)) continue
      watchedWorkspaces.add(path)
      void window.pidex.invoke('sessions:watch', path)
    }
  },

  unwatchWorkspaces: (workspacePaths) => {
    for (const path of workspacePaths) {
      if (!watchedWorkspaces.delete(path)) continue
      void window.pidex.invoke('sessions:unwatch', path)
    }
  },

  createSession: async (workspacePath, options = {}) => {
    set({ creating: true })
    try {
      const info = await window.pidex.invoke('pi:createSession', {
        workspacePath,
        sessionPath: options.sessionPath,
        forkFrom: options.forkFrom,
        name: options.name,
      })
      const pidexId = info.sessionId
      useChatStore.getState().ensure(pidexId)
      attachSessionPushHandler(pidexId)

      // Git baseline for the Files Changed panel ("changes since session start").
      void window.pidex
        .invoke('git:sessionBaseline', workspacePath)
        .then((ref) => set((s) => ({ baselines: { ...s.baselines, [pidexId]: ref } })))
        .catch(() => set((s) => ({ baselines: { ...s.baselines, [pidexId]: null } })))
      set((s) => ({
        live: {
          ...s.live,
          [pidexId]: { pidexId, workspacePath, diskPath: options.sessionPath },
        },
        activeSessionId: pidexId,
        unread: { ...s.unread, [pidexId]: 0 },
      }))
      // Resumed sessions already know their file; fresh ones learn it from
      // get_state in bootstrapSession, which persists it then.
      if (options.sessionPath) {
        void window.pidex.invoke('app:setLastSession', options.sessionPath)
      }

      // Resume: hydrate history before metadata so the transcript paints fast.
      if (options.sessionPath) {
        try {
          const messages = await window.pidex.piCommand(pidexId, { type: 'get_messages' })
          if (messages.success && messages.data) {
            useChatStore.getState().hydrate(pidexId, messages.data.messages)
            // Rebuild artifacts by replaying persisted toolResult messages.
            const { useArtifactsStore } = await import('./artifacts')
            useArtifactsStore.getState().ingestFromHistory(pidexId, messages.data.messages)
          }
        } catch {
          // non-fatal
        }
      }
      void bootstrapSession(pidexId)

      if (options.firstPrompt) {
        const images = options.firstImages?.length ? options.firstImages : undefined
        useChatStore.getState().addUserMessage(pidexId, options.firstPrompt, images)
        void window.pidex
          .piCommand(pidexId, {
            type: 'prompt',
            message: options.firstPrompt,
            ...(images ? { images } : {}),
          })
          .then((response) => {
            if (!response.success) useChatStore.getState().setError(pidexId, response.error)
          })
      }
      return pidexId
    } finally {
      set({ creating: false })
    }
  },

  openDiskSession: async (workspacePath, meta) => {
    // Already live? Just activate.
    const existing = Object.values(get().live).find((l) => l.diskPath === meta.path)
    if (existing) {
      get().activate(existing.pidexId)
      return existing.pidexId
    }
    return get().createSession(workspacePath, { sessionPath: meta.path })
  },

  activate: (sessionId) => {
    set((s) => ({
      activeSessionId: sessionId,
      unread: sessionId ? { ...s.unread, [sessionId]: 0 } : s.unread,
    }))
    // Remember where to reopen next launch. Clearing the session (New) also
    // clears the memory, so we land on the home screen instead.
    const live = sessionId ? get().live[sessionId] : undefined
    void window.pidex.invoke('app:setLastSession', live?.diskPath)
    // Keep the persisted workspace paired with the persisted session —
    // resumeTarget reunites the two on launch, and a stale lastWorkspacePath
    // would resume this session against another project's cwd.
    if (live?.workspacePath) {
      void window.pidex.invoke('app:recordWorkspace', live.workspacePath)
    }
  },

  disposeSession: async (sessionId) => {
    unsubscribers.get(sessionId)?.()
    unsubscribers.delete(sessionId)
    await window.pidex.invoke('pi:disposeSession', sessionId)
    useChatStore.getState().remove(sessionId)
    set((s) => {
      const live = { ...s.live }
      delete live[sessionId]
      const unread = { ...s.unread }
      delete unread[sessionId]
      return {
        live,
        unread,
        activeSessionId: s.activeSessionId === sessionId ? null : s.activeSessionId,
      }
    })
  },

  deleteDiskSession: async (workspacePath, meta) => {
    const live = Object.values(get().live).find((l) => l.diskPath === meta.path)
    if (live) await get().disposeSession(live.pidexId)
    await window.pidex.invoke('sessions:delete', meta.path)
    await get().refreshDisk(workspacePath)
  },

  togglePin: (path) => {
    set((s) => {
      const pinned = s.pinned.includes(path)
        ? s.pinned.filter((p) => p !== path)
        : [...s.pinned, path]
      void window.pidex.invoke('app:setPinnedSessions', pinned)
      return { pinned }
    })
  },
}))
