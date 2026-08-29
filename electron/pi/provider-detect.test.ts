import { describe, expect, it } from 'vitest'
import { usesClaudeCliProvider } from './provider-detect'

describe('usesClaudeCliProvider', () => {
  it('trusts an explicit provider over everything else', () => {
    expect(usesClaudeCliProvider({ provider: 'pi-claude-cli' }, 'google')).toBe(true)
    expect(usesClaudeCliProvider({ provider: 'google' }, 'pi-claude-cli')).toBe(false)
    expect(
      usesClaudeCliProvider(
        { provider: 'google', model: 'pi-claude-cli/claude-opus-5' },
        undefined,
      ),
    ).toBe(false)
  })

  it('reads a provider/id model pattern as pinning the provider', () => {
    expect(usesClaudeCliProvider({ model: 'pi-claude-cli/claude-opus-5' }, 'google')).toBe(true)
    expect(usesClaudeCliProvider({ model: 'pi-claude-cli/claude-opus-5:high' }, undefined)).toBe(
      true,
    )
    expect(usesClaudeCliProvider({ model: 'google/gemini-2.5-pro' }, 'pi-claude-cli')).toBe(false)
  })

  it('falls back to the default provider when nothing is pinned', () => {
    expect(usesClaudeCliProvider({}, 'pi-claude-cli')).toBe(true)
    expect(usesClaudeCliProvider({}, 'google')).toBe(false)
    expect(usesClaudeCliProvider({}, undefined)).toBe(false)
  })

  it('requires a claude-ish bare pattern under a claude default', () => {
    expect(usesClaudeCliProvider({ model: 'claude-opus-5' }, 'pi-claude-cli')).toBe(true)
    // A bare non-claude pattern can fuzzy-match into another provider even
    // when the default is pi-claude-cli — do not strip context files there.
    expect(usesClaudeCliProvider({ model: 'gemini-2.5-pro' }, 'pi-claude-cli')).toBe(false)
    expect(usesClaudeCliProvider({ model: 'claude-opus-5' }, 'google')).toBe(false)
  })
})
