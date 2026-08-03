import { create } from 'zustand'
import type { AgentMessage, ToolResultMessage } from '@shared/rpc'
import { useLayoutStore } from './layout'

export type ArtifactType = 'html' | 'markdown' | 'svg' | 'mermaid' | 'code' | 'chart'

export interface ArtifactVersion {
  version: number
  content: string
  title: string
  createdAt: number
}

export interface Artifact {
  id: string
  title: string
  type: ArtifactType
  language?: string
  versions: ArtifactVersion[]
  updatedAt: number
}

interface ArtifactDetailsPayload {
  id?: string
  title?: string
  type?: string
  language?: string
  content?: string
  version?: number
}

interface ArtifactsState {
  /** sessionId → artifactId → artifact. */
  bySession: Record<string, Record<string, Artifact>>
  /** sessionId → selected artifact id in the viewer. */
  selected: Record<string, string | undefined>
  /** Unseen version count while the pane is closed. */
  unseen: Record<string, number>

  ingest: (
    sessionId: string,
    toolName: string,
    details: unknown,
    opts?: { autoOpen?: boolean },
  ) => void
  ingestFromHistory: (sessionId: string, messages: AgentMessage[]) => void
  addLocal: (
    sessionId: string,
    artifact: { title: string; type: ArtifactType; language?: string; content: string },
  ) => void
  select: (sessionId: string, artifactId: string) => void
  clearUnseen: (sessionId: string) => void
  remove: (sessionId: string) => void
}

const VALID_TYPES = new Set(['html', 'markdown', 'svg', 'mermaid', 'code', 'chart'])

export const useArtifactsStore = create<ArtifactsState>((set, get) => ({
  bySession: {},
  selected: {},
  unseen: {},

  ingest: (sessionId, toolName, rawDetails, opts = {}) => {
    const details = rawDetails as ArtifactDetailsPayload | undefined
    if (!details?.id || typeof details.content !== 'string') return

    set((state) => {
      const session = { ...(state.bySession[sessionId] ?? {}) }
      const existing = session[details.id!]
      const version: ArtifactVersion = {
        version: details.version ?? (existing ? existing.versions.length + 1 : 1),
        content: details.content!,
        title: details.title ?? existing?.title ?? details.id!,
        createdAt: Date.now(),
      }

      if (toolName === 'artifact_update' && existing) {
        session[details.id!] = {
          ...existing,
          title:
            details.title && details.type === 'update'
              ? existing.title
              : (details.title ?? existing.title),
          versions: [
            ...existing.versions.filter((v) => v.version !== version.version),
            version,
          ].sort((a, b) => a.version - b.version),
          updatedAt: Date.now(),
        }
      } else {
        const type = VALID_TYPES.has(details.type ?? '')
          ? (details.type as ArtifactType)
          : (existing?.type ?? 'code')
        session[details.id!] = {
          id: details.id!,
          title: details.title ?? details.id!,
          type,
          language: details.language ?? existing?.language,
          versions: [
            ...(existing?.versions.filter((v) => v.version !== version.version) ?? []),
            version,
          ].sort((a, b) => a.version - b.version),
          updatedAt: Date.now(),
        }
      }

      const layout = useLayoutStore.getState()
      const paneOpen = layout.rightPane === 'artifacts'
      // First artifact in a session auto-opens the pane.
      const isFirst = Object.keys(state.bySession[sessionId] ?? {}).length === 0
      if (isFirst && opts.autoOpen !== false && !paneOpen) {
        layout.setRightPane('artifacts')
      }

      return {
        bySession: { ...state.bySession, [sessionId]: session },
        selected: { ...state.selected, [sessionId]: details.id },
        unseen: paneOpen
          ? state.unseen
          : { ...state.unseen, [sessionId]: (state.unseen[sessionId] ?? 0) + 1 },
      }
    })
  },

  ingestFromHistory: (sessionId, messages) => {
    for (const message of messages) {
      if (!('role' in message) || message.role !== 'toolResult') continue
      const result = message as ToolResultMessage
      if (result.toolName !== 'artifact_create' && result.toolName !== 'artifact_update') continue
      if (result.isError) continue
      get().ingest(sessionId, result.toolName, result.details, { autoOpen: false })
    }
  },

  addLocal: (sessionId, artifact) => {
    const id = `local-${artifact.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)}-${Date.now().toString(36).slice(-4)}`
    get().ingest(sessionId, 'artifact_create', {
      id,
      title: artifact.title,
      type: artifact.type,
      language: artifact.language,
      content: artifact.content,
      version: 1,
    })
  },

  select: (sessionId, artifactId) =>
    set((s) => ({ selected: { ...s.selected, [sessionId]: artifactId } })),

  clearUnseen: (sessionId) => set((s) => ({ unseen: { ...s.unseen, [sessionId]: 0 } })),

  remove: (sessionId) =>
    set((s) => {
      const bySession = { ...s.bySession }
      delete bySession[sessionId]
      return { bySession }
    }),
}))
