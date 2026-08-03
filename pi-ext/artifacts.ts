/**
 * pidex artifacts extension — loaded into every pidex session via
 * `pi --mode rpc -e <this file>`.
 *
 * Registers `artifact_create` / `artifact_update`. Tool results keep chat
 * output short (confirmation text) while the full payload rides in
 * `details`, which pidex consumes from tool_execution_end events and from
 * session history on resume (toolResult messages persist in the JSONL).
 *
 * Imports resolve against pi's own runtime when it loads the extension.
 */
import { Type } from 'typebox'

interface ArtifactDetails {
  id: string
  title: string
  type: string
  language?: string
  content: string
  version: number
}

interface ToolResultLike {
  content: Array<{ type: 'text'; text: string }>
  details: ArtifactDetails
}

// Loose structural types: the real ones live in @earendil-works/pi-coding-agent,
// which is provided by pi at load time (not a pidex dependency).
interface PiExtensionApi {
  registerTool(definition: Record<string, unknown>): void
  on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void
}

const ARTIFACT_TYPES = ['html', 'markdown', 'svg', 'mermaid', 'code', 'chart'] as const

export default function artifactsExtension(pi: PiExtensionApi): void {
  /** Per-artifact version counters; rebuilt from history on session start. */
  const versions = new Map<string, number>()

  const slugify = (text: string): string =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'artifact'

  const uniqueId = (base: string): string => {
    if (!versions.has(base)) return base
    let i = 2
    while (versions.has(`${base}-${i}`)) i++
    return `${base}-${i}`
  }

  pi.registerTool({
    name: 'artifact_create',
    label: 'Create artifact',
    description:
      'Create a rich artifact rendered in a dedicated panel beside the chat. ' +
      `type is one of: ${ARTIFACT_TYPES.join(', ')}. Use for substantial, ` +
      'self-contained content: full HTML pages/mockups, SVG graphics, mermaid ' +
      'diagrams, markdown documents/reports, chart specs (Chart.js JSON), or ' +
      'complete code files meant for review. Small snippets belong inline in chat.',
    promptSnippet:
      'Create a rich artifact (html/svg/markdown/mermaid/chart/code) in the side panel',
    promptGuidelines: [
      'Use artifact_create for substantial self-contained deliverables (HTML mockups, SVG graphics, diagrams, documents, reports, chart specs) so they render in the artifact panel; keep short snippets inline in chat.',
      'When revising an artifact you already created, call artifact_update with its id instead of creating a new one.',
    ],
    parameters: Type.Object({
      id: Type.Optional(
        Type.String({ description: 'Stable slug id; generated from the title if omitted' }),
      ),
      title: Type.String({ description: 'Human-readable title shown in the panel' }),
      type: Type.String({
        description: `Artifact type: ${ARTIFACT_TYPES.join(' | ')}`,
      }),
      content: Type.String({ description: 'Full artifact content' }),
      language: Type.Optional(
        Type.String({ description: 'Language for type=code (e.g. typescript, python)' }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: { id?: string; title: string; type: string; content: string; language?: string },
    ): Promise<ToolResultLike> {
      const type = params.type.toLowerCase()
      if (!(ARTIFACT_TYPES as readonly string[]).includes(type)) {
        throw new Error(
          `Unknown artifact type "${params.type}" — use one of: ${ARTIFACT_TYPES.join(', ')}`,
        )
      }
      const id = params.id ? slugify(params.id) : uniqueId(slugify(params.title))
      const version = (versions.get(id) ?? 0) + 1
      versions.set(id, version)
      const details: ArtifactDetails = {
        id,
        title: params.title,
        type,
        language: params.language,
        content: params.content,
        version,
      }
      return {
        content: [
          {
            type: 'text',
            text: `Created artifact "${params.title}" (id: ${id}, v${version}, ${type}, ${params.content.length} chars). It is now visible in the artifact panel.`,
          },
        ],
        details,
      }
    },
  })

  pi.registerTool({
    name: 'artifact_update',
    label: 'Update artifact',
    description:
      'Update an existing artifact by id with new content (and optionally a new title). ' +
      'Creates the next version; the panel shows version history.',
    promptSnippet: 'Update an existing artifact by id (new version)',
    parameters: Type.Object({
      id: Type.String({ description: 'Id of the artifact to update' }),
      content: Type.String({ description: 'Full replacement content' }),
      title: Type.Optional(Type.String({ description: 'New title (optional)' })),
    }),
    async execute(
      _toolCallId: string,
      params: { id: string; content: string; title?: string },
    ): Promise<ToolResultLike> {
      const id = slugify(params.id)
      const previous = versions.get(id)
      if (!previous) {
        throw new Error(
          `No artifact with id "${id}" exists in this session — use artifact_create first.`,
        )
      }
      const version = previous + 1
      versions.set(id, version)
      const details: ArtifactDetails = {
        id,
        title: params.title ?? id,
        type: 'update',
        content: params.content,
        version,
      }
      return {
        content: [
          {
            type: 'text',
            text: `Updated artifact ${id} to v${version} (${params.content.length} chars).`,
          },
        ],
        details,
      }
    },
  })

  // Rebuild version counters from history so resumed sessions keep counting.
  pi.on('session_start', (_event, ctx) => {
    versions.clear()
    const manager = (ctx as { sessionManager?: { getBranch?: () => unknown[] } }).sessionManager
    const entries = manager?.getBranch?.() ?? []
    for (const entry of entries) {
      const record = entry as {
        type?: string
        message?: { role?: string; toolName?: string; details?: Partial<ArtifactDetails> }
      }
      if (record.type !== 'message' || record.message?.role !== 'toolResult') continue
      const toolName = record.message.toolName
      if (toolName !== 'artifact_create' && toolName !== 'artifact_update') continue
      const details = record.message.details
      if (details?.id && typeof details.version === 'number') {
        const current = versions.get(details.id) ?? 0
        if (details.version > current) versions.set(details.id, details.version)
      }
    }
  })
}
