// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ContextMeter } from './ContextMeter'
import { useChatStore } from '@/stores/chat'
import type { SessionStats } from '@shared/rpc'

beforeAll(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

const SESSION = 'sess-1'

const invoke = vi.fn(async (channel: string) => {
  if (channel === 'claude:usageSnapshot') {
    return {
      ok: true,
      snapshot: {
        fetchedAt: Date.now(),
        stale: false,
        contributing: null,
        windows: [
          { label: 'Current session', kind: 'five_hour', percentUsed: 41, resetsAt: null },
          {
            label: 'Current week (all models)',
            kind: 'weekly',
            percentUsed: 63,
            resetsAt: null,
          },
        ],
      },
    }
  }
  return undefined
})

const stats = (contextUsage: SessionStats['contextUsage']): SessionStats => ({
  sessionId: SESSION,
  userMessages: 3,
  assistantMessages: 3,
  toolCalls: 8,
  toolResults: 8,
  totalMessages: 6,
  tokens: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40, total: 100 },
  cost: 1.5,
  contextUsage,
})

function seed(contextUsage: SessionStats['contextUsage'], provider = 'pi-claude-cli'): void {
  useChatStore.setState({
    sessions: {
      [SESSION]: {
        ...useChatStore.getState().sessions[SESSION],
        stats: stats(contextUsage),
        meta: {
          model: {
            id: 'claude-fable-5',
            name: 'Claude Fable 5',
            api: provider,
            provider,
            reasoning: true,
            input: ['text'],
            contextWindow: 200_000,
            maxTokens: 64_000,
            cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
          },
        },
      },
    } as never,
  })
}

let root: Root | null = null
let container: HTMLDivElement | null = null

function render(): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<ContextMeter sessionId={SESSION} />))
}

function click(text: string): void {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text))
  expect(button).toBeDefined()
  act(() => button!.click())
}

beforeEach(() => {
  invoke.mockClear()
  ;(globalThis as unknown as { window: { pidex: unknown } }).window.pidex = { invoke }
  useChatStore.setState({ sessions: {} })
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
})

describe('ContextMeter', () => {
  it('still renders when pi has no context percentage yet', async () => {
    // pi reports null context tokens from the moment a session compacts until
    // fresh usage arrives. The meter used to unmount there, which took the
    // popover — and the plan-usage fetch inside it — with it.
    seed({ tokens: null, contextWindow: 200_000, percent: null })
    render()

    expect(document.body.textContent).toContain('—')
    click('—')
    await act(async () => {})
    expect(document.body.textContent).toContain('Session usage')
    expect(invoke).toHaveBeenCalledWith('claude:usageSnapshot')
  })

  it('shows the percentage once pi reports one', () => {
    seed({ tokens: 50_000, contextWindow: 200_000, percent: 25 })
    render()
    expect(document.body.textContent).toContain('25%')
  })

  it('fetches and shows both plan windows for a Claude Code session', async () => {
    seed({ tokens: 50_000, contextWindow: 200_000, percent: 25 })
    render()
    click('25%')
    await act(async () => {})

    expect(document.body.textContent).toContain('5-hour window')
    expect(document.body.textContent).toContain('41%')
    expect(document.body.textContent).toContain('Weekly window')
    expect(document.body.textContent).toContain('63%')
  })

  it('shows a reason instead of vanishing when the usage run fails', async () => {
    invoke.mockResolvedValueOnce({ ok: false, error: 'run-failed' } as never)
    seed({ tokens: 50_000, contextWindow: 200_000, percent: 25 })
    render()
    click('25%')
    await act(async () => {})

    expect(document.body.textContent).toContain('Plan usage · Claude account')
    expect(document.body.textContent).toContain('did not complete')
  })

  it('never asks for plan usage on a session the Claude CLI does not serve', async () => {
    seed({ tokens: 50_000, contextWindow: 200_000, percent: 25 }, 'amazon-bedrock')
    render()
    click('25%')
    await act(async () => {})

    expect(invoke).not.toHaveBeenCalledWith('claude:usageSnapshot')
    expect(document.body.textContent).not.toContain('Plan usage')
  })
})
