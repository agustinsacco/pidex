// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// The settings store subscribes to prefers-color-scheme at import time, and
// jsdom ships no matchMedia. Hoisted so it exists before that module loads.
vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  })
})

import { ActivityGroup, ROW_INSET } from './ActivityGroup'
import type { ActivityStep } from './transcriptRows'
import type { ToolState } from '../reducer'

/**
 * One activity group renders four different row shapes, and two of them only
 * ever appear in sessions running on the Claude Code provider:
 *
 *  - a pi tool call (ToolCard)
 *  - a CLI-side tool pi never executed (`[Claude Code · WebSearch {…}]`)
 *  - a sub-agent launch (`Agent`/`Task`)
 *  - reasoning with no tool call after it
 *
 * They are authored in four different places in ActivityGroup.tsx, so the
 * failure mode is drift: someone adjusts the tool row's inset and a
 * Claude-provider run ends up with rows starting at two different x positions
 * inside one card. These tests pin the shared inset and the provider-specific
 * content, so the mixed transcript keeps reading as a single column.
 */

let root: Root | null = null
let container: HTMLDivElement | null = null

function render(ui: React.ReactNode): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(ui)
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
})

const tool = (id: string): ToolState => ({
  toolCallId: id,
  toolName: 'read',
  args: { path: 'src/app.ts' },
  argsText: '',
  status: 'done',
  output: null,
})

const step = (block: ActivityStep['block']): ActivityStep => ({
  itemId: 'a1',
  block,
  streaming: false,
  isLastInItem: false,
})

/** The mix a Claude-provider turn actually produces. */
const MIXED: ActivityStep[] = [
  step({ type: 'tool', index: 0, toolCallId: 't1' }),
  step({ type: 'externalTool', index: 1, name: 'WebSearch', args: '{"query":"pygame docs"}' }),
  step({
    type: 'externalTool',
    index: 2,
    name: 'Agent',
    args: '{"description":"Find rename code","prompt":"In this Electron app…"}',
  }),
  step({ type: 'thinking', index: 3, text: 'weighing options', closed: true }),
]

function renderMixed(): void {
  render(
    <ActivityGroup
      steps={MIXED}
      tools={{ t1: tool('t1') }}
      hideThinking={false}
      sessionId="s1"
      active={false}
    />,
  )
}

/** Every row's own container, in render order. */
function rowContainers(): HTMLElement[] {
  const card = document.querySelector('[data-testid="activity-group"] .divide-y')
  if (!card) throw new Error('group card not rendered')
  return [...card.children].map((step) => {
    // Each step wrapper holds exactly one row container.
    const el = step.firstElementChild ?? step
    return el as HTMLElement
  })
}

describe('ActivityGroup row shapes', () => {
  it('gives every row shape the same left inset', () => {
    renderMixed()
    const rows = rowContainers()
    expect(rows).toHaveLength(4)

    for (const row of rows) {
      // The row container itself, or the button inside it that carries the
      // padding (sub-agent and reasoning rows are buttons).
      const carrier = row.className.includes('pl-4')
        ? row
        : (row.querySelector('[class*="pl-4"]') as HTMLElement | null)
      expect(carrier, `a row shape lost the shared inset: ${row.outerHTML.slice(0, 120)}`).not.toBe(
        null,
      )
      for (const cls of ROW_INSET.split(' ')) {
        expect(carrier!.className).toContain(cls)
      }
    }
  })

  it('renders a CLI-side tool as a labelled step, not raw marker text', () => {
    renderMixed()
    const external = document.querySelector('[data-testid="external-tool-row"]')
    expect(external).not.toBeNull()
    expect(external!.textContent).toContain('Claude Code')
    expect(external!.textContent).toContain('WebSearch')
    expect(external!.textContent).toContain('pygame docs')
    // The marker syntax itself must never reach the reader.
    expect(external!.textContent).not.toContain('[Claude Code ·')
  })

  it('renders a sub-agent launch with its own badge and headline', () => {
    renderMixed()
    const subagent = document.querySelector('[data-testid="subagent-row"]')
    expect(subagent).not.toBeNull()
    expect(subagent!.textContent).toContain('agent')
    expect(subagent!.textContent).toContain('Find rename code')
  })

  it('keeps trailing reasoning as its own row', () => {
    renderMixed()
    const marks = document.querySelectorAll('[data-testid="thought-mark"]')
    expect(marks.length).toBe(1)
    expect(marks[0]!.textContent).toContain('Reasoning')
  })

  it('anchors the summary, so its label and the card share a left edge', () => {
    renderMixed()
    const summary = document.querySelector('[data-testid="activity-summary"]') as HTMLElement
    const card = document.querySelector(
      '[data-testid="activity-group"] .divide-y',
    ) as HTMLElement | null
    expect(card).not.toBeNull()
    // jsdom has no layout, so the invariant is expressed through the classes
    // that produce it: the summary pulls its own padding back out, and the
    // card adds no left offset of its own.
    expect(summary.className).toContain('-ml-1.5')
    expect(card!.className).not.toMatch(/\bml-\d/)
  })
})
