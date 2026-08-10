// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ModelMenu, type ModelMenuEntry } from './ModelMenu'

// jsdom has no layout engine, so MenuRow's scroll-into-view call is a no-op here.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

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

const bedrock = (id: string, name: string): ModelMenuEntry => ({
  id,
  name,
  provider: 'amazon-bedrock',
})

/** The real shape from pi's catalogue: one bare id plus three profiles. */
const FABLE_MODELS: ModelMenuEntry[] = [
  bedrock('anthropic.claude-fable-5', 'Claude Fable 5'),
  bedrock('eu.anthropic.claude-fable-5', 'Claude Fable 5 (EU)'),
  bedrock('us.anthropic.claude-fable-5', 'Claude Fable 5 (US)'),
  bedrock('global.anthropic.claude-fable-5', 'Claude Fable 5 (Global)'),
]

function rows(): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')] as HTMLButtonElement[]
}

function rowNamed(label: string): HTMLButtonElement {
  const found = rows().find((b) => b.textContent?.startsWith(label))
  if (!found) throw new Error(`no row for ${label}: ${rows().map((r) => r.textContent)}`)
  return found
}

function searchField(): HTMLInputElement {
  const el = document.querySelector('input')
  if (!el) throw new Error('no search field')
  return el
}

function press(key: string): void {
  act(() => {
    searchField().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}

function mount(models: ModelMenuEntry[], onPick = vi.fn()): { onPick: ReturnType<typeof vi.fn> } {
  render(
    <ModelMenu
      models={models}
      isCurrent={() => false}
      onPick={onPick}
      onClose={vi.fn()}
      emptyText="none"
    />,
  )
  return { onPick }
}

describe('ModelMenu availability', () => {
  it('disables the bare Bedrock id and explains why', () => {
    mount(FABLE_MODELS)
    const bare = rowNamed('Claude Fable 5')
    expect(bare.disabled).toBe(true)
    expect(bare.textContent).toMatch(/inference profile/i)
  })

  it('leaves the region-prefixed profiles selectable', () => {
    mount(FABLE_MODELS)
    for (const label of ['Claude Fable 5 (EU)', 'Claude Fable 5 (US)', 'Claude Fable 5 (Global)']) {
      expect(rowNamed(label).disabled).toBe(false)
    }
  })

  it('does not pick a disabled model on click', () => {
    const { onPick } = mount(FABLE_MODELS)
    act(() => {
      rowNamed('Claude Fable 5').click()
    })
    expect(onPick).not.toHaveBeenCalled()
  })

  it('picks a working profile on click', () => {
    const { onPick } = mount(FABLE_MODELS)
    act(() => {
      rowNamed('Claude Fable 5 (Global)').click()
    })
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'global.anthropic.claude-fable-5' }),
    )
  })

  it('skips disabled rows when arrowing, so Enter never lands on one', () => {
    const { onPick } = mount(FABLE_MODELS)
    // The bare id sorts first; the initial highlight must already have moved
    // past it, so Enter with no arrowing picks a real model.
    press('Enter')
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick.mock.calls[0]?.[0]?.id).not.toBe('anthropic.claude-fable-5')
  })

  it('never highlights the disabled row while cycling with ArrowDown', () => {
    const { onPick } = mount(FABLE_MODELS)
    // Three selectable rows: a full cycle plus one must stay on real models.
    for (let i = 0; i < 4; i++) {
      press('ArrowDown')
      press('Enter')
    }
    expect(onPick).toHaveBeenCalledTimes(4)
    for (const call of onPick.mock.calls) {
      expect(call[0].id).not.toBe('anthropic.claude-fable-5')
    }
  })

  it('wraps backwards past the disabled row with ArrowUp', () => {
    const { onPick } = mount(FABLE_MODELS)
    press('ArrowUp')
    press('Enter')
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick.mock.calls[0]?.[0]?.id).not.toBe('anthropic.claude-fable-5')
  })

  it('leaves a catalogue with no profile siblings fully selectable', () => {
    mount([
      bedrock('amazon.nova-pro-v1:0', 'Nova Pro'),
      bedrock('amazon.nova-lite-v1:0', 'Nova Lite'),
    ])
    expect(rows().every((r) => !r.disabled)).toBe(true)
  })

  it('still shows the blocked row when it is the only search match', () => {
    // Hiding it would make "where did Fable go?" unanswerable; it stays, dimmed.
    mount(FABLE_MODELS)
    act(() => {
      const field = searchField()
      field.value = 'anthropic.claude-fable-5'
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const bare = rows().find((b) => b.textContent?.includes('Claude Fable 5'))
    expect(bare?.disabled).toBe(true)
  })
})
