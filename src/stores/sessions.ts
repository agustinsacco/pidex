import { create } from 'zustand'
import type { GitInfo, SessionMeta, SessionPush } from '@shared/models'
import type { ImageContent, PiEvent } from '@shared/rpc'
import { useChatStore } from './chat'
import { drop } from './keyedSlice'
import { piCallOk, rehydrateTranscript } from '@/lib/rpc'
import { sessionTitle } from '@/lib/sessionTitle'

/**
 * Whether an event should trigger a stats refresh.
 *
 * `get_session_stats` reads pi's in-memory session state (no I/O — verified
 * against pi's own rpc-mode.js, `session.getSessionStats()`), so refreshing
 * on every completed sub-step keeps the context meter and working indicator
 * climbing live instead of jumping once per turn. Exported as a pure
 * predicate so the trigger set is unit-testable without mocking IPC.
 */
export function shouldRefreshStatsOn(eventType: PiEvent['type']): boolean {
  return (
    eventType === 'agent_end' ||
    eventType === 'compaction_end' ||
    eventType === 'message_end' ||
    eventType === 'tool_execution_end'
  )
}

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
  /** sessionPath → epoch ms last viewed (mirrors the persisted pref). */
  seenSessions: Record<string, number>
  /** cwd → cached git summary for sidebar subtitles. */
  gitByCwd: Record<string, GitInfo>
  creating: boolean

  hydratePinned: () => Promise<void>
  /** Record that the user is looking at this session right now. */
  markSeen: (sessionPath: string) => void
  /** Refresh batched git summaries for these cwds. */
  refreshGitInfo: (cwds: string[]) => Promise<void>
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
  /**
   * Reclaim a session's ~200MB pi subprocess while keeping its sidebar row.
   * Reopening resumes from disk (measured ~940ms), so this is cheap to undo.
   */
  suspendSession: (sessionId: string) => Promise<void>
  /** Session paths suspended this run, so the UI can label them. */
  suspendedPaths: string[]
  deleteDiskSession: (workspacePath: string, meta: SessionMeta) => Promise<void>
  togglePin: (path: string) => void
}

const unsubscribers = new Map<string, () => void>()
/** Workspaces already being watched, so repeat calls are no-ops. */
const watchedWorkspaces = new Set<string>()

/**
 * The one sanctioned exemption from the `piCall` rule (CLAUDE.md fact 3): this
 * batch wants the raw envelopes, both because `Promise.allSettled` reasons over
 * them and because a per-command failure is expected here — older pi builds
 * simply lack some of these commands, and surfacing five chat errors while a
 * session is still opening would be worse than the graceful degradation below.
 */
async function bootstrapSession(pidexId: string): Promise<void> {
  const chat = useChatStore.getState()
  // get_state is awaited on its own, ahead of the rest: it carries
  // `sessionFile`, and "reopen my last session" depends on that path being
  // persisted. Batching it with the slower catalogue calls meant a window
  // closed before the batch settled lost the pref entirely — a race the
  // relaunch e2e caught on Linux CI once a fifth call joined the batch.
  const statePromise = window.pidex.piCommand(pidexId, { type: 'get_state' })
  const restPromise = Promise.allSettled([
    window.pidex.piCommand(pidexId, { type: 'get_available_models' }),
    window.pidex.piCommand(pidexId, { type: 'get_commands' }),
    window.pidex.piCommand(pidexId, { type: 'get_session_stats' }),
    window.pidex.piCommand(pidexId, { type: 'get_available_thinking_levels' }),
  ])

  const state = await statePromise.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: unknown) => ({ status: 'rejected' as const, reason }),
  )
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
        useSessionsStore.getState().markSeen(diskPath)
      }
    }
  }
  const [models, commands, stats, thinkingLevels] = await restPromise
  if (models.status === 'fulfilled' && models.value.success && models.value.data) {
    chat.setModels(pidexId, models.value.data.models)
  }
  if (commands.status === 'fulfilled' && commands.value.success && commands.value.data) {
    chat.setCommands(pidexId, commands.value.data.commands)
  }
  if (stats.status === 'fulfilled' && stats.value.success && stats.value.data) {
    chat.setStats(pidexId, stats.value.data)
  }
  // Older pi builds lack this command; leaving it null makes the picker derive
  // the levels locally instead of showing a wrong hardcoded list.
  if (
    thinkingLevels.status === 'fulfilled' &&
    thinkingLevels.value.success &&
    thinkingLevels.value.data
  ) {
    chat.setThinkingLevels(pidexId, thinkingLevels.value.data.levels)
  }
}

/**
 * Re-ask pi which thinking levels are selectable.
 *
 * Must run after every model switch: the supported set is per-model, so a
 * stale list would offer levels the new model silently clamps away.
 *
 * Raw `piCommand` on purpose: the failure mode is "pi is too old to know this
 * command", which the picker already handles by deriving the levels locally.
 */
export async function refreshThinkingLevels(pidexId: string): Promise<void> {
  try {
    const response = await window.pidex.piCommand(pidexId, {
      type: 'get_available_thinking_levels',
    })
    if (response.success && response.data) {
      useChatStore.getState().setThinkingLevels(pidexId, response.data.levels)
    }
  } catch {
    // Session gone, or pi too old — the picker's local derivation covers it.
  }
}

/**
 * Generate and apply a title for a brand-new session's first message.
 *
 * The one-shot completion (`pi:generateTitle`) can take seconds; by the time
 * it lands the user may have renamed the session (guard: explicit
 * `sessionName` wins) or closed it (guard: still live). Existing titles ride
 * along so the model avoids duplicating a sibling session's name.
 */
async function autoNameSession(
  pidexId: string,
  workspacePath: string,
  firstPrompt: string,
): Promise<void> {
  const existing = (useSessionsStore.getState().disk[workspacePath] ?? [])
    .map((m) => sessionTitle({ explicitName: m.name, firstUserText: m.firstUserText }))
    .filter((t): t is string => Boolean(t))
  const title = await window.pidex
    .invoke('pi:generateTitle', workspacePath, firstPrompt, existing)
    .catch(() => null)
  if (!title) return
  if (useChatStore.getState().sessions[pidexId]?.meta?.sessionName) return
  if (!useSessionsStore.getState().live[pidexId]) return
  if (await piCallOk(pidexId, { type: 'set_session_name', name: title })) {
    useChatStore.getState().patchMeta(pidexId, { sessionName: title })
    void useSessionsStore.getState().refreshDisk(workspacePath)
  }
}

/**
 * Raw `piCommand` on purpose: this fires on every completed sub-step of a turn,
 * so routing failures to the chat surface would paint an error per token batch.
 * A stale context meter is the better failure.
 */
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
        // NOTE: deliberately no markSeen() here. Marking the *active* session
        // seen on every message_end looked harmless but wrote to prefs on every
        // token-batch, and that write raced `setLastSession` during teardown —
        // a session closed right after a reply lost its resume path (caught by
        // the multi-workspace sidebar e2e). It is also redundant: opening a
        // session marks it seen via `activate` / `bootstrapSession`, and the
        // unseen pill only ever describes sessions you are NOT looking at.
        if (shouldRefreshStatsOn(push.event.type)) {
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
  suspendedPaths: [],
  seenSessions: {},
  gitByCwd: {},
  creating: false,

  hydratePinned: async () => {
    const prefs = await window.pidex.invoke('app:getPrefs')
    set({ pinned: prefs.pinnedSessions, seenSessions: prefs.seenSessions ?? {} })
  },

  markSeen: (sessionPath) => {
    if (!sessionPath) return
    set((s) => ({ seenSessions: { ...s.seenSessions, [sessionPath]: Date.now() } }))
    void window.pidex.invoke('app:markSessionSeen', sessionPath)
  },

  refreshGitInfo: async (cwds) => {
    const unique = [...new Set(cwds)].filter(Boolean)
    if (unique.length === 0) return
    try {
      const map = await window.pidex.invoke('git:infoBatch', unique)
      set((s) => ({ gitByCwd: { ...s.gitByCwd, ...map } }))
    } catch {
      // git unavailable — subtitles just omit their git segments
    }
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
      // Resuming from disk means history is on its way; the transcript shows a
      // skeleton instead of the "nothing here yet" empty state until it lands.
      useChatStore.getState().ensure(pidexId, { resuming: Boolean(options.sessionPath) })
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
          const messages = await rehydrateTranscript(pidexId)
          if (messages) {
            // Rebuild artifacts by replaying persisted toolResult messages.
            const { useArtifactsStore } = await import('./artifacts')
            useArtifactsStore.getState().ingestFromHistory(pidexId, messages)
          }
        } catch {
          // non-fatal
        } finally {
          // hydrate() clears this, but a failed or empty get_messages must not
          // leave the transcript stuck behind a skeleton forever.
          useChatStore.getState().doneResuming(pidexId)
        }
      }
      void bootstrapSession(pidexId)

      if (options.firstPrompt) {
        const images = options.firstImages?.length ? options.firstImages : undefined
        useChatStore.getState().addUserMessage(pidexId, options.firstPrompt, images)
        void piCallOk(pidexId, {
          type: 'prompt',
          message: options.firstPrompt,
          ...(images ? { images } : {}),
        })
        // A brand-new session (not a resume, not explicitly named) gets a
        // generated title once its first message exists. Fire-and-forget: the
        // first-message-derived title stands until (and unless) this lands.
        if (!options.name && !options.sessionPath) {
          void autoNameSession(pidexId, workspacePath, options.firstPrompt)
        }
      }
      return pidexId
    } finally {
      set({ creating: false })
    }
  },

  openDiskSession: async (workspacePath, meta) => {
    get().markSeen(meta.path)
    // Reopening clears the suspended marker; the resume path below re-spawns pi
    // and the transcript shows its skeleton while history replays.
    if (get().suspendedPaths.includes(meta.path)) {
      set((s) => ({ suspendedPaths: s.suspendedPaths.filter((p) => p !== meta.path) }))
    }
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
    if (live?.diskPath) get().markSeen(live.diskPath)
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
    // Session-scoped side state: kill its PTYs, drop its artifacts, and clear
    // its extension UI. Lazy imports keep this store free of load-order
    // cycles; AWAITED so the cleanup cannot outlive the caller (fire-and-forget
    // raced test teardown, and would equally race app shutdown).
    const [
      { useTerminalStore },
      { useArtifactsStore },
      { useExtensionUiStore },
      { useLayoutStore },
    ] = await Promise.all([
      import('./terminal'),
      import('./artifacts'),
      import('./extensionUi'),
      import('./layout'),
    ])
    await useTerminalStore.getState().removeSession(sessionId)
    useArtifactsStore.getState().remove(sessionId)
    // The right pane is per session too, so its slice needs dropping here or
    // it outlives the session that owned it.
    useLayoutStore.getState().removeSession(sessionId)
    // `clearSession` existed but was never wired up, so statuses and widgets
    // (which hold extension-supplied line arrays) accumulated until quit.
    useExtensionUiStore.getState().clearSession(sessionId)
    set((s) => ({
      live: drop(s.live, sessionId),
      unread: drop(s.unread, sessionId),
      // Was missing: every disposed session left a permanent baselines entry.
      baselines: drop(s.baselines, sessionId),
      activeSessionId: s.activeSessionId === sessionId ? null : s.activeSessionId,
    }))
  },

  suspendSession: async (sessionId) => {
    const entry = get().live[sessionId]
    const diskPath = entry?.diskPath
    await get().disposeSession(sessionId)
    // Remember the path (not the pidexId, which dies with the process) so the
    // sidebar can mark the row "suspended" until it is reopened.
    if (diskPath) {
      set((s) => ({
        suspendedPaths: s.suspendedPaths.includes(diskPath)
          ? s.suspendedPaths
          : [...s.suspendedPaths, diskPath],
      }))
    }
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
