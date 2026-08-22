import { describe, expect, it } from 'vitest'
import { hydrateFromMessages } from '../reducer'
import {
  buildTranscriptRows,
  externalToolInfo,
  parseExternalToolMarker,
  summarizeActivity,
  trailingAgentLaunches,
  type ActivityStep,
} from './transcriptRows'
import { settledVerb } from '../tools/toolSummaries'
import type { AgentMessage } from '@shared/rpc'
import fixture from '../__fixtures__/claude-cli-blocks.json'

/**
 * Rendering contract for sessions produced by the Claude Code provider
 * (`@saccolabs/pi-claude-cli`), where two block shapes are unlike anything
 * pi's own providers emit:
 *
 *  - CLI-side tools (WebSearch, MCP servers, ToolSearch) arrive as one-line
 *    marker TEXT blocks, because pi cannot execute them and so never sees
 *    them as tool calls.
 *  - Encrypted thinking arrives as a thinking block with a signature and no
 *    plaintext (fable-5, opus-5, sonnet-5 all do this; haiku-4-5 does not).
 *
 * The fixture is trimmed from real captured sessions.
 */
const messages = fixture as unknown as AgentMessage[]

const rowsFor = (msgs: AgentMessage[]): ReturnType<typeof buildTranscriptRows> =>
  buildTranscriptRows(hydrateFromMessages(msgs).items)

describe('parseExternalToolMarker', () => {
  it('reads the tool name and leaves the argument preview opaque', () => {
    expect(parseExternalToolMarker('[Claude Code · WebSearch {"query":"pygame"}]')).toEqual({
      name: 'WebSearch',
      args: '{"query":"pygame"}',
    })
    // Truncated args (the provider caps the preview) must still parse.
    expect(
      parseExternalToolMarker('[Claude Code · Monitor {"command":"for i in 1 2 3; do ec…]'),
    ).toMatchObject({ name: 'Monitor' })
    // No arguments at all.
    expect(parseExternalToolMarker('[Claude Code · ListAgents]')).toEqual({
      name: 'ListAgents',
      args: undefined,
    })
  })

  it('does not claim ordinary prose', () => {
    expect(parseExternalToolMarker('Claude Code is a CLI.')).toBeNull()
    expect(parseExternalToolMarker('[note] see [Claude Code · docs]')).toBeNull()
    expect(parseExternalToolMarker('')).toBeNull()
  })
})

describe('Claude Code provider transcripts', () => {
  it('renders CLI-side tool markers as activity steps, never as prose', () => {
    const rows = rowsFor(messages)

    const textRows = rows.filter((r) => r.kind === 'text')
    for (const row of textRows) {
      const text = (row as Extract<typeof row, { kind: 'text' }>).block.text
      expect(parseExternalToolMarker(text), `prose row leaked a marker: ${text}`).toBeNull()
    }

    const steps = rows
      .filter((r) => r.kind === 'activity')
      .flatMap((r) => (r as { steps: ActivityStep[] }).steps)
    const external = steps.filter((s) => s.block.type === 'externalTool')
    expect(external.map((s) => (s.block as { name: string }).name)).toEqual([
      'ToolSearch',
      'WebSearch',
    ])
  })

  it('keeps the real answer prose intact', () => {
    const rows = rowsFor(messages)
    const prose = rows
      .filter((r) => r.kind === 'text')
      .map((r) => (r as Extract<typeof r, { kind: 'text' }>).block.text)
    expect(prose.some((t) => t.includes('Pygame'))).toBe(true)
  })

  it('drops encrypted thinking blocks so no empty "thought" is advertised', () => {
    const state = hydrateFromMessages(messages)
    const rows = buildTranscriptRows(state.items)
    const steps = rows
      .filter((r) => r.kind === 'activity')
      .flatMap((r) => (r as { steps: ActivityStep[] }).steps)

    expect(steps.some((s) => s.block.type === 'thinking')).toBe(false)

    const summary = summarizeActivity(steps, state.tools, (t) => settledVerb(t.toolName ?? ''))
    expect(summary.thinkingCount).toBe(0)
  })

  it('counts CLI-side tools in the activity summary', () => {
    const state = hydrateFromMessages(messages)
    const steps = buildTranscriptRows(state.items)
      .filter((r) => r.kind === 'activity')
      .flatMap((r) => (r as { steps: ActivityStep[] }).steps)

    const summary = summarizeActivity(steps, state.tools, (t) => settledVerb(t.toolName ?? ''))
    expect(summary.detail).toContain('claude code 2 tools')
  })

  it('summarizes sub-agent launches as launched agents, not anonymous tools', () => {
    const launch: AgentMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '[Claude Code · Agent {"description":"Find rename code"}]' },
        ],
        stopReason: 'stop',
      } as unknown as AgentMessage,
    ]
    const state = hydrateFromMessages(launch)
    const steps = buildTranscriptRows(state.items)
      .filter((r) => r.kind === 'activity')
      .flatMap((r) => (r as { steps: ActivityStep[] }).steps)

    const summary = summarizeActivity(steps, state.tools, (t) => settledVerb(t.toolName ?? ''))
    expect(summary.detail).toContain('launched 1 agent')
    expect(summary.detail).not.toContain('claude code')
  })

  it('still shows a thinking block that carries real text', () => {
    const withThought: AgentMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'weighing options', thinkingSignature: 'sig' },
          { type: 'text', text: 'done' },
        ],
        stopReason: 'stop',
      } as unknown as AgentMessage,
    ]
    const state = hydrateFromMessages(withThought)
    const steps = buildTranscriptRows(state.items)
      .filter((r) => r.kind === 'activity')
      .flatMap((r) => (r as { steps: ActivityStep[] }).steps)

    expect(steps.filter((s) => s.block.type === 'thinking')).toHaveLength(1)
  })
})

describe('externalToolInfo', () => {
  it('reads an agent launch: description headline, prompt detail', () => {
    const info = externalToolInfo(
      'Agent',
      '{"description":"Find rename code","prompt":"In this Electron app, locate…"}',
    )
    expect(info.isAgent).toBe(true)
    expect(info.headline).toBe('Find rename code')
    expect(info.detail).toBe('In this Electron app, locate…')
  })

  it('recovers complete fields from a truncated preview', () => {
    // The provider caps the preview mid-string — JSON.parse fails, but the
    // complete description pair must still surface.
    const info = externalToolInfo(
      'Task',
      '{"description":"Find chat rename and sort code","prompt":"In this Electron app (pide…',
    )
    expect(info.isAgent).toBe(true)
    expect(info.headline).toBe('Find chat rename and sort code')
  })

  it('unescapes JSON escapes in recovered fields', () => {
    const info = externalToolInfo('WebSearch', '{"query":"say \\"hi\\""}')
    expect(info.headline).toBe('say "hi"')
  })

  it('picks a meaningful headline for ordinary tools and tolerates no args', () => {
    expect(externalToolInfo('WebSearch', '{"query":"pygame docs"}').headline).toBe('pygame docs')
    expect(externalToolInfo('ListAgents').headline).toBeUndefined()
    expect(externalToolInfo('ListAgents').isAgent).toBe(false)
  })
})

describe('trailingAgentLaunches', () => {
  const agentText = '[Claude Code · Agent {"description":"scout"}]'
  const message = (role: string, content: unknown): AgentMessage =>
    ({ role, content, stopReason: 'stop' }) as unknown as AgentMessage

  it('counts launches after the last user message', () => {
    const state = hydrateFromMessages([
      message('user', 'go'),
      message('assistant', [
        { type: 'text', text: agentText },
        { type: 'text', text: 'Launched a scout.' },
      ]),
    ])
    expect(trailingAgentLaunches(buildTranscriptRows(state.items))).toBe(1)
  })

  it('resets once the user replies', () => {
    const state = hydrateFromMessages([
      message('user', 'go'),
      message('assistant', [{ type: 'text', text: agentText }]),
      message('user', 'any news?'),
    ])
    expect(trailingAgentLaunches(buildTranscriptRows(state.items))).toBe(0)
  })

  it('ignores ordinary external tools', () => {
    const state = hydrateFromMessages([
      message('user', 'go'),
      message('assistant', [{ type: 'text', text: '[Claude Code · WebSearch {"query":"x"}]' }]),
    ])
    expect(trailingAgentLaunches(buildTranscriptRows(state.items))).toBe(0)
  })
})
